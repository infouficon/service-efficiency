import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, type ProductCategory } from '@prisma/client';
import { Client } from 'pg';
import {
  ErpSyncService,
  toDto,
  type ErpSyncRunDto,
} from '../erp/erp-sync.service';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Products and stock from the warroom database (D52).
 *
 * Warroom already pulls the ERP (5 times a day, see docs/agents/erp-integration.md §2) into Postgres; SES reads
 * `mart.stock_mv` from there with a READ ONLY connection instead of calling the ERP itself. Every ~10 minutes it
 * peeks at the snapshot time and, when a newer snapshot exists, stores per branch+SKU `erpReady` / `erpTransfer` /
 * `erpAsOf` on BranchInventory. What staff see is computed in ProductsService (ERP ready minus what SES already
 * promised since the snapshot).
 *
 * Modes (WARROOM_STOCK_MODE): `off` | `shadow` (default: stores the numbers for SKUs SES already has, changes
 * nothing staff can see, creates no catalog) | `on` (creates/updates catalog items, the ERP numbers are used).
 * Nothing runs unless WARROOM_DATABASE_URL is set.
 */

export type WarroomMode = 'off' | 'shadow' | 'on';
const KIND = 'warroom-products';
const TICK_MS = 60_000;
const FIRST_TICK_MS = 15_000;
const CHUNK = 500;
const NOTE_LIMIT = 50;
/** A session that reached FOUND holds one unit for this long unless it ended (D52). */
export const RESERVATION_HOURS = 24;

export function parseMode(value: string | undefined | null): WarroomMode {
  const v = (value ?? '').trim().toLowerCase();
  return v === 'off' || v === 'on' || v === 'shadow' ? v : 'shadow';
}

/** The effective mode: `off` whenever no warroom database is configured. */
export function warroomMode(config: ConfigService): WarroomMode {
  const url = (config.get<string>('WARROOM_DATABASE_URL') ?? '').trim();
  if (!url) return 'off';
  return parseMode(config.get<string>('WARROOM_STOCK_MODE'));
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export interface WarroomRow {
  branchCode: string;
  partNo: string;
  upc: string | null;
  productName: string | null;
  cat: string | null;
  subcat: string | null;
  subsubcat: string | null;
  capacity: string | null;
  color: string | null;
  ready: number;
  transfer: number;
  snapshotAt: Date;
}
export interface CatalogItem {
  partNo: string;
  category: ProductCategory;
  productName: string;
  modelName: string;
  skuName: string;
  color: string | null;
  storage: string | null;
}
export interface CategoryTally {
  value: string;
  mapped: ProductCategory | null;
  parts: number;
}
export interface WarroomSummary {
  mode: WarroomMode;
  asOf: string | null;
  rows: number;
  parts: number;
  branches: {
    matched: number;
    unknown: { code: string; rows: number }[];
  };
  catalog: {
    existing: number;
    created: number;
    wouldCreate: number;
    updated: number;
    skippedNoCategory: number;
    categories: CategoryTally[];
    unmapped: { value: string; parts: number }[];
  };
  stock: {
    updatedRows: number;
    zeroedRows: number;
    readyUnits: number;
    transferUnits: number;
  };
}
export type WarroomRunDto = Omit<ErpSyncRunDto, 'summary'> & {
  summary: WarroomSummary | null;
};

// ---------------------------------------------------------------------------
// Pure rules (unit tested without a database)
// ---------------------------------------------------------------------------
/**
 * ERP category text -> SES ProductCategory. Accessory words win over device words ("iPhone Case" is an accessory).
 * Anything unrecognised is NOT guessed: the part is skipped and the text is listed in the run summary so the
 * rules can be fixed after the first dry run.
 */
export function mapCategory(
  value: string | null | undefined,
): ProductCategory | null {
  const v = (value ?? '').trim().toLowerCase();
  if (!v) return null;
  if (
    /accessor|airpods|airtag|beats|homepod|apple\s*tv|apple\s*care|applecare|\bcase\b|cover|charger|cable|adapter|pencil|keyboard|mouse|trackpad|strap|\bband\b|protect|film|glass/.test(
      v,
    )
  )
    return 'Accessories';
  if (/iphone/.test(v)) return 'iPhone';
  if (/ipad/.test(v)) return 'iPad';
  if (/watch/.test(v)) return 'Watch';
  if (/mac/.test(v)) return 'Mac';
  return null;
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');

/** "Apple MG8G4ZP/A iPhone 17 256GB White" -> "iPhone 17 256GB White" (same rule as warroom's short_name). */
export function shortName(name: string | null, partNo: string): string {
  const n = (name ?? '').trim();
  const stripped = n
    .replace(new RegExp(`^Apple\\s+${escapeRegExp(partNo)}\\s+`, 'i'), '')
    .replace(/^Apple\s+\S+\/A\s+/i, '')
    .trim();
  return stripped || n || partNo;
}

const clean = (v: string | null | undefined, max: number): string | null => {
  const t = (v ?? '').trim();
  return t ? t.slice(0, max) : null;
};

/** One catalog item per part number from the warroom rows (first non-empty attribute wins). */
export function buildCatalog(rows: WarroomRow[]): {
  items: CatalogItem[];
  categories: CategoryTally[];
  skippedNoCategory: number;
} {
  const byPart = new Map<string, WarroomRow[]>();
  for (const r of rows) {
    const list = byPart.get(r.partNo);
    if (list) list.push(r);
    else byPart.set(r.partNo, [r]);
  }
  const tally = new Map<string, CategoryTally>();
  const items: CatalogItem[] = [];
  let skippedNoCategory = 0;
  const first = (rs: WarroomRow[], pick: (r: WarroomRow) => string | null) =>
    rs.map(pick).find((v) => (v ?? '').trim() !== '') ?? null;
  for (const [partNo, rs] of [...byPart.entries()].sort((a, b) =>
    a[0].localeCompare(b[0]),
  )) {
    const cat = first(rs, (r) => r.cat);
    const subcat = first(rs, (r) => r.subcat);
    const subsubcat = first(rs, (r) => r.subsubcat);
    const name = first(rs, (r) => r.productName);
    // The sub-category is only a fallback for an EMPTY category: an unrecognised category ("Huawei Phone") must not be
    // rescued by a model-looking sub-category.
    const category = clean(cat, 100) ? mapCategory(cat) : mapCategory(subcat);
    const label = clean(cat, 100) ?? clean(subcat, 100) ?? '(ว่าง)';
    const key = `${label}\u0000${category ?? ''}`;
    const t = tally.get(key) ?? { value: label, mapped: category, parts: 0 };
    t.parts += 1;
    tally.set(key, t);
    if (!category) {
      skippedNoCategory += 1;
      continue;
    }
    const productName = clean(subcat, 191) ?? clean(cat, 191) ?? 'ไม่ระบุ';
    items.push({
      partNo,
      category,
      productName,
      modelName: clean(subsubcat, 191) ?? productName,
      skuName: shortName(name, partNo).slice(0, 191),
      color: clean(
        first(rs, (r) => r.color),
        64,
      ),
      storage: clean(
        first(rs, (r) => r.capacity),
        64,
      ),
    });
  }
  return {
    items,
    categories: [...tally.values()].sort((a, b) => b.parts - a.parts),
    skippedNoCategory,
  };
}

/** Strips anything that looks like a connection string before an error is stored or returned. */
export function safeMessage(error: unknown): string {
  const m = error instanceof Error ? error.message : String(error);
  return m.replace(/postgres(?:ql)?:\/\/\S+/gi, '[url]').slice(0, 500);
}

// ---------------------------------------------------------------------------
// Warroom reader (read-only Postgres)
// ---------------------------------------------------------------------------
async function withWarroom<T>(
  url: string,
  work: (client: Client) => Promise<T>,
): Promise<T> {
  const client = new Client({
    connectionString: url,
    connectionTimeoutMillis: 10_000,
    statement_timeout: 20_000,
    query_timeout: 25_000,
    application_name: 'ses-warroom-sync',
  });
  await client.connect();
  try {
    await client.query('BEGIN READ ONLY');
    const out = await work(client);
    await client.query('COMMIT');
    return out;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    await client.end().catch(() => undefined);
  }
}

const rowsSql = (withAttrs: boolean) => `
  SELECT s.branch_code, s.product_model AS part_no, s.product_upc AS upc,
         max(s.product_name) AS product_name, max(s.product_cat) AS cat,
         max(s.product_subcat) AS subcat, max(s.product_subsubcat) AS subsubcat,
         ${withAttrs ? 'max(s.capacity) AS capacity, max(s.color) AS color,' : 'NULL::text AS capacity, NULL::text AS color,'}
         COALESCE(sum(s.qty) FILTER (WHERE s.stock_type = 'ready'), 0)::int AS ready,
         COALESCE(sum(s.qty) FILTER (WHERE s.stock_type = 'transfer'), 0)::int AS transfer,
         max(s.snapshot_at) AS snapshot_at
    FROM mart.stock_mv s
   WHERE COALESCE(btrim(s.branch_code), '') <> '' AND COALESCE(btrim(s.product_model), '') <> ''
   GROUP BY s.branch_code, s.product_model, s.product_upc`;

type RawRow = Record<string, unknown>;
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);

function toRow(r: RawRow): WarroomRow | null {
  const branchCode = (str(r.branch_code) ?? '').trim();
  const partNo = (str(r.part_no) ?? '').trim();
  const snap = r.snapshot_at;
  if (!branchCode || !partNo || partNo.length > 64 || !(snap instanceof Date))
    return null;
  return {
    branchCode,
    partNo,
    upc: str(r.upc),
    productName: str(r.product_name),
    cat: str(r.cat),
    subcat: str(r.subcat),
    subsubcat: str(r.subsubcat),
    capacity: str(r.capacity),
    color: str(r.color),
    ready: Math.max(0, Number(r.ready) || 0),
    transfer: Math.max(0, Number(r.transfer) || 0),
    snapshotAt: snap,
  };
}

/** Newest snapshot time in the warroom stock table: one tiny query. */
export async function peekSnapshot(url: string): Promise<Date | null> {
  return withWarroom(url, async (c) => {
    const res = await c.query<{ as_of: Date | null }>(
      'SELECT max(snapshot_at) AS as_of FROM mart.stock_mv',
    );
    return res.rows[0]?.as_of ?? null;
  });
}

export async function readRows(url: string): Promise<WarroomRow[]> {
  const run = (withAttrs: boolean) =>
    withWarroom(url, (c) => c.query<RawRow>(rowsSql(withAttrs)));
  let res;
  try {
    res = await run(true);
  } catch (error) {
    // An older stock_mv without the capacity/color columns still works (without those attributes).
    if ((error as { code?: string }).code !== '42703') throw error;
    res = await run(false);
  }
  const rows: WarroomRow[] = [];
  for (const raw of res.rows) {
    const row = toRow(raw);
    if (row) rows.push(row);
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------
@Injectable()
export class WarroomSyncService
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly log = new Logger('WarroomSync');
  private timer: ReturnType<typeof setInterval> | null = null;
  private first: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private lastPeekAt = 0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly erp: ErpSyncService,
    private readonly config: ConfigService,
  ) {}

  private url(): string | null {
    return (
      (this.config.get<string>('WARROOM_DATABASE_URL') ?? '').trim() || null
    );
  }
  mode(): WarroomMode {
    return warroomMode(this.config);
  }
  private intervalMinutes(): number {
    const n = Number(this.config.get<string>('WARROOM_SYNC_MINUTES') ?? 10);
    return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 10;
  }

  onApplicationBootstrap(): void {
    if (!this.url()) {
      this.log.warn(
        'Warroom sync is off: set WARROOM_DATABASE_URL (read-only) to enable it',
      );
      return;
    }
    if (this.intervalMinutes() === 0) {
      this.log.log(
        'Warroom sync schedule is off (WARROOM_SYNC_MINUTES=0): manual runs only',
      );
      return;
    }
    this.timer = setInterval(() => void this.tick(), TICK_MS);
    this.timer.unref();
    this.first = setTimeout(() => void this.tick(), FIRST_TICK_MS);
    this.first.unref();
    this.log.log(
      `Warroom sync: mode=${this.mode()}, checks for a newer snapshot every ${this.intervalMinutes()} min`,
    );
  }
  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    if (this.first) clearTimeout(this.first);
  }

  /**
   * Cheap check, then a run only when warroom has a snapshot SES has not processed. The run slot is the snapshot
   * time, so two containers (or a restart) process one snapshot once; a failed one is retried a few times.
   */
  async tick(): Promise<void> {
    const url = this.url();
    const mode = this.mode();
    if (!url || mode === 'off' || this.running) return;
    const every = this.intervalMinutes() * 60_000;
    if (Date.now() - this.lastPeekAt < every) return;
    this.lastPeekAt = Date.now();
    this.running = true;
    try {
      const asOf = await peekSnapshot(url);
      if (!asOf) return;
      const claim = await this.erp.claim(
        `snap-${asOf.toISOString()}`,
        'schedule',
        false,
        null,
        KIND,
      );
      if (claim) await this.execute(claim.id, { dryRun: false, force: false });
    } catch (error) {
      this.log.error(`warroom check failed: ${safeMessage(error)}`);
    } finally {
      this.running = false;
    }
  }

  /** ADMIN "run now" / dry run. Returns at once unless `wait`. */
  async runManual(
    actorStaffId: string,
    dryRun: boolean,
    force: boolean,
    wait = false,
  ): Promise<WarroomRunDto> {
    if (!this.url())
      throw new BadRequestException('ยังไม่ได้ตั้งค่า WARROOM_DATABASE_URL');
    if (this.mode() === 'off')
      throw new BadRequestException('WARROOM_STOCK_MODE=off ปิดการซิงก์อยู่');
    if (this.running)
      throw new ConflictException('กำลังซิงก์ warroom อยู่ รอให้เสร็จก่อน');
    this.running = true; // before the first await, so a second click gets 409
    let claim: { id: string } | null;
    try {
      claim = await this.erp.claim(
        `manual-${new Date().toISOString()}-${Math.random().toString(16).slice(2, 6)}`,
        'manual',
        dryRun,
        actorStaffId,
        KIND,
      );
    } catch (error) {
      this.running = false;
      throw error;
    }
    if (!claim) {
      this.running = false;
      throw new ConflictException('สร้างรอบซิงก์ไม่สำเร็จ ลองใหม่อีกครั้ง');
    }
    const done = this.execute(claim.id, { dryRun, force });
    if (wait) return done;
    void done.catch(() => undefined);
    return this.run(claim.id);
  }

  private async run(id: string): Promise<WarroomRunDto> {
    const row = await this.prisma.erpSyncRun.findUniqueOrThrow({
      where: { id },
    });
    return toDto(row) as unknown as WarroomRunDto;
  }

  private async execute(
    runId: string,
    options: { dryRun: boolean; force: boolean },
  ): Promise<WarroomRunDto> {
    this.running = true;
    try {
      const url = this.url();
      if (!url) throw new Error('ยังไม่ได้ตั้งค่า WARROOM_DATABASE_URL');
      const rows = await readRows(url);
      const summary = await this.apply(rows, options);
      await this.prisma.erpSyncRun.update({
        where: { id: runId },
        data: {
          finishedAt: new Date(),
          ok: true,
          summary: summary as unknown as Prisma.InputJsonValue,
          error: null,
        },
      });
      this.log.log(
        `warroom sync ${options.dryRun ? '(dry run) ' : ''}done: ${summary.rows} rows, ${summary.parts} parts, stock rows ${summary.stock.updatedRows}, catalog +${summary.catalog.created}`,
      );
    } catch (error) {
      const message = safeMessage(error);
      this.log.error(`warroom sync failed: ${message}`);
      await this.prisma.erpSyncRun.update({
        where: { id: runId },
        data: { finishedAt: new Date(), ok: false, error: message },
      });
    } finally {
      this.running = false;
    }
    return this.run(runId);
  }

  /** Writes (unless dry run) and returns what happened. Idempotent: a failed run is simply repeated. */
  private async apply(
    rows: WarroomRow[],
    options: { dryRun: boolean; force: boolean },
  ): Promise<WarroomSummary> {
    const mode = this.mode();
    if (!rows.length)
      throw new Error('warroom ส่งข้อมูลสต็อกว่าง จึงยกเลิกการซิงก์');
    const asOf = rows.reduce(
      (m, r) => (r.snapshotAt > m ? r.snapshotAt : m),
      rows[0]!.snapshotAt,
    );
    const parts = new Set(rows.map((r) => r.partNo));
    const { items, categories, skippedNoCategory } = buildCatalog(rows);

    // Branches: SES Branch.code is the ERP branch_code (D53). Unknown codes (HO, iMedic, Huawei...) are only counted.
    const sesBranches = await this.prisma.branch.findMany({
      select: { id: true, code: true, erpBranchId: true },
      orderBy: { code: 'asc' },
    });
    const branchByCode = new Map<string, string>();
    for (const b of sesBranches) {
      const prev = branchByCode.get(b.code);
      if (!prev || b.erpBranchId !== null) branchByCode.set(b.code, b.id);
    }
    const unknown = new Map<string, number>();
    const knownRows = rows.filter((r) => {
      if (branchByCode.has(r.branchCode)) return true;
      unknown.set(r.branchCode, (unknown.get(r.branchCode) ?? 0) + 1);
      return false;
    });

    // SKUs SES already has, by part number.
    const skuRows = await this.prisma.productSku.findMany({
      select: {
        id: true,
        sku: true,
        erpManaged: true,
        name: true,
        color: true,
        storage: true,
      },
    });
    const skuByCode = new Map(skuRows.map((s) => [s.sku, s]));
    const existingParts = [...parts].filter((p) => skuByCode.has(p));
    // Only parts some SES branch has: a model that exists in HO / iMedic / Huawei only would just clutter the catalog.
    const knownParts = new Set(knownRows.map((r) => r.partNo));
    const missing = items.filter(
      (i) => !skuByCode.has(i.partNo) && knownParts.has(i.partNo),
    );

    // Safety: a snapshot that lost half of the SKUs we already cover is more likely a broken warroom than a fire sale.
    const covered = await this.prisma.branchInventory.findMany({
      where: { erpReady: { not: null } },
      select: { branchId: true, skuId: true, erpReady: true },
    });
    // SKUs that had stock in the previous snapshot (a forced run that zeroed many must not block every later run)
    const coveredSkus = new Set(
      covered.filter((c) => (c.erpReady ?? 0) > 0).map((c) => c.skuId),
    );
    const newest = (
      await this.prisma.branchInventory.aggregate({ _max: { erpAsOf: true } })
    )._max.erpAsOf;
    if (!options.force && newest && asOf < newest)
      throw new Error(
        `ยกเลิกเพื่อความปลอดภัย: snapshot ${asOf.toISOString()} เก่ากว่าที่ SES เก็บไว้ (${newest.toISOString()}) ตรวจ warroom แล้วสั่งรันซ้ำแบบ force ถ้าถูกต้อง`,
      );
    if (
      !options.force &&
      coveredSkus.size >= 20 &&
      existingParts.length < coveredSkus.size * 0.5
    )
      throw new Error(
        `ยกเลิกเพื่อความปลอดภัย: snapshot นี้มี part ที่ SES รู้จัก ${existingParts.length} รายการ จากเดิมที่ครอบคลุม ${coveredSkus.size} ตรวจ warroom แล้วสั่งรันซ้ำแบบ force ถ้าถูกต้อง`,
      );

    const summary: WarroomSummary = {
      mode,
      asOf: asOf.toISOString(),
      rows: rows.length,
      parts: parts.size,
      branches: {
        matched: new Set(knownRows.map((r) => r.branchCode)).size,
        unknown: [...unknown.entries()]
          .map(([code, n]) => ({ code, rows: n }))
          .sort((a, b) => b.rows - a.rows)
          .slice(0, NOTE_LIMIT),
      },
      catalog: {
        existing: existingParts.length,
        created: 0,
        wouldCreate: mode === 'on' && !options.dryRun ? 0 : missing.length,
        updated: 0,
        skippedNoCategory,
        categories: categories.slice(0, NOTE_LIMIT),
        unmapped: categories
          .filter((c) => c.mapped === null)
          .map((c) => ({ value: c.value, parts: c.parts }))
          .slice(0, NOTE_LIMIT),
      },
      stock: { updatedRows: 0, zeroedRows: 0, readyUnits: 0, transferUnits: 0 },
    };

    // Catalog (mode `on` only): create what is missing, refresh the attributes of what the sync created before.
    const wantUpdate = items.filter((i) => {
      const s = skuByCode.get(i.partNo);
      return (
        s?.erpManaged === true &&
        (s.name !== i.skuName ||
          (s.color ?? null) !== i.color ||
          (s.storage ?? null) !== i.storage)
      );
    });
    if (mode === 'on') {
      if (options.dryRun) {
        summary.catalog.updated = wantUpdate.length;
      } else {
        const result = await this.upsertCatalog(missing, wantUpdate, skuByCode);
        summary.catalog.created = result.created;
        summary.catalog.updated = result.updated;
      }
    }

    // Stock numbers per (branch, SKU). In `shadow` only SKUs SES already has; in `on` the new ones too.
    const wanted = new Set(mode === 'on' ? [...parts] : existingParts);
    const agg = new Map<
      string,
      { branchId: string; code: string; ready: number; transfer: number }
    >();
    for (const r of knownRows) {
      if (!wanted.has(r.partNo)) continue;
      const k = `${r.branchCode}\u0000${r.partNo}`;
      const a = agg.get(k) ?? {
        branchId: branchByCode.get(r.branchCode) as string,
        code: r.partNo,
        ready: 0,
        transfer: 0,
      };
      a.ready += r.ready;
      a.transfer += r.transfer;
      agg.set(k, a);
    }
    const idByCode = new Map(skuRows.map((s) => [s.sku, s.id]));
    if (mode === 'on' && !options.dryRun) {
      const created = await this.prisma.productSku.findMany({
        where: { sku: { in: missing.map((m) => m.partNo) } },
        select: { id: true, sku: true },
      });
      for (const c of created) idByCode.set(c.sku, c.id);
    }
    const writes: {
      branchId: string;
      skuId: string;
      ready: number;
      transfer: number;
    }[] = [];
    for (const a of agg.values()) {
      const skuId = idByCode.get(a.code);
      if (!skuId) continue; // dry run in `on`: SKU does not exist yet
      writes.push({
        branchId: a.branchId,
        skuId,
        ready: a.ready,
        transfer: a.transfer,
      });
    }
    const seen = new Set(writes.map((w) => `${w.branchId}\u0000${w.skuId}`));
    const toZero = covered.filter(
      (c) => !seen.has(`${c.branchId}\u0000${c.skuId}`),
    );
    summary.stock.updatedRows =
      mode === 'on' && options.dryRun ? agg.size : writes.length;
    summary.stock.readyUnits = [...agg.values()].reduce(
      (n, a) => n + a.ready,
      0,
    );
    summary.stock.transferUnits = [...agg.values()].reduce(
      (n, a) => n + a.transfer,
      0,
    );
    summary.stock.zeroedRows = toZero.length;

    if (!options.dryRun) {
      for (let i = 0; i < writes.length; i += CHUNK) {
        const part = writes.slice(i, i + CHUNK);
        await this.prisma.$executeRaw`
          INSERT INTO BranchInventory (id, branchId, skuId, stock, active, erpReady, erpTransfer, erpAsOf)
          VALUES ${Prisma.join(
            part.map(
              (w) =>
                Prisma.sql`(UUID(), ${w.branchId}, ${w.skuId}, 0, true, ${w.ready}, ${w.transfer}, ${asOf})`,
            ),
          )}
          ON DUPLICATE KEY UPDATE erpReady = VALUES(erpReady), erpTransfer = VALUES(erpTransfer), erpAsOf = VALUES(erpAsOf)`;
      }
      // Rows that had ERP data but are not in this snapshot any more (every row written above carries exactly this
      // asOf): sold out / moved, so 0 as of this snapshot.
      const zeroed = await this.prisma.$executeRaw`
        UPDATE BranchInventory SET erpReady = 0, erpTransfer = 0, erpAsOf = ${asOf}
         WHERE erpReady IS NOT NULL AND (erpAsOf IS NULL OR erpAsOf <> ${asOf})`;
      summary.stock.zeroedRows = Number(zeroed);
    }
    return summary;
  }

  private async upsertCatalog(
    create: CatalogItem[],
    update: CatalogItem[],
    skuByCode: Map<string, { id: string }>,
  ): Promise<{ created: number; updated: number }> {
    const products = await this.prisma.product.findMany({
      select: { id: true, category: true, name: true },
    });
    const productId = new Map(
      products.map((p) => [`${p.category}\u0000${p.name}`, p.id]),
    );
    const models = await this.prisma.productModel.findMany({
      select: { id: true, productId: true, name: true },
    });
    const modelId = new Map(
      models.map((m) => [`${m.productId}\u0000${m.name}`, m.id]),
    );
    let created = 0;
    for (const item of create) {
      try {
        const pk = `${item.category}\u0000${item.productName}`;
        let pid = productId.get(pk);
        if (!pid) {
          pid = (
            await this.prisma.product.create({
              data: {
                category: item.category,
                name: item.productName,
                active: true,
                erpManaged: true,
              },
            })
          ).id;
          productId.set(pk, pid);
        }
        const mk = `${pid}\u0000${item.modelName}`;
        let mid = modelId.get(mk);
        if (!mid) {
          mid = (
            await this.prisma.productModel.create({
              data: {
                productId: pid,
                name: item.modelName,
                active: true,
                erpManaged: true,
              },
            })
          ).id;
          modelId.set(mk, mid);
        }
        await this.prisma.productSku.create({
          data: {
            modelId: mid,
            sku: item.partNo,
            name: item.skuName,
            color: item.color,
            storage: item.storage,
            active: true,
            erpManaged: true,
          },
        });
        created += 1;
      } catch (error) {
        // A concurrent run created it first: fine, the next snapshot repeats this idempotently.
        if (!(
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002'
        ))
          throw error;
      }
    }
    let updated = 0;
    for (const item of update) {
      const sku = skuByCode.get(item.partNo);
      if (!sku) continue;
      await this.prisma.productSku.update({
        where: { id: sku.id },
        data: { name: item.skuName, color: item.color, storage: item.storage },
      });
      updated += 1;
    }
    return { created, updated };
  }

  async status(): Promise<{
    configured: boolean;
    mode: WarroomMode;
    intervalMinutes: number;
    running: boolean;
    lastSnapshotAt: string | null;
    coveredSkus: number;
    lastRuns: WarroomRunDto[];
  }> {
    const [rows, snap, covered] = await Promise.all([
      this.prisma.erpSyncRun.findMany({
        where: { kind: KIND },
        orderBy: { startedAt: 'desc' },
        take: 10,
      }),
      this.prisma.branchInventory.aggregate({ _max: { erpAsOf: true } }),
      this.prisma.branchInventory.findMany({
        where: { erpReady: { not: null } },
        distinct: ['skuId'],
        select: { skuId: true },
      }),
    ]);
    return {
      configured: this.url() !== null,
      mode: this.mode(),
      intervalMinutes: this.intervalMinutes(),
      running: this.running,
      lastSnapshotAt: snap._max.erpAsOf
        ? snap._max.erpAsOf.toISOString()
        : null,
      coveredSkus: covered.length,
      lastRuns: rows.map((r) => toDto(r) as unknown as WarroomRunDto),
    };
  }
}
