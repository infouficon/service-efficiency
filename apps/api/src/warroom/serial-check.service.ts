import { BadRequestException, ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import type { PublicAccount } from '../accounts/accounts.service';
import { erpConfigFrom, odataRows, type ErpConfig } from '../erp/erp-sync.service';
import { formatQueue } from '../queue/queue.service';
import { SettingsService } from '../settings/settings.service';

/**
 * Warroom pulls the whole stock from the ERP at these Bangkok times (erp-integration.md); a FileMaker check stays off the ERP
 * around them. `SERIAL_CHECK_QUIET` overrides the list (comma separated HH:MM; empty = none).
 */
const WARROOM_SLOTS = '12:15,15:15,18:15,21:15,23:45';
const QUIET_BEFORE_MIN = 5;
const QUIET_AFTER_MIN = 30;
/** One answer per serial is reused for a minute (a rescan, the FOUND panel reopening). */
const CACHE_MS = 60_000;
const FMP_TIMEOUT_MS = 5_000;
/** The test FileMaker answers a cold query in ~6 s (2026-11-20, UAT copy): it carries no shop traffic, so it may take longer. */
const UAT_TIMEOUT_MS = 15_000;
const PAUSE_MS = 10 * 60_000;
/** D183: how many units of one model in one branch are listed (more than this: the list says so). */
const UNITS_MAX = 200;

/** Where a serial is, as FileMaker sees it. */
type Found = { branchCode: string | null; branchName: string | null; status: string; upc: string | null };

export type SerialVerdict = 'here' | 'not-ready' | 'other-branch' | 'not-in-stock' | 'other-model';
/** D183: which FileMaker answered: the one orders go to now (ADMIN's switch, D130). */
export type SerialTarget = 'PRODUCTION' | 'UAT';
/** D183: the units of one model that FileMaker has ready in one branch. `taken` = already scanned into another open SES order. */
export interface BranchUnits {
  count: number;
  /** more than UNITS_MAX: only the first ones are listed */
  more: boolean;
  units: { sn: string; taken: string | null }[];
}
export type SerialCheckAnswer =
  | { status: 'off' | 'unavailable'; reason: string }
  | {
      status: 'ok';
      source: 'fmp';
      target: SerialTarget;
      /** When FileMaker was asked. */
      asOf: string | null;
      sn: string;
      verdict: SerialVerdict;
      branchCode?: string | null;
      branchName?: string | null;
      stockStatus?: string;
      /** D183: when the unit is not ready here, the part scanned for and what this branch does have of it (absent when unknown) */
      model?: string;
      branchUnits?: BranchUnits;
    };
export type BranchUnitsAnswer =
  | { status: 'off' | 'unavailable'; reason: string }
  | ({ status: 'ok'; source: 'fmp'; target: SerialTarget; asOf: string; model: string; branchCode: string } & BranchUnits);

/** Where to ask, by ADMIN's switch: the test FileMaker (`FMP_UAT_*`) or the real one over the ERP's OData (`ERP_ODATA_*`). */
type Source = { target: SerialTarget; cfg: ErpConfig; timeoutMs: number; quiet: boolean };

/**
 * D183: the OData address of the test FileMaker, from the Data API settings SES already sends orders with (`FMP_UAT_HOST`,
 * `FMP_UAT_DATABASE`, `FMP_UAT_USER`, `FMP_UAT_PASSWORD`). Null when one is missing or the host carries credentials.
 */
export function uatOdataConfig(config: ConfigService): ErpConfig | null {
  const host = (config.get<string>('FMP_UAT_HOST') ?? '').trim().replace(/\/+$/, '');
  const database = (config.get<string>('FMP_UAT_DATABASE') ?? '').trim();
  const user = (config.get<string>('FMP_UAT_USER') ?? '').trim();
  const pass = config.get<string>('FMP_UAT_PASSWORD') ?? '';
  if (!host || !database || !user || !pass) return null;
  try {
    const url = new URL(host);
    if (url.username || url.password) return null;
  } catch {
    return null;
  }
  return { baseUrl: `${host}/fmi/odata/v4/${encodeURIComponent(database)}`, user, pass };
}

/**
 * D104: STOCK scans a serial; SES says at once whether FileMaker has that very unit ready in this branch, in another branch
 * (e.g. a transfer not received yet), not ready, under another model (a wrong pick) or not at all. It only warns: scanning and
 * sending never wait for it. One serial per question, nothing else.
 *
 * Source (`SERIAL_CHECK`): `off` (default since D111: FileMaker's `ses` script, run when STOCK sends, is the one check; warroom is
 * no longer asked, its picture was hours old). `fmp` asks the ERP's OData live for the one serial; only once FileMaker has an index
 * on `ProductStore_detail::product_sn` (without it one such query did not answer in 30 s, 2026-11-05), and even then one request at
 * a time, 5 s, no retry, a 10-minute pause after a failure, never around warroom's pulls.
 *
 * D183: the check asks the FileMaker orders go to (ADMIN's switch, D130). While that is the test FileMaker (`uat`) it is always on:
 * the UAT copy carries no shop traffic, so the answer matches what its `ses` script will do. For the real FileMaker it still needs
 * `SERIAL_CHECK=fmp`. When the unit is not ready here, the answer also lists what the branch does have of that model (`branchUnits`),
 * and `GET /api/stock/branch-units` gives the same list for a serial FileMaker left off a held bill.
 */
@Injectable()
export class SerialCheckService {
  private readonly log = new Logger('SerialCheck');
  private readonly cache = new Map<string, { at: number; found: Found[]; asOf: string | null }>();
  private readonly unitsCache = new Map<string, { at: number; sns: string[]; asOf: string }>();
  private fmpQueue: Promise<unknown> = Promise.resolve();
  private readonly pausedUntil: Record<SerialTarget, number> = { PRODUCTION: 0, UAT: 0 };

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly settings: SettingsService,
  ) {}

  private enabled(): boolean {
    return (this.config.get<string>('SERIAL_CHECK') ?? '').trim().toLowerCase() === 'fmp';
  }

  /** D183: the FileMaker to ask, or why there is none. */
  private async source(): Promise<Source | { off: string }> {
    if ((await this.settings.fmpPushMode()) === 'uat') {
      const cfg = uatOdataConfig(this.config);
      if (!cfg) return { off: 'ยังไม่ได้ตั้งค่า FileMaker UAT (FMP_UAT_*)' };
      return { target: 'UAT', cfg, timeoutMs: UAT_TIMEOUT_MS, quiet: false };
    }
    if (!this.enabled()) return { off: 'ไม่ได้เปิดการตรวจ SN กับ FileMaker (FileMaker ตรวจตอนส่ง)' };
    const cfg = erpConfigFrom(this.config);
    if (!cfg) return { off: 'ยังไม่ได้ตั้งค่า ERP (ERP_ODATA_*)' };
    return { target: 'PRODUCTION', cfg, timeoutMs: FMP_TIMEOUT_MS, quiet: true };
  }

  private allowed(user: PublicAccount) {
    if (!(['STOCK', 'STAFF', 'ADMIN'] as const).some((role) => user.roles.includes(role)))
      throw new ForbiddenException('Access restricted to STOCK, STAFF or ADMIN');
  }

  private part(partRaw?: string): string | undefined {
    const part = partRaw?.trim() || undefined;
    if (part !== undefined && !/^[A-Za-z0-9./-]{1,64}$/.test(part)) throw new BadRequestException('part ไม่ถูกต้อง');
    return part;
  }

  /** The branch: the user's own; an ADMIN names one (an ADMIN without a branch must). */
  private async branchOf(user: PublicAccount, branchCode?: string) {
    const branch = user.roles.includes('ADMIN') && branchCode
      ? await this.prisma.branch.findFirst({ where: { code: branchCode.trim() } })
      : user.branchId
        ? await this.prisma.branch.findUnique({ where: { id: user.branchId } })
        : null;
    if (!branch) throw new BadRequestException('ไม่พบสาขา');
    return branch;
  }

  async check(user: PublicAccount, snRaw: string, partRaw?: string, branchCode?: string): Promise<SerialCheckAnswer> {
    this.allowed(user);
    const sn = (snRaw ?? '').trim().toUpperCase();
    if (!/^[\x21-\x7E]{1,64}$/.test(sn)) throw new BadRequestException('sn ไม่ถูกต้อง');
    const part = this.part(partRaw);
    const branch = await this.branchOf(user, branchCode);

    const src = await this.source();
    if ('off' in src) return { status: 'off', reason: src.off };

    let looked: { found: Found[]; asOf: string | null };
    try {
      looked = await this.fromFmp(src, sn);
    } catch (error) {
      return { status: 'unavailable', reason: error instanceof Error ? error.message : 'ตรวจกับสต็อกไม่ได้ตอนนี้' };
    }

    // the unit in this branch if the source has it there, else anywhere
    const mine = looked.found.find((f) => f.branchCode === branch.code) ?? looked.found[0];
    const base = { status: 'ok' as const, source: 'fmp' as const, target: src.target, asOf: looked.asOf, sn };
    // D183: not ready here: what the branch does have of this model (nothing when it cannot be told: no UPC, no ERP id, an error)
    const withUnits = async <T extends object>(answer: T) => {
      if (!part) return answer;
      const units = await this.unitsOf(src, part, branch.erpBranchId, sn).catch(() => null);
      return units ? { ...answer, model: part, branchUnits: units } : answer;
    };
    if (!mine) return withUnits({ ...base, verdict: 'not-in-stock' as const });
    if (part && !(await this.sameModel(part, mine)))
      return withUnits({ ...base, verdict: 'other-model' as const, branchCode: mine.branchCode });
    if (mine.branchCode !== branch.code)
      return withUnits({ ...base, verdict: 'other-branch' as const, branchCode: mine.branchCode, branchName: mine.branchName, stockStatus: mine.status });
    return mine.status.toLowerCase() === 'ready'
      ? { ...base, verdict: 'here' }
      : withUnits({ ...base, verdict: 'not-ready' as const, stockStatus: mine.status });
  }

  /**
   * D183: the units of one model FileMaker has ready in one branch, for a serial it left off a held bill (`snCheck`): "MJXQ4ZP/A:
   * 13 units here", and which. `GET /api/stock/branch-units?part=…[&branch=<code>, ADMIN]`.
   */
  async branchUnits(user: PublicAccount, partRaw?: string, branchCode?: string): Promise<BranchUnitsAnswer> {
    this.allowed(user);
    const part = this.part(partRaw);
    if (!part) throw new BadRequestException('ต้องระบุ part');
    const branch = await this.branchOf(user, branchCode);
    const src = await this.source();
    if ('off' in src) return { status: 'off', reason: src.off };
    try {
      const units = await this.unitsOf(src, part, branch.erpBranchId);
      if (!units) return { status: 'unavailable', reason: 'รุ่นนี้ยังไม่มีบาร์โค้ด (UPC) ใน SES หรือสาขานี้ยังไม่ผูกกับ ERP' };
      const asOf = this.unitsCache.get(this.unitsKey(src, part, branch.erpBranchId))?.asOf ?? new Date().toISOString();
      return { status: 'ok', source: 'fmp', target: src.target, asOf, model: part, branchCode: branch.code, ...units };
    } catch (error) {
      return { status: 'unavailable', reason: error instanceof Error ? error.message : 'ถาม FileMaker ไม่ได้ตอนนี้' };
    }
  }

  private unitsKey(src: Source, part: string, erpBranchId: number | null) {
    return `${src.target}:${part}:${erpBranchId}`;
  }

  /**
   * D183: FileMaker's ready units of the part (by its UPC in SES's catalog, as `sameModel`) in the branch (by its ERP id), one
   * request, cached for a minute; each marked when another open SES order already holds it (D92). Null when the part has no UPC or
   * the branch no ERP id. `except` (the serial just scanned) is never listed as a choice.
   */
  private async unitsOf(src: Source, part: string, erpBranchId: number | null, except?: string): Promise<BranchUnits | null> {
    if (erpBranchId === null || erpBranchId === undefined) return null;
    const sku = await this.prisma.productSku.findFirst({ where: { sku: part, upc: { not: null } }, select: { upc: true } });
    const upc = sku?.upc?.trim();
    if (!upc || !/^[A-Za-z0-9-]{1,64}$/.test(upc)) return null;
    const key = this.unitsKey(src, part, erpBranchId);
    let hit = this.unitsCache.get(key);
    if (!hit || Date.now() - hit.at >= CACHE_MS) {
      const filter = `product_upc eq '${upc}' and BranchStore_id eq ${Number(erpBranchId)} and status eq 'ready'`;
      const rows = await this.askFmp(src, `$filter=${encodeURIComponent(filter)}&$select=product_sn&$top=${UNITS_MAX + 1}`, 'units of a model');
      const sns = [...new Set(rows.map((row) => String((row as { product_sn?: unknown }).product_sn ?? '').trim().toUpperCase()).filter(Boolean))].sort();
      hit = { at: Date.now(), sns, asOf: new Date().toISOString() };
      this.unitsCache.set(key, hit);
    }
    const listed = hit.sns.filter((sn) => sn !== except).slice(0, UNITS_MAX);
    const held = listed.length
      ? await this.prisma.sessionItemSerial.findMany({
          where: { sn: { in: listed }, item: { session: { outcome: null, state: { not: 'COMPLETED' } } } },
          select: { sn: true, item: { select: { session: { select: { reference: true, queueLetter: true, queueNo: true } } } } },
        })
      : [];
    const takenBy = new Map(
      held.map((one) => {
        const s = one.item.session;
        return [one.sn, s.queueNo === null ? s.reference : formatQueue(s.queueLetter, s.queueNo)] as const;
      }),
    );
    return {
      count: hit.sns.filter((sn) => sn !== except).length,
      more: hit.sns.length > UNITS_MAX,
      units: listed.map((sn) => ({ sn, taken: takenBy.get(sn) ?? null })),
    };
  }

  /** The part number scanned against the unit's barcode (the UPC of SES's catalog). */
  private async sameModel(part: string, unit: Found): Promise<boolean> {
    if (!unit.upc) return true;
    const sku = await this.prisma.productSku.findFirst({ where: { sku: part, upc: { not: null } }, select: { upc: true } });
    return !sku?.upc || sku.upc.trim() === unit.upc;
  }

  private cached(key: string) {
    const hit = this.cache.get(key);
    return hit && Date.now() - hit.at < CACHE_MS ? hit : null;
  }

  /** FileMaker live (only with an index on product_sn): one serial, four columns, under every ERP guard. */
  private async fromFmp(src: Source, sn: string) {
    const key = `${src.target}:${sn}`;
    const hit = this.cached(key);
    if (hit) return hit;
    const rows = await this.askFmp(src, `$filter=${encodeURIComponent(`product_sn eq '${sn.replace(/'/g, "''")}'`)}&$select=product_sn,BranchStore_id,status,product_upc&$top=3`, 'by serial');
    const units = rows.map((row) => row as { BranchStore_id?: unknown; status?: unknown; product_upc?: unknown });
    const ids = units.map((u) => Number(u.BranchStore_id)).filter((id) => Number.isInteger(id));
    const branches = await this.prisma.branch.findMany({ where: { erpBranchId: { in: ids } }, select: { code: true, name: true, erpBranchId: true } });
    const out = {
      asOf: new Date().toISOString(),
      found: units.map((u) => {
        const b = branches.find((one) => one.erpBranchId === Number(u.BranchStore_id));
        return {
          branchCode: b?.code ?? (u.BranchStore_id == null ? null : `#${String(u.BranchStore_id)}`),
          branchName: b?.name ?? null,
          status: String(u.status ?? ''),
          upc: u.product_upc == null ? null : String(u.product_upc).trim(),
        };
      }),
    };
    this.cache.set(key, { at: Date.now(), ...out });
    return out;
  }

  /**
   * One FileMaker request at a time, never in a pause; a failure pauses that FileMaker for 10 minutes. The real one is also left
   * alone around warroom's pulls (the test FileMaker is not what warroom reads).
   */
  private askFmp(src: Source, query: string, what: string): Promise<unknown[]> {
    const run = async () => {
      if (Date.now() < this.pausedUntil[src.target]) throw new Error('FileMaker ตอบช้าหรือผิดพลาด พักการตรวจ 10 นาที');
      if (src.quiet) {
        const quiet = quietWindow(new Date(), this.config.get<string>('SERIAL_CHECK_QUIET') ?? WARROOM_SLOTS);
        if (quiet) throw new Error(`งดถาม FileMaker ช่วงที่ warroom ดึงข้อมูล (${quiet})`);
      }
      const started = Date.now();
      try {
        const rows = await odataRows(src.cfg, 'ProductStore_detail', query, src.timeoutMs, 1);
        this.log.log(`ProductStore_detail ${what} (${src.target}): ${rows.length} rows in ${Date.now() - started} ms`);
        return rows;
      } catch (error) {
        this.pausedUntil[src.target] = Date.now() + PAUSE_MS;
        this.log.warn(`ProductStore_detail ${what} (${src.target}) failed after ${Date.now() - started} ms; pausing for 10 minutes`);
        throw error;
      }
    };
    const next = this.fmpQueue.then(run, run);
    this.fmpQueue = next.catch(() => undefined);
    return next;
  }
}

/** The slot this moment is close to (from 5 minutes before to 30 after), or null. Bangkok time, UTC+7 all year. */
export function quietWindow(at: Date, slots: string): string | null {
  const minutes = (at.getUTCHours() * 60 + at.getUTCMinutes() + 7 * 60) % 1440;
  for (const slot of slots.split(',').map((one) => one.trim()).filter((one) => /^\d{1,2}:\d{2}$/.test(one))) {
    const [h, m] = slot.split(':').map(Number);
    const start = h * 60 + m;
    const delta = (minutes - start + 1440) % 1440;
    if (delta <= QUIET_AFTER_MIN || 1440 - delta <= QUIET_BEFORE_MIN) return slot;
  }
  return null;
}
