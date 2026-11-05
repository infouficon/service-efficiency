import { BadRequestException, ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import type { PublicAccount } from '../accounts/accounts.service';
import { erpConfigFrom, odataRows, type ErpConfig } from './erp-sync.service';

/**
 * Warroom pulls the whole stock from the ERP at these Bangkok times (erp-integration.md); SES stays off the ERP around them.
 * `FMP_UNIT_CHECK_QUIET` overrides the list (comma separated HH:MM; empty = none) if warroom's schedule changes.
 */
const WARROOM_SLOTS = '12:15,15:15,18:15,21:15,23:45';
const QUIET_BEFORE_MIN = 5;
const QUIET_AFTER_MIN = 30;
/** How long one answer is reused: a shop scanning several units of one model asks the ERP once. */
const CACHE_MS = 60_000;
/** One request may take this long; a timeout is final and pauses the check (the ERP is busy, the shops sell on it). */
const TIMEOUT_MS = 5_000;
const PAUSE_MS = 10 * 60_000;

type Unit = { sn: string; branchId: number | null; status: string };
export type FmpUnitVerdict = 'here' | 'other-branch' | 'not-ready';

export type FmpUnitsAnswer =
  | { status: 'off' | 'unavailable'; reason: string }
  | {
      status: 'ok';
      checkedAt: string;
      part: string;
      upc: string;
      branch: { code: string; erpBranchId: number };
      /** The serials FileMaker holds as `ready` in this branch, for STOCK to pick from. */
      here: string[];
      /** Ready units of the model in other branches (counts only). */
      elsewhere: { branchCode: string | null; erpBranchId: number | null; count: number }[];
      /** The verdict on one scanned serial, when asked. */
      sn?: { sn: string; verdict: FmpUnitVerdict; branchCode?: string | null; branchName?: string | null };
    };

/**
 * D104: what FileMaker (the ERP, over OData) holds right now as `ready` for one model, so STOCK sees at the shelf whether a scanned
 * serial will pass FileMaker's `ses` script (in this branch / still in another branch, e.g. a transfer not received / not ready at
 * all), and can pick from the units FileMaker has here. It only warns: scanning and sending never wait for it.
 *
 * The ERP is the shops' live FileMaker, so the check is careful by construction: it filters on the indexed UPC (never on the serial:
 * `product_sn` has no index and one such query did not answer in 30 s), asks for three columns, sends one request at a time with no
 * retry and a 5 s timeout, pauses for 10 minutes after any failure, keeps off the ERP around warroom's pulls, and reuses an answer for
 * a minute. `FMP_UNIT_CHECK=off` switches it off.
 */
@Injectable()
export class FmpUnitsService {
  private readonly log = new Logger('FmpUnits');
  private readonly cache = new Map<string, { at: number; units: Unit[] }>();
  private readonly upcByPart = new Map<string, string>();
  private queue: Promise<unknown> = Promise.resolve();
  private pausedUntil = 0;
  private pauseReason = '';

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  private cfg(): ErpConfig | null {
    if ((this.config.get<string>('FMP_UNIT_CHECK') ?? 'on').trim().toLowerCase() === 'off') return null;
    return erpConfigFrom(this.config);
  }

  async check(user: PublicAccount, partRaw: string, snRaw?: string, branchCode?: string): Promise<FmpUnitsAnswer> {
    if (!(['STOCK', 'CASHIER', 'ADMIN'] as const).some((role) => user.roles.includes(role)))
      throw new ForbiddenException('Access restricted to STOCK, CASHIER or ADMIN');
    const part = (partRaw ?? '').trim();
    if (!/^[A-Za-z0-9./-]{1,64}$/.test(part)) throw new BadRequestException('part ไม่ถูกต้อง');
    const sn = snRaw?.trim().toUpperCase() || undefined;
    if (sn !== undefined && !/^[\x21-\x7E]{1,64}$/.test(sn)) throw new BadRequestException('sn ไม่ถูกต้อง');

    // the branch: the user's own; an ADMIN without one names it
    const branch = user.roles.includes('ADMIN') && branchCode
      ? await this.prisma.branch.findFirst({ where: { code: branchCode.trim() } })
      : user.branchId
        ? await this.prisma.branch.findUnique({ where: { id: user.branchId } })
        : null;
    if (!branch) throw new BadRequestException('ไม่พบสาขา');
    if (branch.erpBranchId === null) return { status: 'unavailable', reason: 'สาขานี้ไม่ได้มาจาก ERP จึงเทียบกับ FileMaker ไม่ได้' };

    const cfg = this.cfg();
    if (!cfg) return { status: 'off', reason: 'ไม่ได้เปิดการตรวจกับ FileMaker' };

    let units: Unit[];
    let upc: string;
    try {
      upc = await this.upcOf(cfg, part);
      units = await this.readyUnits(cfg, upc);
    } catch (error) {
      return { status: 'unavailable', reason: error instanceof Error ? error.message : 'ตรวจกับ FileMaker ไม่ได้ตอนนี้' };
    }

    const branches = await this.prisma.branch.findMany({
      where: { erpBranchId: { in: [...new Set(units.map((u) => u.branchId).filter((id): id is number => id !== null))] } },
      select: { code: true, name: true, erpBranchId: true },
    });
    const byErpId = new Map(branches.map((b) => [b.erpBranchId, b]));
    const counts = new Map<number | null, number>();
    for (const unit of units) if (unit.branchId !== branch.erpBranchId) counts.set(unit.branchId, (counts.get(unit.branchId) ?? 0) + 1);

    let verdict: Extract<FmpUnitsAnswer, { status: 'ok' }>['sn'];
    if (sn) {
      const unit = units.find((u) => u.sn === sn);
      const where = unit && unit.branchId !== null ? byErpId.get(unit.branchId) : undefined;
      verdict = !unit
        ? { sn, verdict: 'not-ready' }
        : unit.branchId === branch.erpBranchId
          ? { sn, verdict: 'here' }
          : { sn, verdict: 'other-branch', branchCode: where?.code ?? null, branchName: where?.name ?? null };
    }

    return {
      status: 'ok',
      checkedAt: new Date(this.cache.get(upc)?.at ?? Date.now()).toISOString(),
      part,
      upc,
      branch: { code: branch.code, erpBranchId: branch.erpBranchId },
      here: units.filter((u) => u.branchId === branch.erpBranchId).map((u) => u.sn),
      elsewhere: [...counts].map(([erpBranchId, count]) => ({ erpBranchId, branchCode: (erpBranchId !== null && byErpId.get(erpBranchId)?.code) || null, count })),
      ...(verdict ? { sn: verdict } : {}),
    };
  }

  /** The UPC of a part number: SES's catalog (warroom's barcode) first, else FileMaker's `ProductStore`, remembered. */
  private async upcOf(cfg: ErpConfig, part: string): Promise<string> {
    const known = this.upcByPart.get(part);
    if (known) return known;
    const sku = await this.prisma.productSku.findFirst({ where: { sku: part, upc: { not: null } }, select: { upc: true } });
    let upc = sku?.upc?.trim() ?? '';
    if (!upc) {
      const rows = await this.ask(cfg, 'ProductStore', `$filter=${encodeURIComponent(`product_model eq '${odataString(part)}'`)}&$select=Product_upc&$top=1`);
      upc = String((rows[0] as { Product_upc?: unknown } | undefined)?.Product_upc ?? '').trim();
    }
    if (!/^[0-9A-Za-z-]{6,64}$/.test(upc)) throw new Error('ไม่พบบาร์โค้ด (UPC) ของรุ่นนี้ใน FileMaker');
    this.upcByPart.set(part, upc);
    return upc;
  }

  private async readyUnits(cfg: ErpConfig, upc: string): Promise<Unit[]> {
    const hit = this.cache.get(upc);
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.units;
    const filter = `product_upc eq '${odataString(upc)}' and status eq 'ready'`;
    const rows = await this.ask(cfg, 'ProductStore_detail', `$filter=${encodeURIComponent(filter)}&$select=product_sn,BranchStore_id,status`);
    const units = rows
      .map((row) => row as { product_sn?: unknown; BranchStore_id?: unknown; status?: unknown })
      .filter((row) => typeof row.product_sn === 'string' && row.product_sn.trim())
      .map((row) => ({
        sn: String(row.product_sn).trim().toUpperCase(),
        branchId: Number.isFinite(Number(row.BranchStore_id)) ? Number(row.BranchStore_id) : null,
        status: String(row.status ?? ''),
      }));
    this.cache.set(upc, { at: Date.now(), units });
    return units;
  }

  /** One ERP request at a time, never in a quiet window or a pause; a failure pauses every check for 10 minutes. */
  private ask(cfg: ErpConfig, entity: string, query: string): Promise<unknown[]> {
    const run = async () => {
      const now = Date.now();
      if (now < this.pausedUntil) throw new Error(`ตรวจกับ FileMaker ไม่ได้ตอนนี้ (${this.pauseReason})`);
      const quiet = quietWindow(new Date(now), this.config.get<string>('FMP_UNIT_CHECK_QUIET') ?? WARROOM_SLOTS);
      if (quiet) throw new Error(`งดตรวจกับ FileMaker ช่วงที่ warroom ดึงข้อมูล (${quiet})`);
      const started = Date.now();
      try {
        const rows = await odataRows(cfg, entity, query, TIMEOUT_MS, 1);
        this.log.log(`${entity}: ${rows.length} rows in ${Date.now() - started} ms`);
        return rows;
      } catch (error) {
        this.pausedUntil = Date.now() + PAUSE_MS;
        this.pauseReason = 'FileMaker ตอบช้าหรือผิดพลาด พักการตรวจ 10 นาที';
        this.log.warn(`${entity} failed after ${Date.now() - started} ms; pausing for 10 minutes`);
        throw error;
      }
    };
    const next = this.queue.then(run, run);
    this.queue = next.catch(() => undefined);
    return next;
  }
}

/** A string inside an OData literal: a single quote is doubled. */
function odataString(value: string): string {
  return value.replace(/'/g, "''");
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
