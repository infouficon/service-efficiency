import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
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
const RESET_KIND = 'catalog-reset';
const TICK_MS = 60_000;
const FIRST_TICK_MS = 15_000;
const CHUNK = 500;
const NOTE_LIMIT = 50;
/** A snapshot stamped further in the future than this is a clock / time-zone problem, not news. */
const FUTURE_SLACK_MS = 5 * 60_000;
/** warroom drops unchanged rows, so max(snapshot_at) may step back after sales; more than this is a rollback. */
const OLDER_SLACK_MS = 24 * 3600_000;
const RUN_DEADLINE_MS = 10 * 60_000;
const RUNNING_WINDOW_MS = 20 * 60_000;
const MAX_ATTEMPTS = 12;
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
  /** name of the SES category (D72): one of the Apple lines, or warroom's own category text */
  category: string;
  isAccessory: boolean;
  productName: string;
  modelName: string;
  skuName: string;
  color: string | null;
  storage: string | null;
  /** RAM parsed from the names ("Ram 16" -> "16GB"), D79 */
  memory: string | null;
  upc: string | null;
}
/** How a warroom category text is handled (D72): which SES category it goes to, and whether SES has it switched on. */
export interface CategoryTally {
  value: string;
  /** the SES category name; null only when warroom gave no category text at all */
  mapped: string | null;
  isAccessory: boolean;
  parts: number;
  /** `active` = products are created; `off` = exists but switched off; `new` = will be created switched off */
  status?: 'active' | 'off' | 'new';
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
    /** ERP-made SKUs re-filed under another product / model / category after a rule change (D78) */
    moved: number;
    /** parts with no category text in warroom at all */
    skippedNoCategory: number;
    /** parts of a category ADMIN has not switched on yet (D72): created when the category is opened */
    waitingForCategory: number;
    /** categories added to the SES list by this run (switched off) */
    newCategories: number;
    /** parts whose SKU code collided with an existing one (case-insensitively) while being created */
    collisions: number;
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
/** What "clear the old catalog and queue history" removes (D72): shown first, then done only on a typed confirmation. */
export interface CatalogResetCounts {
  sessions: number;
  customers: number;
  products: number;
  models: number;
  skus: number;
  inventoryRows: number;
}
export const RESET_CONFIRM = 'ล้างข้อมูล';
/** `all` = everything (D73); `non-erp` = only what did not come from the ERP, plus the queues that used it (D78). */
export type ResetScope = 'all' | 'non-erp';
export type WarroomRunDto = Omit<ErpSyncRunDto, 'summary'> & {
  summary: WarroomSummary | null;
};

// ---------------------------------------------------------------------------
// Pure rules (unit tested without a database)
// ---------------------------------------------------------------------------
/** A rule result: the SES category a warroom category text belongs to. */
export interface CategoryRule {
  name: string;
  isAccessory: boolean;
}

/** Brands SES does not sell yet (D72): never folded into an Apple category by a keyword. */
const OTHER_BRAND = /huawei|third[\s-]*party/;
const APPLE_ACCESSORY =
  /accessor|^apple\s+accy\b|airpods|airtag|beats|homepod|apple\s*tv|apple\s*care|applecare|\bcase\b|cover|charger|cable|adapter|pencil|keyboard|mouse|trackpad|strap|\bband\b|protect|film|glass/;

/**
 * ERP category text -> SES category (D72). The five Apple lines are recognised by words (accessory words win over device
 * words: "iPhone Case" is an accessory; "Apple Accy" is Accessories). Anything else, and every other brand ("HUAWEI Phone",
 * "Third Party Accy"), becomes a category of its own named exactly as warroom spells it; the sync adds it switched OFF so
 * staff see nothing until ADMIN opens it. Only an empty text gives null.
 */
export function mapCategory(
  value: string | null | undefined,
): CategoryRule | null {
  const raw = clean(value, 100);
  if (!raw) return null;
  const v = raw.toLowerCase();
  if (!OTHER_BRAND.test(v)) {
    if (APPLE_ACCESSORY.test(v))
      return { name: 'Accessories', isAccessory: true };
    if (/iphone/.test(v)) return { name: 'iPhone', isAccessory: false };
    if (/ipad/.test(v)) return { name: 'iPad', isAccessory: false };
    if (/watch/.test(v)) return { name: 'Watch', isAccessory: false };
    if (/mac/.test(v)) return { name: 'Mac', isAccessory: false };
  }
  return { name: raw, isAccessory: /\baccy\b|accessor/.test(v) };
}

/** Warroom sells batteries ("Battery - iPhone 13") under a device category; they are a category of their own (D78). */
const BATTERY = /^battery\b/i;
export const BATTERY_CATEGORY: CategoryRule = {
  name: 'Battery',
  isAccessory: false,
};

/**
 * The name without the capacity ("iPhone 18 Pro Max 1TB" -> "iPhone 18 Pro Max"), so every capacity of a model is ONE
 * model and the capacity is picked on its own (D78). Only the part's own capacity is removed: other GB figures in a name
 * (a Mac's memory) stay.
 */
export function withoutCapacity(
  name: string | null,
  capacity: string | null,
): string | null {
  const text = (name ?? '').trim();
  const cap = (capacity ?? '').trim().match(/^(\d+(?:\.\d+)?)\s*(GB|TB)$/i);
  if (!text || !cap) return text || null;
  const token = new RegExp(`(^|[\\s(-])${cap[1]}\\s*${cap[2]}(?=$|[\\s)\\-/])`, 'gi');
  const stripped = text
    .replace(token, '$1')
    .replace(/\s{2,}/g, ' ')
    .replace(/[\s\-·/]+$/, '')
    .replace(/\(\s*\)/g, '')
    .trim();
  return stripped || text;
}

/** Memory (RAM) written in a name: "Ram 16", "Ram 16GB", "16GB RAM" -> "16GB". */
export function memoryOf(...texts: (string | null | undefined)[]): string | null {
  for (const text of texts) {
    const m =
      (text ?? '').match(/\bram\s*(\d+)\s*(?:gb)?\b/i) ??
      (text ?? '').match(/\b(\d+)\s*gb\s*ram\b/i);
    if (m) return `${m[1]}GB`;
  }
  return null;
}

/**
 * The storage of a part (D80). Warroom's `capacity` column is the first GB/TB figure of a name, so on a Mac it is the RAM
 * ("Ram 24 1TB" -> "24GB"). When a memory was read from the names, the storage is the first GB/TB figure that is not that
 * memory; without a memory the `capacity` column is used as it is.
 */
export function storageOf(
  texts: (string | null | undefined)[],
  memory: string | null,
  capacity: string | null,
): string | null {
  const cap = (capacity ?? '').trim() || null;
  if (!memory) return cap;
  for (const text of texts) {
    for (const m of (text ?? '').matchAll(/(\d+(?:\.\d+)?)\s*(GB|TB)\b/gi)) {
      const token = `${m[1]}${m[2].toUpperCase()}`;
      if (token !== memory) return token;
    }
  }
  return cap && cap.toUpperCase() !== memory ? cap : null;
}

/** The colour without the capacity warroom puts in front of it ("1TB SSD - Space Black" -> "Space Black"). */
export function colorOf(color: string | null): string | null {
  const text = (color ?? '').trim();
  if (!text) return null;
  const stripped = text
    .replace(
      /^(?:\d+(?:\.\d+)?\s*(?:GB|TB)(?:\s*(?:SSD|RAM|Memory|Storage))?[\s,/+]*)+[-–·:]\s*/i,
      '',
    )
    .trim();
  return stripped || text;
}

/**
 * A model name as staff should see it (D79): without the capacity (D78), without the memory ("Ram 16"), and without a
 * trailing keyboard-layout marker ("Eng", which stays in the SKU name), so one model carries all its RAM / capacity /
 * colour variants. Screen size and chip stay in the name ("MacBook Air M5 13.6").
 */
export function modelNameOf(name: string | null, capacity: string | null): string | null {
  const base = withoutCapacity(name, capacity);
  if (!base) return base;
  const cleaned = base
    .replace(/\s*\bram\s*\d+\s*(?:gb)?\b\s*/gi, ' ')
    .replace(/\s*\b\d+\s*gb\s*ram\b\s*/gi, ' ')
    .replace(/\s+(?:eng|english)\s*$/i, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/[\s\-·/]+$/, '')
    .trim();
  return cleaned || base;
}

/** The spelling to use for names that differ only in case ("MACBOOK AIR" / "Macbook Air"): mixed case wins, then the commonest. */
function canonicalSpellings(names: string[]): Map<string, string> {
  const byKey = new Map<string, Map<string, number>>();
  for (const n of names) {
    const key = n.toLowerCase();
    const spellings = byKey.get(key) ?? new Map<string, number>();
    spellings.set(n, (spellings.get(n) ?? 0) + 1);
    byKey.set(key, spellings);
  }
  const out = new Map<string, string>();
  for (const [key, spellings] of byKey) {
    const best = [...spellings.entries()].sort((a, b) => {
      const mixed = (x: string) => (x !== x.toUpperCase() && x !== x.toLowerCase() ? 1 : 0);
      return mixed(b[0]) - mixed(a[0]) || b[1] - a[1] || a[0].localeCompare(b[0]);
    })[0][0];
    out.set(key, best);
  }
  return out;
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

/** SKU codes are compared case-insensitively by MySQL, so SES matches part numbers the same way. */
const norm = (s: string) => s.trim().toLowerCase();

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
    // The sub-category is only a fallback for an EMPTY category: a category of another brand ("Huawei Phone") must not be
    // rescued by a model-looking sub-category.
    let rule = clean(cat, 100) ? mapCategory(cat) : mapCategory(subcat);
    // a battery is not an iPhone (D78); another brand's category is left alone
    const batteryText = clean(subcat, 100) ?? clean(subsubcat, 100) ?? '';
    if (rule && BATTERY.test(batteryText) && !OTHER_BRAND.test((cat ?? '').toLowerCase()))
      rule = BATTERY_CATEGORY;
    const label = clean(cat, 100) ?? clean(subcat, 100) ?? '(ว่าง)';
    const key = `${label}\u0000${rule?.name ?? ''}`;
    const t = tally.get(key) ?? {
      value: label,
      mapped: rule?.name ?? null,
      isAccessory: rule?.isAccessory ?? false,
      parts: 0,
    };
    t.parts += 1;
    tally.set(key, t);
    if (!rule) {
      skippedNoCategory += 1;
      continue;
    }
    const nameTexts = [
      first(rs, (r) => r.subsubcat),
      first(rs, (r) => r.subcat),
      first(rs, (r) => r.productName),
    ];
    const memory = memoryOf(...nameTexts);
    const capacity = storageOf(nameTexts, memory, first(rs, (r) => r.capacity));
    const productName =
      clean(modelNameOf(subcat, capacity), 191) ?? clean(cat, 191) ?? 'ไม่ระบุ';
    items.push({
      partNo,
      category: rule.name,
      isAccessory: rule.isAccessory,
      upc: clean(
        first(rs, (r) => r.upc),
        64,
      ),
      productName,
      modelName: clean(modelNameOf(subsubcat, capacity), 191) ?? productName,
      memory,
      skuName: shortName(name, partNo).slice(0, 191),
      color: clean(
        colorOf(first(rs, (r) => r.color)),
        64,
      ),
      storage: clean(capacity, 64),
    });
  }
  // names that differ only in case are one product / model (D79)
  const productSpelling = canonicalSpellings(items.map((i) => i.productName));
  const modelSpelling = canonicalSpellings(items.map((i) => i.modelName));
  for (const item of items) {
    item.productName = productSpelling.get(item.productName.toLowerCase()) ?? item.productName;
    item.modelName = modelSpelling.get(item.modelName.toLowerCase()) ?? item.modelName;
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
         max(s.snapshot_at)::timestamptz AS snapshot_at
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

export interface Peek {
  asOf: Date | null;
  rows: number;
  qty: number;
}

/** Newest snapshot time plus a size fingerprint of the warroom stock table: one tiny query. */
export async function peekSnapshot(url: string): Promise<Peek> {
  return withWarroom(url, async (c) => {
    const res = await c.query<{
      as_of: Date | null;
      rows: number;
      qty: number;
    }>(
      'SELECT max(snapshot_at)::timestamptz AS as_of, count(*)::int AS rows, COALESCE(sum(qty), 0)::float8 AS qty FROM mart.stock_mv',
    );
    const r = res.rows[0];
    return {
      asOf: r?.as_of ?? null,
      rows: Number(r?.rows ?? 0),
      qty: Number(r?.qty ?? 0),
    };
  });
}

/**
 * Version of the rules that turn warroom rows into catalog items (categories, names, storage, memory, colour). It is part of
 * the run slot, so after a deploy that changes the rules the next scheduled check re-processes the snapshot it already
 * handled (and corrects, re-files and updates what the old rules made) without anybody pressing "ซิงก์ตอนนี้". Raise it
 * whenever `mapCategory`, `buildCatalog` or the helpers they use change what an item looks like.
 */
export const CATALOG_RULES_VERSION = 4;

/**
 * Short stable fingerprint of what stock_mv holds: a change that does not move max(snapshot_at) (units sold) still
 * produces a new run slot, and a max that steps back after sales still reads as news. The rules version is mixed in.
 */
export function fingerprint(rows: number, qty: number): string {
  return (
    ((rows * 2654435761) ^
      Math.round(qty * 1000) ^
      (CATALOG_RULES_VERSION * 40503)) >>>
    0
  ).toString(36);
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
    const raw = (this.config.get<string>('WARROOM_SYNC_MINUTES') ?? '').trim();
    if (raw === '') return 10; // empty is "not set", not "0 = off"
    const n = Number(raw);
    return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 10;
  }

  /** Another run (this or another container) started in the last 20 minutes and has not finished. */
  private async othersRunning(): Promise<boolean> {
    return (
      (await this.prisma.erpSyncRun.count({
        where: {
          kind: KIND,
          ok: null,
          finishedAt: null,
          startedAt: { gt: new Date(Date.now() - RUNNING_WINDOW_MS) },
        },
      })) > 0
    );
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
      const peek = await peekSnapshot(url);
      if (!peek.asOf || (await this.othersRunning())) return;
      // One slot per (snapshot time, content fingerprint): a snapshot is processed once, a change that leaves
      // max(snapshot_at) alone (sales) still gets its own run, and a failed slot is retried for about two hours.
      const claim = await this.erp.claim(
        `snap-${peek.asOf.toISOString()}-${fingerprint(peek.rows, peek.qty)}`,
        'schedule',
        false,
        null,
        KIND,
        MAX_ATTEMPTS,
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
      if (await this.othersRunning())
        throw new ConflictException(
          'มีรอบซิงก์ warroom ที่ยังไม่จบอยู่ (อาจรันอยู่ที่ container อื่น)',
        );
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
      let timer: ReturnType<typeof setTimeout> | undefined;
      const deadline = new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error('เกินเวลา 10 นาที ยกเลิกรอบนี้')),
          RUN_DEADLINE_MS,
        );
      });
      let summary: WarroomSummary;
      try {
        summary = await Promise.race([
          readRows(url).then((rows) => this.apply(rows, options)),
          deadline,
        ]);
      } finally {
        clearTimeout(timer);
      }
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

    // The SES category list (D72): a category's products are only created while it is switched on; the ones warroom has and
    // SES does not are added switched off. Names compare without regard to case, like the database.
    const registry = await this.prisma.category.findMany({
      select: { name: true, active: true },
    });
    const regByName = new Map(registry.map((c) => [norm(c.name), c]));
    for (const item of items)
      item.category = regByName.get(norm(item.category))?.name ?? item.category;
    for (const c of categories) {
      if (c.mapped === null) continue;
      const known = regByName.get(norm(c.mapped));
      c.mapped = known?.name ?? c.mapped;
      c.status = known ? (known.active ? 'active' : 'off') : 'new';
    }
    const isOn = (category: string) =>
      regByName.get(norm(category))?.active === true;

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
        memory: true,
        upc: true,
        model: {
          select: {
            name: true,
            product: { select: { name: true, category: true } },
          },
        },
      },
    });
    const skuByCode = new Map(skuRows.map((s) => [norm(s.sku), s]));
    const existingParts = [...parts].filter((p) => skuByCode.has(norm(p)));
    // Only parts some SES branch has: a model that exists in HO / iMedic / Huawei only would just clutter the catalog.
    const knownParts = new Set(knownRows.map((r) => r.partNo));
    const notYet = items.filter(
      (i) => !skuByCode.has(norm(i.partNo)) && knownParts.has(i.partNo),
    );
    // Only parts of a switched-on category are created; the rest wait until ADMIN opens their category (D72).
    const missing = notYet.filter((i) => isOn(i.category));

    // Safety. A broken warroom is more likely than a fire sale; `force` lifts these for a snapshot that is right.
    const covered = await this.prisma.branchInventory.findMany({
      where: { erpReady: { not: null } },
      select: { branchId: true, skuId: true, erpReady: true },
    });
    // What had stock in the previous snapshot (a forced run that zeroed many must not block every later run)
    const stocked = covered.filter((c) => (c.erpReady ?? 0) > 0);
    const coveredSkus = new Set(stocked.map((c) => c.skuId));
    const prevBranches = new Set(stocked.map((c) => c.branchId));
    const prevReady = covered.reduce((n, c) => n + (c.erpReady ?? 0), 0);
    const newest = (
      await this.prisma.branchInventory.aggregate({ _max: { erpAsOf: true } })
    )._max.erpAsOf;
    const refuse = (why: string) =>
      new Error(
        `ยกเลิกเพื่อความปลอดภัย: ${why} ตรวจ warroom แล้วสั่งรันซ้ำแบบ force ถ้าถูกต้อง`,
      );
    if (!options.force) {
      if (asOf.getTime() > Date.now() + FUTURE_SLACK_MS)
        throw refuse(
          `เวลา snapshot ${asOf.toISOString()} อยู่ในอนาคต (นาฬิกา/time zone ผิด?)`,
        );
      if (newest && asOf.getTime() < newest.getTime() - OLDER_SLACK_MS)
        throw refuse(
          `snapshot ${asOf.toISOString()} เก่ากว่าที่ SES เก็บไว้ (${newest.toISOString()}) เกิน 24 ชั่วโมง`,
        );
      if (
        coveredSkus.size >= 20 &&
        existingParts.length < coveredSkus.size * 0.5
      )
        throw refuse(
          `snapshot นี้มี part ที่ SES รู้จัก ${existingParts.length} รายการ จากเดิมที่ครอบคลุม ${coveredSkus.size}`,
        );
    }

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
        moved: 0,
        skippedNoCategory,
        waitingForCategory: notYet.length - missing.length,
        newCategories: 0,
        collisions: 0,
        categories: categories.slice(0, NOTE_LIMIT),
        unmapped: categories
          .filter((c) => c.mapped === null)
          .map((c) => ({ value: c.value, parts: c.parts }))
          .slice(0, NOTE_LIMIT),
      },
      stock: { updatedRows: 0, zeroedRows: 0, readyUnits: 0, transferUnits: 0 },
    };

    // Stock numbers per (branch, SKU). In `shadow` only SKUs SES already has; in `on` the new ones too.
    const wanted = new Set(
      mode === 'on'
        ? [...existingParts, ...missing.map((m) => m.partNo)]
        : existingParts,
    );
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
    // Every matched branch gets an explicit row (0 if need be) for every part warroom knows: a branch that is not
    // listed has none, otherwise a hand-made SKU would keep showing its manual stock there.
    const matchedCodes = [...new Set(knownRows.map((r) => r.branchCode))];
    for (const code of matchedCodes)
      for (const part of wanted) {
        const k = `${code}\u0000${part}`;
        if (!agg.has(k))
          agg.set(k, {
            branchId: branchByCode.get(code) as string,
            code: part,
            ready: 0,
            transfer: 0,
          });
      }
    const matchedBranchIds = [
      ...new Set(matchedCodes.map((c) => branchByCode.get(c) as string)),
    ];
    const newReady = [...agg.values()].reduce((n, a) => n + a.ready, 0);
    if (!options.force) {
      const kept = matchedBranchIds.filter((id) => prevBranches.has(id)).length;
      if (prevBranches.size >= 2 && kept < prevBranches.size * 0.5)
        throw refuse(
          `snapshot นี้มีสาขาที่ SES รู้จัก ${kept} จาก ${prevBranches.size} สาขาที่เคยมีสต็อก (เปลี่ยนรหัสสาขาใน warroom?)`,
        );
      if (prevReady >= 20 && newReady < prevReady * 0.5)
        throw refuse(
          `จำนวนพร้อมขายรวมลดจาก ${prevReady} เหลือ ${newReady} (มากกว่าครึ่ง)`,
        );
    }

    // Catalog (mode `on` only): create what is missing, refresh the attributes of what the sync created before.
    const wantUpdate = items.filter((i) => {
      const s = skuByCode.get(norm(i.partNo));
      return (
        s?.erpManaged === true &&
        (s.name !== i.skuName ||
          (s.color ?? null) !== i.color ||
          (s.storage ?? null) !== i.storage ||
          (s.memory ?? null) !== i.memory ||
          (i.upc !== null && (s.upc ?? null) !== i.upc))
      );
    });
    // ERP-made SKUs filed under another product / model / category than the rules give today (a rule change, D78)
    const wantMove = items.filter((i) => {
      const s = skuByCode.get(norm(i.partNo));
      return (
        s?.erpManaged === true &&
        (norm(s.model.product.category) !== norm(i.category) ||
          s.model.product.name !== i.productName ||
          s.model.name !== i.modelName)
      );
    });
    summary.catalog.moved = 0;
    // New warroom categories join the SES list switched off (shadow or on), so ADMIN can open them later.
    const fresh = new Map<string, CatalogItem>();
    for (const item of items)
      if (!regByName.has(norm(item.category)) && !fresh.has(norm(item.category)))
        fresh.set(norm(item.category), item);
    summary.catalog.newCategories = fresh.size;
    if (!options.dryRun && fresh.size > 0) {
      const last = await this.prisma.category.aggregate({
        _max: { position: true },
      });
      let position = last._max.position ?? 0;
      await this.prisma.category.createMany({
        data: [...fresh.values()]
          .sort((a, b) => a.category.localeCompare(b.category))
          .map((c) => ({
            name: c.category,
            active: false,
            isAccessory: c.isAccessory,
            erpManaged: true,
            position: (position += 1),
          })),
        skipDuplicates: true,
      });
    }
    if (mode === 'on') {
      if (options.dryRun) {
        summary.catalog.updated = wantUpdate.length;
        summary.catalog.moved = wantMove.length;
      } else {
        const result = await this.upsertCatalog(
          missing,
          wantUpdate,
          skuByCode,
          wantMove,
        );
        summary.catalog.created = result.created;
        summary.catalog.updated = result.updated;
        summary.catalog.moved = result.moved;
        summary.catalog.collisions = result.collisions;
      }
    }

    const idByCode = new Map(skuRows.map((s) => [norm(s.sku), s.id]));
    if (mode === 'on' && !options.dryRun) {
      const created = await this.prisma.productSku.findMany({
        where: { sku: { in: missing.map((m) => m.partNo) } },
        select: { id: true, sku: true },
      });
      for (const c of created) idByCode.set(norm(c.sku), c.id);
    }
    const writes: {
      branchId: string;
      skuId: string;
      ready: number;
      transfer: number;
    }[] = [];
    for (const a of agg.values()) {
      const skuId = idByCode.get(norm(a.code));
      if (!skuId) continue; // dry run in `on`: SKU does not exist yet
      writes.push({
        branchId: a.branchId,
        skuId,
        ready: a.ready,
        transfer: a.transfer,
      });
    }
    const seen = new Set(writes.map((w) => `${w.branchId}\u0000${w.skuId}`));
    const matched = new Set(matchedBranchIds);
    // Only branches present in this snapshot are zeroed; a branch warroom did not report at all keeps its last numbers.
    const toZero = covered.filter(
      (c) =>
        matched.has(c.branchId) && !seen.has(`${c.branchId}\u0000${c.skuId}`),
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

    if (!options.dryRun && matchedBranchIds.length > 0) {
      // One transaction: the numbers and the zeroing of what disappeared stand or fall together.
      const zeroed = await this.prisma.$transaction(
        async (tx) => {
          for (let i = 0; i < writes.length; i += CHUNK) {
            const part = writes.slice(i, i + CHUNK);
            await tx.$executeRaw`
              INSERT INTO BranchInventory (id, branchId, skuId, stock, active, erpReady, erpTransfer, erpAsOf)
              VALUES ${Prisma.join(
                part.map(
                  (w) =>
                    Prisma.sql`(UUID(), ${w.branchId}, ${w.skuId}, 0, true, ${w.ready}, ${w.transfer}, ${asOf})`,
                ),
              )}
              ON DUPLICATE KEY UPDATE erpReady = VALUES(erpReady), erpTransfer = VALUES(erpTransfer), erpAsOf = VALUES(erpAsOf)`;
          }
          // Rows of the reported branches that had ERP data but are not in this snapshot any more (every row written
          // above carries exactly this asOf): sold out / moved, so 0 as of this snapshot.
          return tx.$executeRaw`
            UPDATE BranchInventory SET erpReady = 0, erpTransfer = 0, erpAsOf = ${asOf}
             WHERE erpReady IS NOT NULL AND (erpAsOf IS NULL OR erpAsOf <> ${asOf})
               AND branchId IN (${Prisma.join(matchedBranchIds)})`;
        },
        { timeout: 180_000, maxWait: 10_000 },
      );
      summary.stock.zeroedRows = Number(zeroed);
    }
    return summary;
  }

  private async upsertCatalog(
    create: CatalogItem[],
    update: CatalogItem[],
    skuByCode: Map<string, { id: string }>,
    move: CatalogItem[] = [],
  ): Promise<{
    created: number;
    updated: number;
    moved: number;
    collisions: number;
  }> {
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
    let collisions = 0;
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
            memory: item.memory,
            upc: item.upc,
            active: true,
            erpManaged: true,
          },
        });
        created += 1;
      } catch (error) {
        // Created by a concurrent run, or the code collides with one that differs only in case: counted, not fatal.
        if (!(
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002'
        ))
          throw error;
        collisions += 1;
      }
    }
    let updated = 0;
    for (const item of update) {
      const sku = skuByCode.get(norm(item.partNo));
      if (!sku) continue;
      await this.prisma.productSku.update({
        where: { id: sku.id },
        data: {
          name: item.skuName,
          color: item.color,
          storage: item.storage,
          memory: item.memory,
          ...(item.upc !== null ? { upc: item.upc } : {}),
        },
      });
      updated += 1;
    }
    // Re-file ERP-made SKUs whose product / model / category changed: find or make the right product and model first.
    let moved = 0;
    for (const item of move) {
      const sku = skuByCode.get(norm(item.partNo));
      if (!sku) continue;
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
      await this.prisma.productSku.update({
        where: { id: sku.id },
        data: { modelId: mid },
      });
      moved += 1;
    }
    if (moved > 0) {
      // what the move left empty and the ERP made goes (a session that still points at it keeps it)
      await this.prisma.productModel.deleteMany({
        where: { erpManaged: true, skus: { none: {} }, sessions: { none: {} } },
      });
      await this.prisma.product.deleteMany({
        where: { erpManaged: true, models: { none: {} }, sessions: { none: {} } },
      });
    }
    return { created, updated, moved, collisions };
  }

  /**
   * ADMIN one-off (D72): starts from a clean slate before the real catalog comes from warroom. Removes every queue
   * session (and what hangs on it), the customers, the queue counters, and every product / model / SKU with its branch
   * stock. Staff, branches, categories, payment methods, customer types and settings stay. A dry run only counts.
   * Irreversible, so a real run needs the typed confirmation and leaves a row in the run history.
   */
  async resetCatalog(
    actorStaffId: string,
    dryRun: boolean,
    confirm: string | undefined,
    scope: ResetScope = 'all',
  ): Promise<{ dryRun: boolean; scope: ResetScope; counts: CatalogResetCounts }> {
    if (!dryRun && (confirm ?? '').trim() !== RESET_CONFIRM)
      throw new BadRequestException(`พิมพ์ "${RESET_CONFIRM}" เพื่อยืนยัน`);
    if (this.running)
      throw new ConflictException('กำลังซิงก์ warroom อยู่ รอให้เสร็จก่อน');
    this.running = true; // a sync must not write stock rows while the catalog is being removed
    try {
      if (await this.othersRunning())
        throw new ConflictException(
          'มีรอบซิงก์ warroom ที่ยังไม่จบอยู่ (อาจรันอยู่ที่ container อื่น)',
        );
      if (scope === 'non-erp') {
        const counts = await this.resetNonErp(dryRun);
        await this.logReset(actorStaffId, dryRun, scope, counts);
        return { dryRun, scope, counts };
      }
      const [sessions, customers, products, models, skus, inventoryRows] =
        await Promise.all([
          this.prisma.customerSession.count(),
          this.prisma.customer.count(),
          this.prisma.product.count(),
          this.prisma.productModel.count(),
          this.prisma.productSku.count(),
          this.prisma.branchInventory.count(),
        ]);
      const counts = { sessions, customers, products, models, skus, inventoryRows };
      if (dryRun) return { dryRun, scope, counts };
      await this.prisma.$transaction(
        async (tx) => {
          // children first: sessions point at products, and a SKU at its model
          await tx.customerSession.deleteMany();
          await tx.customer.deleteMany();
          await tx.dailyCounter.deleteMany();
          await tx.productSku.deleteMany(); // takes the branch stock with it
          await tx.productModel.deleteMany();
          await tx.product.deleteMany();
        },
        { timeout: 120_000, maxWait: 10_000 },
      );
      await this.logReset(actorStaffId, dryRun, scope, counts);
      return { dryRun, scope, counts };
    } finally {
      this.running = false;
    }
  }

  /** The run-history row of a real clear (who, what scope, how much). */
  private async logReset(
    actorStaffId: string,
    dryRun: boolean,
    scope: ResetScope,
    counts: CatalogResetCounts,
  ) {
    if (dryRun) return;
    const now = new Date();
    await this.prisma.erpSyncRun.create({
      data: {
        kind: RESET_KIND,
        slot: `reset-${now.toISOString()}-${Math.random().toString(16).slice(2, 6)}`,
        trigger: 'manual',
        actorStaffId,
        startedAt: now,
        finishedAt: now,
        ok: true,
        summary: { scope, ...counts } as unknown as Prisma.InputJsonValue,
      },
    });
    this.log.warn(
      `catalog reset (${scope}) by ${actorStaffId}: ${JSON.stringify(counts)}`,
    );
  }

  /**
   * D78: removes only what the ERP did not create: SKUs (with their branch stock) that are not `erpManaged`, the hand-made
   * models and products that are left empty by that, and every queue session that used any of them (a session cannot keep a
   * product that is gone). Customers, counters and everything from the ERP stay.
   */
  private async resetNonErp(dryRun: boolean): Promise<CatalogResetCounts> {
    const skuIds = (
      await this.prisma.productSku.findMany({
        where: { erpManaged: false },
        select: { id: true },
      })
    ).map((s) => s.id);
    // a hand-made model/product is only removed when nothing the ERP made is left under it
    const modelIds = (
      await this.prisma.productModel.findMany({
        where: { erpManaged: false, skus: { none: { erpManaged: true } } },
        select: { id: true },
      })
    ).map((m) => m.id);
    const productIds = (
      await this.prisma.product.findMany({
        where: {
          erpManaged: false,
          models: { every: { id: { in: modelIds } } },
        },
        select: { id: true },
      })
    ).map((p) => p.id);
    const sessionWhere: Prisma.CustomerSessionWhereInput = {
      OR: [
        { items: { some: { skuId: { in: skuIds } } } },
        { skuId: { in: skuIds } },
        { modelId: { in: modelIds } },
        { productId: { in: productIds } },
      ],
    };
    const [sessions, inventoryRows] = await Promise.all([
      this.prisma.customerSession.count({ where: sessionWhere }),
      this.prisma.branchInventory.count({ where: { skuId: { in: skuIds } } }),
    ]);
    const counts = {
      sessions,
      customers: 0,
      products: productIds.length,
      models: modelIds.length,
      skus: skuIds.length,
      inventoryRows,
    };
    if (dryRun) return counts;
    await this.prisma.$transaction(
      async (tx) => {
        await tx.customerSession.deleteMany({ where: sessionWhere });
        await tx.productSku.deleteMany({ where: { id: { in: skuIds } } });
        await tx.productModel.deleteMany({ where: { id: { in: modelIds } } });
        await tx.product.deleteMany({ where: { id: { in: productIds } } });
      },
      { timeout: 120_000, maxWait: 10_000 },
    );
    return counts;
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
