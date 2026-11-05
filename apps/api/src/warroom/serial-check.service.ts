import { BadRequestException, ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import type { PublicAccount } from '../accounts/accounts.service';
import { erpConfigFrom, odataRows, type ErpConfig } from '../erp/erp-sync.service';
import { withWarroom } from './warroom-sync.service';

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
const PAUSE_MS = 10 * 60_000;

/** Where a serial is, as one source sees it. */
type Found = { branchCode: string | null; branchName: string | null; status: string; model: string | null; upc: string | null };

export type SerialVerdict = 'here' | 'not-ready' | 'other-branch' | 'not-in-stock' | 'other-model';
export type SerialCheckAnswer =
  | { status: 'off' | 'unavailable'; reason: string }
  | {
      status: 'ok';
      source: 'warroom' | 'fmp';
      /** How old the source's picture is (warroom's last snapshot; FileMaker: now). */
      asOf: string | null;
      sn: string;
      verdict: SerialVerdict;
      branchCode?: string | null;
      branchName?: string | null;
      stockStatus?: string;
      model?: string | null;
    };

/**
 * D104: STOCK scans a serial; SES says at once whether the stock data has that very unit ready in this branch, in another branch
 * (e.g. a transfer not received yet), not ready, under another model (a wrong pick) or not at all. It only warns: scanning and
 * sending never wait for it. One serial per question, nothing else.
 *
 * Source (`SERIAL_CHECK`): `warroom` (default) reads warroom's `mart.stock_current` (current stock only, ~88k rows; nothing reaches
 * FileMaker; up to ~3 h behind, 12.5 h overnight, so the answer carries its snapshot time). `fmp` asks the ERP's OData live for the
 * one serial; only once FileMaker has an index on `ProductStore_detail::product_sn` (without it one such query did not answer in 30 s,
 * 2026-11-05), and even then one request at a time, 5 s, no retry, a 10-minute pause after a failure, never around warroom's pulls.
 * `off` switches it off.
 */
@Injectable()
export class SerialCheckService {
  private readonly log = new Logger('SerialCheck');
  private readonly cache = new Map<string, { at: number; found: Found[]; asOf: string | null }>();
  private fmpQueue: Promise<unknown> = Promise.resolve();
  private pausedUntil = 0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  private source(): 'warroom' | 'fmp' | 'off' {
    const value = (this.config.get<string>('SERIAL_CHECK') ?? 'warroom').trim().toLowerCase();
    return value === 'fmp' || value === 'off' ? value : 'warroom';
  }

  async check(user: PublicAccount, snRaw: string, partRaw?: string, branchCode?: string): Promise<SerialCheckAnswer> {
    if (!(['STOCK', 'STAFF', 'ADMIN'] as const).some((role) => user.roles.includes(role)))
      throw new ForbiddenException('Access restricted to STOCK, STAFF or ADMIN');
    const sn = (snRaw ?? '').trim().toUpperCase();
    if (!/^[\x21-\x7E]{1,64}$/.test(sn)) throw new BadRequestException('sn ไม่ถูกต้อง');
    const part = partRaw?.trim() || undefined;
    if (part !== undefined && !/^[A-Za-z0-9./-]{1,64}$/.test(part)) throw new BadRequestException('part ไม่ถูกต้อง');

    // the branch: the user's own; an ADMIN without one names it
    const branch = user.roles.includes('ADMIN') && branchCode
      ? await this.prisma.branch.findFirst({ where: { code: branchCode.trim() } })
      : user.branchId
        ? await this.prisma.branch.findUnique({ where: { id: user.branchId } })
        : null;
    if (!branch) throw new BadRequestException('ไม่พบสาขา');

    const source = this.source();
    if (source === 'off') return { status: 'off', reason: 'ไม่ได้เปิดการตรวจ SN กับสต็อก' };

    let looked: { found: Found[]; asOf: string | null };
    try {
      looked = source === 'warroom' ? await this.fromWarroom(sn) : await this.fromFmp(sn);
    } catch (error) {
      return { status: 'unavailable', reason: error instanceof Error ? error.message : 'ตรวจกับสต็อกไม่ได้ตอนนี้' };
    }

    // the unit in this branch if the source has it there, else anywhere
    const mine = looked.found.find((f) => f.branchCode === branch.code) ?? looked.found[0];
    const base = { status: 'ok' as const, source, asOf: looked.asOf, sn };
    if (!mine) return { ...base, verdict: 'not-in-stock' };
    if (part && !(await this.sameModel(part, mine)))
      return { ...base, verdict: 'other-model', model: mine.model, branchCode: mine.branchCode };
    if (mine.branchCode !== branch.code)
      return { ...base, verdict: 'other-branch', branchCode: mine.branchCode, branchName: mine.branchName, stockStatus: mine.status };
    return mine.status.toLowerCase() === 'ready'
      ? { ...base, verdict: 'here' }
      : { ...base, verdict: 'not-ready', stockStatus: mine.status };
  }

  /** The part number scanned against the unit's model (warroom) or its barcode (FileMaker: the UPC of SES's catalog). */
  private async sameModel(part: string, unit: Found): Promise<boolean> {
    if (unit.model) return unit.model.toLowerCase() === part.toLowerCase();
    if (!unit.upc) return true;
    const sku = await this.prisma.productSku.findFirst({ where: { sku: part, upc: { not: null } }, select: { upc: true } });
    return !sku?.upc || sku.upc.trim() === unit.upc;
  }

  private cached(key: string) {
    const hit = this.cache.get(key);
    return hit && Date.now() - hit.at < CACHE_MS ? hit : null;
  }

  /** Warroom: one indexed-or-not lookup in a table of current stock only (tens of ms), read-only, 3 s at most. */
  private async fromWarroom(sn: string) {
    const key = `warroom:${sn}`;
    const hit = this.cached(key);
    if (hit) return hit;
    const url = (this.config.get<string>('WARROOM_DATABASE_URL') ?? '').trim();
    if (!url) throw new Error('ยังไม่ได้ตั้งค่า WARROOM_DATABASE_URL');
    const out = await withWarroom(
      url,
      async (client) => {
        const rows = await client.query<{ branch_code: string | null; branch_name: string | null; status: string | null; product_model: string | null }>(
          'SELECT branch_code, branch_name, status, product_model FROM mart.stock_current WHERE upper(product_sn) = $1 LIMIT 3',
          [sn],
        );
        let asOf: string | null = null;
        try {
          const fresh = await client.query<{ at: Date | null }>('SELECT max(snapshot_at) AS at FROM mart.stock_mv');
          const at = fresh.rows[0]?.at;
          asOf = at instanceof Date ? at.toISOString() : null;
        } catch {
          // the snapshot time is a nicety; the lookup above already answered
        }
        return {
          asOf,
          found: rows.rows.map((r) => ({
            branchCode: r.branch_code,
            branchName: r.branch_name,
            status: r.status ?? '',
            model: r.product_model,
            upc: null,
          })),
        };
      },
      { connectMs: 3_000, statementMs: 2_000, name: 'ses-serial-check' },
    ).catch((error: unknown) => {
      this.log.warn(`warroom lookup failed: ${error instanceof Error ? error.name : 'error'}`);
      throw new Error('ตรวจกับข้อมูลสต็อก (warroom) ไม่ได้ตอนนี้');
    });
    this.cache.set(key, { at: Date.now(), ...out });
    return out;
  }

  /** FileMaker live (only with an index on product_sn): one serial, four columns, under every ERP guard. */
  private async fromFmp(sn: string) {
    const key = `fmp:${sn}`;
    const hit = this.cached(key);
    if (hit) return hit;
    const cfg = erpConfigFrom(this.config);
    if (!cfg) throw new Error('ยังไม่ได้ตั้งค่า ERP (ERP_ODATA_*)');
    const rows = await this.askFmp(cfg, `$filter=${encodeURIComponent(`product_sn eq '${sn.replace(/'/g, "''")}'`)}&$select=product_sn,BranchStore_id,status,product_upc&$top=3`);
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
          model: null,
          upc: u.product_upc == null ? null : String(u.product_upc).trim(),
        };
      }),
    };
    this.cache.set(key, { at: Date.now(), ...out });
    return out;
  }

  /** One ERP request at a time, never in a quiet window or a pause; a failure pauses the FileMaker check for 10 minutes. */
  private askFmp(cfg: ErpConfig, query: string): Promise<unknown[]> {
    const run = async () => {
      if (Date.now() < this.pausedUntil) throw new Error('FileMaker ตอบช้าหรือผิดพลาด พักการตรวจ 10 นาที');
      const quiet = quietWindow(new Date(), this.config.get<string>('SERIAL_CHECK_QUIET') ?? WARROOM_SLOTS);
      if (quiet) throw new Error(`งดถาม FileMaker ช่วงที่ warroom ดึงข้อมูล (${quiet})`);
      const started = Date.now();
      try {
        const rows = await odataRows(cfg, 'ProductStore_detail', query, FMP_TIMEOUT_MS, 1);
        this.log.log(`ProductStore_detail by serial: ${rows.length} rows in ${Date.now() - started} ms`);
        return rows;
      } catch (error) {
        this.pausedUntil = Date.now() + PAUSE_MS;
        this.log.warn(`ProductStore_detail by serial failed after ${Date.now() - started} ms; pausing for 10 minutes`);
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
