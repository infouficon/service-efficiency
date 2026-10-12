import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, type RoleCode } from '@prisma/client';
import {
  ERP_MANAGED_ROLES,
  AccountsService,
} from '../accounts/accounts.service';
import { hashPassword, verifyPassword } from '../accounts/password';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Daily import of Branches and Staff from the company ERP (FileMaker OData), D53 + D54.
 *
 * The ERP owns the accounts it creates here: name, branch, active flag, password and the
 * STAFF/STOCK/CASHIER roles follow the ERP every day. ADMIN/MANAGER roles and every account
 * this import did not create (`erpStaffId` is null) are never touched.
 * Background and measured ERP behaviour: docs/agents/erp-integration.md.
 */

const KIND = 'staff-branch';
/** ERP `branch_group` values whose branches (and their staff) are imported, D53. */
export const ERP_BRANCH_GROUPS = ['iStudio', 'U-Store'];
const MAX_ROWS = 5000;
const SKIP_LIMIT = 200;
const BKK_MS = 7 * 3600_000; // Thailand has no daylight saving
const TICK_MS = 30_000;
const RETRY_AFTER_MS = 10 * 60_000;
const ABANDON_AFTER_MS = 20 * 60_000;
const MAX_ATTEMPTS = 3;
const HASH_CONCURRENCY = 4;

/**
 * Provisional mapping from the ERP `position` text to SES roles (owner will send corrections, D54).
 * Roles are the union of every matching rule. A position that matches nothing gets no account
 * (least privilege: an account without a role can still read the branch's session list).
 * ADMIN and MANAGER are never granted here; "Store Manager" is STAFF until the owner decides.
 */
export const POSITION_ROLE_RULES: { pattern: RegExp; roles: RoleCode[] }[] = [
  { pattern: /sale/i, roles: ['STAFF'] },
  { pattern: /store\s*manager/i, roles: ['STAFF'] },
  { pattern: /cashier/i, roles: ['CASHIER'] },
  { pattern: /stock/i, roles: ['STOCK'] },
];

export function rolesForPosition(
  position: string | null | undefined,
): RoleCode[] {
  const text = position ?? '';
  const roles = new Set<RoleCode>();
  for (const rule of POSITION_ROLE_RULES)
    if (rule.pattern.test(text)) rule.roles.forEach((role) => roles.add(role));
  return ERP_MANAGED_ROLES.filter((role) => roles.has(role));
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export interface ErpConfig {
  baseUrl: string;
  user: string;
  pass: string;
}
export interface ErpBranch {
  erpBranchId: number;
  code: string;
  name: string;
  phone: string;
  active: boolean;
}
export interface ErpPerson {
  erpStaffId: number;
  staffId: string;
  firstName: string;
  lastName: string;
  erpBranchId: number;
  roles: RoleCode[];
  password: string;
}
export interface BranchNote {
  code: string;
  reason: string;
}
export interface StaffNote {
  staffId: string;
  reason: string;
}
export interface ErpSyncSummary {
  branches: {
    scope: number;
    created: number;
    updated: number;
    adopted: number;
    deactivated: number;
    unchanged: number;
    notes: BranchNote[];
  };
  staff: {
    eligible: number;
    outOfScope: number;
    created: number;
    updated: number;
    passwordChanged: number;
    reactivated: number;
    deactivated: number;
    unchanged: number;
    skipped: StaffNote[];
    warnings: StaffNote[];
  };
}
export interface ErpSyncRunDto {
  id: string;
  kind: string;
  slot: string;
  trigger: string;
  dryRun: boolean;
  attempts: number;
  startedAt: string;
  finishedAt: string | null;
  ok: boolean | null;
  error: string | null;
  actorStaffId: string | null;
  summary: ErpSyncSummary | null;
}
interface Plan {
  branches: ErpBranch[];
  branchNotes: BranchNote[];
  people: ErpPerson[];
  skipped: StaffNote[];
  warnings: StaffNote[];
  outOfScope: number;
  /** erpStaffId -> new hash; null = the stored hash already matches the ERP password */
  hashes: Map<number, string | null>;
}
type Tx = Prisma.TransactionClient;
type Row = Record<string, unknown>;

class DryRunRollback extends Error {
  constructor(readonly summary: ErpSyncSummary) {
    super('dry run');
  }
}

// ---------------------------------------------------------------------------
// Pure helpers (unit tested without a database)
// ---------------------------------------------------------------------------
const asRow = (value: unknown): Row | null =>
  value && typeof value === 'object' ? (value as Row) : null;
const text = (value: unknown): string =>
  typeof value === 'string'
    ? value
    : typeof value === 'number'
      ? String(value)
      : '';
const integer = (value: unknown): number | null => {
  if (typeof value === 'number') return Number.isInteger(value) ? value : null;
  if (typeof value === 'string' && /^\d{1,9}$/.test(value.trim()))
    return Number(value.trim());
  return null;
};

/** ERP branches of the imported groups, validated. Duplicated ids/codes are dropped with a note. */
export function parseBranches(rows: unknown[]): {
  scope: ErpBranch[];
  notes: BranchNote[];
} {
  const notes: BranchNote[] = [];
  const candidates: ErpBranch[] = [];
  for (const raw of rows) {
    const row = asRow(raw);
    if (!row || !ERP_BRANCH_GROUPS.includes(text(row.branch_group).trim()))
      continue;
    const id = integer(row.branch_id);
    const code = text(row.branch_code).trim();
    if (id === null || !code || code.length > 64) {
      notes.push({
        code: code || String(row.branch_id ?? '?'),
        reason:
          'ข้อมูลสาขาใน ERP ไม่ครบหรือไม่ถูกต้อง (branch_id / branch_code)',
      });
      continue;
    }
    candidates.push({
      erpBranchId: id,
      code,
      name: (text(row.branch_name).trim() || code).slice(0, 191),
      phone: text(row.branch_tel).trim().slice(0, 64),
      active: text(row.status).trim().toLowerCase() === 'active',
    });
  }
  const count = <K>(key: (b: ErpBranch) => K) => {
    const map = new Map<K, number>();
    for (const b of candidates) map.set(key(b), (map.get(key(b)) ?? 0) + 1);
    return map;
  };
  const ids = count((b) => b.erpBranchId);
  const codes = count((b) => b.code);
  const scope = candidates.filter((b) => {
    const duplicated =
      (ids.get(b.erpBranchId) ?? 0) > 1 || (codes.get(b.code) ?? 0) > 1;
    if (duplicated)
      notes.push({
        code: b.code,
        reason: 'branch_id หรือ branch_code ซ้ำใน ERP จึงข้ามสาขานี้',
      });
    return !duplicated;
  });
  return { scope, notes };
}

/** Active ERP staff of the imported branches that can get an SES account, plus the reasons for the others. */
export function parsePeople(
  rows: unknown[],
  branches: ErpBranch[],
): {
  people: ErpPerson[];
  skipped: StaffNote[];
  warnings: StaffNote[];
  outOfScope: number;
} {
  const byId = new Map(branches.map((b) => [b.erpBranchId, b]));
  const skipped: StaffNote[] = [];
  const warnings: StaffNote[] = [];
  const candidates: ErpPerson[] = [];
  let outOfScope = 0;
  for (const raw of rows) {
    const row = asRow(raw);
    if (!row || text(row.status).trim().toLowerCase() !== 'active') continue;
    const erpBranchId = integer(row.branch_id);
    const branch = erpBranchId === null ? undefined : byId.get(erpBranchId);
    if (!branch || erpBranchId === null) {
      outOfScope += 1;
      continue;
    }
    const erpStaffId = integer(row.staff_id);
    if (erpStaffId === null || erpStaffId < 1) {
      skipped.push({
        staffId: text(row.staff_id) || '?',
        reason: 'ไม่มี staff_id ที่ใช้ได้ใน ERP',
      });
      continue;
    }
    const staffId = String(erpStaffId);
    if (!branch.active) {
      skipped.push({
        staffId,
        reason: `สาขา ${branch.code} ปิดแล้วใน ERP จึงไม่มีบัญชี`,
      });
      continue;
    }
    const password = text(row['user password']);
    if (!password.trim()) {
      skipped.push({ staffId, reason: 'ไม่มีรหัสผ่าน (user password) ใน ERP' });
      continue;
    }
    if (password.length > 128) {
      skipped.push({ staffId, reason: 'รหัสผ่านใน ERP ยาวเกิน 128 ตัวอักษร' });
      continue;
    }
    const roles = rolesForPosition(text(row.position));
    if (!roles.length) {
      skipped.push({
        staffId,
        reason: `ตำแหน่ง "${text(row.position).trim() || 'ไม่ระบุ'}" ยังไม่ได้กำหนดสิทธิ์ใน SES`,
      });
      continue;
    }
    const userName = text(row['user name']).trim();
    if (userName && userName !== staffId)
      warnings.push({
        staffId,
        reason: `user name ใน ERP (${userName}) ไม่ตรงกับ staff_id ใช้ staff_id เป็นรหัสเข้าระบบ`,
      });
    candidates.push({
      erpStaffId,
      staffId,
      firstName: text(row.name_first_th).trim().slice(0, 100),
      lastName: text(row.name_last_th).trim().slice(0, 100),
      erpBranchId,
      roles,
      password,
    });
  }
  const seen = new Map<number, number>();
  for (const p of candidates)
    seen.set(p.erpStaffId, (seen.get(p.erpStaffId) ?? 0) + 1);
  const people = candidates.filter((p) => {
    const duplicated = (seen.get(p.erpStaffId) ?? 0) > 1;
    if (duplicated)
      skipped.push({
        staffId: p.staffId,
        reason: 'staff_id ซ้ำใน ERP จึงข้ามทุกแถวที่ซ้ำ',
      });
    return !duplicated;
  });
  return { people, skipped, warnings, outOfScope };
}

/** "10:00,15:30" -> minutes of the day. Empty string = no schedule. */
export function parseTimes(value: string): number[] {
  return value
    .split(',')
    .map((x) => x.trim())
    .filter((x) => /^\d{1,2}:\d{2}$/.test(x))
    .map((x) => {
      const [h = NaN, m = NaN] = x.split(':').map(Number);
      return h * 60 + m;
    })
    .filter((x) => x >= 0 && x < 24 * 60);
}

/** Latest scheduled slot (Bangkok wall time, `YYYY-MM-DDTHH:MM`) that is due and still inside the catch-up window. */
export function dueSlot(
  now: Date,
  times: number[],
  catchupMin: number,
): string | null {
  const nowBkk = now.getTime() + BKK_MS;
  const dayStart = Math.floor(nowBkk / 86_400_000) * 86_400_000;
  let best: number | null = null;
  for (const base of [dayStart, dayStart - 86_400_000])
    for (const m of times) {
      const at = base + m * 60_000;
      const late = nowBkk - at;
      if (
        late >= 0 &&
        late < catchupMin * 60_000 &&
        (best === null || at > best)
      )
        best = at;
    }
  return best === null ? null : new Date(best).toISOString().slice(0, 16);
}

/** Next scheduled run after `now`, as an ISO string with the +07:00 offset. */
export function nextRunAt(now: Date, times: number[]): string | null {
  if (!times.length) return null;
  const nowBkk = now.getTime() + BKK_MS;
  const dayStart = Math.floor(nowBkk / 86_400_000) * 86_400_000;
  let best: number | null = null;
  for (const base of [dayStart, dayStart + 86_400_000])
    for (const m of times) {
      const at = base + m * 60_000;
      if (at > nowBkk && (best === null || at < best)) best = at;
    }
  return best === null
    ? null
    : `${new Date(best).toISOString().slice(0, 16)}:00+07:00`;
}

// ---------------------------------------------------------------------------
// ERP OData client
// ---------------------------------------------------------------------------
// FileMaker rejects `+` for a space and a percent-encoded `$`; quoted field names must use %20 (see ODATA_FINDINGS).
const BRANCH_QUERY = `$select=branch_id,branch_code,branch_name,branch_tel,branch_group,status&$top=${MAX_ROWS}`;
// No `$filter`: filtering on `status` can force FileMaker to evaluate the whole table, and a filtered query was
// followed by an OData hang on 2026-10-12. The narrow `$select` alone took 0.3 s for all 713 rows; filter here instead.
const STAFF_QUERY =
  '$select=staff_id,%22user%20name%22,%22user%20password%22,status,branch_id,position,name_first_th,name_last_th' +
  `&$top=${MAX_ROWS}`;
// eslint-disable-next-line no-control-regex
const RAW_CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g;

/** JSON.parse that tolerates raw control characters FileMaker sometimes leaves inside text fields. */
export function parseOData(body: string): unknown {
  try {
    return JSON.parse(body);
  } catch (error) {
    RAW_CONTROL.lastIndex = 0;
    if (!RAW_CONTROL.test(body)) throw error;
    RAW_CONTROL.lastIndex = 0;
    return JSON.parse(
      body.replace(
        RAW_CONTROL,
        (ch) => `\\u${ch.charCodeAt(0).toString(16).padStart(4, '0')}`,
      ),
    );
  }
}

/**
 * One GET against the ERP. A timeout is final: an ERP that does not answer is overloaded and a retry would only add load
 * (the shops sell on the same FileMaker server). Connection errors and 5xx are retried once; 4xx never. No credentials in errors.
 */
export async function odataRows(
  cfg: ErpConfig,
  entity: string,
  query: string,
  timeoutMs = 60_000,
): Promise<unknown[]> {
  const url = `${cfg.baseUrl.replace(/\/+$/, '')}/${entity}?${query}`;
  const authorization = `Basic ${Buffer.from(`${cfg.user}:${cfg.pass}`).toString('base64')}`;
  let lastError = 'unknown';
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const controller = new AbortController();
    // The timer must cover reading the body, not only the headers.
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        headers: { authorization, accept: 'application/json' },
        signal: controller.signal,
      });
      const body = await res.text();
      if (res.status === 401 || res.status === 403)
        throw new NoRetryError(
          `ERP ปฏิเสธการเข้าถึง (HTTP ${res.status}) ตรวจ ERP_ODATA_USER / ERP_ODATA_PASS`,
        );
      if (res.status >= 400 && res.status < 500)
        throw new NoRetryError(
          `ERP ตอบ HTTP ${res.status} ที่ ${entity}: ${body.slice(0, 200)}`,
        );
      if (!res.ok) {
        lastError = `ERP ตอบ HTTP ${res.status} ที่ ${entity}`;
      } else {
        const parsed = asRow(parseOData(body));
        if (parsed && Array.isArray(parsed.value)) return parsed.value;
        lastError = `ERP ตอบกลับรูปแบบที่ไม่รู้จักที่ ${entity}`;
      }
    } catch (error) {
      if (error instanceof NoRetryError) throw error;
      if (controller.signal.aborted)
        throw new NoRetryError(
          `ERP ไม่ตอบภายใน ${Math.round(timeoutMs / 1000)} วินาทีที่ ${entity} (ERP อาจกำลังช้า จึงไม่ลองซ้ำ)`,
        );
      lastError = `ติดต่อ ERP ที่ ${entity} ไม่สำเร็จ: ${error instanceof Error ? error.message : String(error)}`;
    } finally {
      clearTimeout(timer);
    }
    if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 3000));
  }
  throw new Error(lastError);
}
class NoRetryError extends Error {}

async function mapPool<T>(
  items: T[],
  limit: number,
  work: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) await work(items[next++] as T);
    }),
  );
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------
@Injectable()
export class ErpSyncService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly log = new Logger('ErpSync');
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly accounts: AccountsService,
    private readonly config: ConfigService,
  ) {}

  private erpConfig(): ErpConfig | null {
    const baseUrl = (
      this.config.get<string>('ERP_ODATA_BASE_URL') ?? ''
    ).trim();
    const user = this.config.get<string>('ERP_ODATA_USER') ?? '';
    const pass = this.config.get<string>('ERP_ODATA_PASS') ?? '';
    return baseUrl && user && pass ? { baseUrl, user, pass } : null;
  }
  private times(): number[] {
    return parseTimes(this.config.get<string>('ERP_SYNC_TIMES') ?? '10:00');
  }
  private catchupMin(): number {
    const value = Number(this.config.get<string>('ERP_SYNC_CATCHUP_MIN') ?? 60);
    return Number.isFinite(value) && value > 0 ? value : 60;
  }

  onApplicationBootstrap(): void {
    const times = this.times();
    if (!this.erpConfig()) {
      this.log.warn(
        'ERP sync is off: set ERP_ODATA_BASE_URL, ERP_ODATA_USER and ERP_ODATA_PASS to enable it',
      );
      return;
    }
    if (!times.length) {
      this.log.log('ERP sync schedule is empty (manual runs only)');
      return;
    }
    this.timer = setInterval(() => void this.tick(), TICK_MS);
    this.timer.unref();
    this.log.log(
      `ERP sync scheduled daily at ${times.map((m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`).join(', ')} (Asia/Bangkok)`,
    );
  }
  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private async tick(): Promise<void> {
    try {
      const slot = dueSlot(new Date(), this.times(), this.catchupMin());
      if (!slot || this.running) return;
      this.running = true;
      try {
        const claim = await this.claim(slot, 'schedule', false, null);
        if (claim)
          await this.execute(claim.id, { dryRun: false, force: false });
      } finally {
        this.running = false;
      }
    } catch (error) {
      this.log.error(
        `scheduled ERP sync tick failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /** Reserve a run row. A scheduled slot is claimable once across containers; a failed or abandoned one can be retried a few times. */
  async claim(
    slot: string,
    trigger: 'schedule' | 'manual',
    dryRun: boolean,
    actorStaffId: string | null,
  ): Promise<{ id: string } | null> {
    try {
      const row = await this.prisma.erpSyncRun.create({
        data: { kind: KIND, slot, trigger, dryRun, actorStaffId },
      });
      return { id: row.id };
    } catch (error) {
      if (!(
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ))
        throw error;
    }
    if (trigger !== 'schedule') return null;
    const now = Date.now();
    const reclaimed = await this.prisma.erpSyncRun.updateMany({
      where: {
        kind: KIND,
        slot,
        attempts: { lt: MAX_ATTEMPTS },
        OR: [
          { ok: false, finishedAt: { lte: new Date(now - RETRY_AFTER_MS) } },
          {
            ok: null,
            finishedAt: null,
            startedAt: { lte: new Date(now - ABANDON_AFTER_MS) },
          },
        ],
      },
      data: {
        attempts: { increment: 1 },
        startedAt: new Date(now),
        finishedAt: null,
        ok: null,
        error: null,
      },
    });
    if (reclaimed.count !== 1) return null;
    const row = await this.prisma.erpSyncRun.findUnique({
      where: { kind_slot: { kind: KIND, slot } },
    });
    return row ? { id: row.id } : null;
  }

  /**
   * ADMIN "run now" (and dry run). Returns as soon as the run is reserved so a slow ERP cannot hit the 60 s proxy timeout;
   * the panel polls `status`. `wait` (used by tests) holds the response until the run is finished.
   */
  async runManual(
    actorStaffId: string,
    dryRun: boolean,
    force: boolean,
    wait = false,
  ): Promise<ErpSyncRunDto> {
    if (!this.erpConfig())
      throw new BadRequestException(
        'ยังไม่ได้ตั้งค่า ERP (ERP_ODATA_BASE_URL / ERP_ODATA_USER / ERP_ODATA_PASS)',
      );
    if (this.running)
      throw new ConflictException('กำลังซิงก์ ERP อยู่ รอให้เสร็จก่อน');
    this.running = true; // before the first await, so a second click gets 409
    let claim: { id: string } | null;
    try {
      claim = await this.claim(
        `manual-${new Date().toISOString()}-${Math.random().toString(16).slice(2, 6)}`,
        'manual',
        dryRun,
        actorStaffId,
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
    return toDto(
      await this.prisma.erpSyncRun.findUniqueOrThrow({
        where: { id: claim.id },
      }),
    );
  }

  private async execute(
    runId: string,
    options: { dryRun: boolean; force: boolean },
  ): Promise<ErpSyncRunDto> {
    this.running = true;
    try {
      const cfg = this.erpConfig();
      if (!cfg) throw new Error('ยังไม่ได้ตั้งค่า ERP');
      const summary = await this.syncOnce(cfg, options);
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
        `ERP sync ${options.dryRun ? '(dry run) ' : ''}done: staff +${summary.staff.created} ~${summary.staff.updated} -${summary.staff.deactivated}, branches +${summary.branches.created} ~${summary.branches.updated}`,
      );
    } catch (error) {
      const message = (
        error instanceof Error ? error.message : String(error)
      ).slice(0, 1000);
      this.log.error(`ERP sync failed: ${message}`);
      await this.prisma.erpSyncRun.update({
        where: { id: runId },
        data: { finishedAt: new Date(), ok: false, error: message },
      });
    } finally {
      this.running = false;
    }
    const row = await this.prisma.erpSyncRun.findUniqueOrThrow({
      where: { id: runId },
    });
    return toDto(row);
  }

  /** Fetch from the ERP, prepare password hashes (slow, outside the account lock), then apply in one transaction. */
  private async syncOnce(
    cfg: ErpConfig,
    options: { dryRun: boolean; force: boolean },
  ): Promise<ErpSyncSummary> {
    // One request at a time: FileMaker queues requests and the shops sell on the same server.
    const branchRows = await odataRows(cfg, 'branch', BRANCH_QUERY);
    const staffRows = await odataRows(cfg, 'staff', STAFF_QUERY);
    if (branchRows.length >= MAX_ROWS || staffRows.length >= MAX_ROWS)
      throw new Error(
        `ERP ส่งข้อมูลถึงเพดาน ${MAX_ROWS} แถว อาจถูกตัด จึงยกเลิกการซิงก์`,
      );
    const { scope, notes } = parseBranches(branchRows);
    if (!scope.length)
      throw new Error(
        'ไม่พบสาขากลุ่ม iStudio/U-Store ใน ERP จึงยกเลิกการซิงก์',
      );
    const parsed = parsePeople(staffRows, scope);
    const plan: Plan = {
      branches: scope,
      branchNotes: notes,
      ...parsed,
      hashes: new Map(),
    };

    const managed = await this.prisma.staff.findMany({
      where: { erpStaffId: { not: null } },
      select: { erpStaffId: true, passwordHash: true },
    });
    const stored = new Map(
      managed.map((m) => [m.erpStaffId as number, m.passwordHash]),
    );
    await mapPool(plan.people, HASH_CONCURRENCY, async (person) => {
      const current = stored.get(person.erpStaffId);
      if (
        current !== undefined &&
        (await verifyPassword(person.password, current))
      ) {
        plan.hashes.set(person.erpStaffId, null);
        return;
      }
      plan.hashes.set(
        person.erpStaffId,
        options.dryRun ? 'dry-run' : await hashPassword(person.password),
      );
    });

    try {
      return await this.accounts.transaction(async (tx) => {
        const summary = await this.apply(tx, plan, options.force);
        // Throwing inside the callback is what rolls a dry run back.
        if (options.dryRun) throw new DryRunRollback(summary);
        return summary;
      });
    } catch (error) {
      if (error instanceof DryRunRollback) return error.summary;
      throw error;
    }
  }

  /** Runs inside the AccountLock transaction. For a dry run the caller rolls everything back. */
  private async apply(
    tx: Tx,
    plan: Plan,
    force: boolean,
  ): Promise<ErpSyncSummary> {
    const now = new Date();
    const summary: ErpSyncSummary = {
      branches: {
        scope: plan.branches.length,
        created: 0,
        updated: 0,
        adopted: 0,
        deactivated: 0,
        unchanged: 0,
        notes: [...plan.branchNotes],
      },
      staff: {
        eligible: plan.people.length,
        outOfScope: plan.outOfScope,
        created: 0,
        updated: 0,
        passwordChanged: 0,
        reactivated: 0,
        deactivated: 0,
        unchanged: 0,
        skipped: [...plan.skipped],
        warnings: [...plan.warnings],
      },
    };

    // 1. Branches: create / update / activate now; deactivation waits until the staff were handled (D39 order).
    const sesBranches = await tx.branch.findMany();
    const byErpId = new Map(
      sesBranches
        .filter((b) => b.erpBranchId !== null)
        .map((b) => [b.erpBranchId as number, b]),
    );
    const branchOf = new Map<number, { id: string; active: boolean }>();
    const toDeactivate: { id: string; code: string }[] = [];
    for (const erp of [...plan.branches].sort((a, b) =>
      a.code.localeCompare(b.code),
    )) {
      let found = byErpId.get(erp.erpBranchId);
      let adopted = false;
      if (!found) {
        const sameCode = sesBranches.filter((b) => b.code === erp.code);
        const free = sameCode.filter((b) => b.erpBranchId === null);
        if (sameCode.length > free.length) {
          summary.branches.notes.push({
            code: erp.code,
            reason: 'รหัสสาขานี้ผูกกับสาขา ERP อื่นอยู่แล้วใน SES จึงข้าม',
          });
          continue;
        }
        if (free.length > 1) {
          summary.branches.notes.push({
            code: erp.code,
            reason:
              'มีสาขาใน SES ที่รหัสนี้ซ้ำกันหลายแถว จึงไม่รู้ว่าจะผูกแถวไหน',
          });
          continue;
        }
        found = free[0];
        adopted = Boolean(found);
      }
      if (!found) {
        if (!erp.active) continue; // a closed ERP branch that SES never had is not worth a row
        const created = await tx.branch.create({
          data: {
            code: erp.code,
            name: erp.name,
            phone: erp.phone,
            active: true,
            erpBranchId: erp.erpBranchId,
          },
        });
        summary.branches.created += 1;
        branchOf.set(erp.erpBranchId, { id: created.id, active: true });
        continue;
      }
      const data: Prisma.BranchUpdateInput = {};
      if (adopted) data.erpBranchId = erp.erpBranchId;
      if (found.code !== erp.code) data.code = erp.code;
      if (found.name !== erp.name) data.name = erp.name;
      if (found.phone !== erp.phone) data.phone = erp.phone;
      if (erp.active && !found.active) data.active = true;
      if (!erp.active && found.active)
        toDeactivate.push({ id: found.id, code: erp.code });
      if (Object.keys(data).length) {
        await tx.branch.update({ where: { id: found.id }, data });
        if (adopted) summary.branches.adopted += 1;
        else summary.branches.updated += 1;
      } else summary.branches.unchanged += 1;
      branchOf.set(erp.erpBranchId, {
        id: found.id,
        active: erp.active || found.active,
      });
    }
    const inScopeErpIds = new Set(plan.branches.map((b) => b.erpBranchId));
    for (const b of sesBranches)
      if (b.erpBranchId !== null && !inScopeErpIds.has(b.erpBranchId))
        summary.branches.notes.push({
          code: b.code,
          reason:
            'สาขาที่ซิงก์ไว้ไม่อยู่ในกลุ่ม iStudio/U-Store ของ ERP แล้ว (ไม่เปลี่ยนแปลง)',
        });

    // 2. Staff
    const ids = plan.people.map((p) => p.staffId);
    const existing = await tx.staff.findMany({
      where: { OR: [{ erpStaffId: { not: null } }, { staffId: { in: ids } }] },
      include: { roles: true },
    });
    const managedByErp = new Map(
      existing
        .filter((s) => s.erpStaffId !== null)
        .map((s) => [s.erpStaffId as number, s]),
    );
    const byStaffId = new Map(existing.map((s) => [s.staffId, s]));
    const people = [...plan.people].sort((a, b) => a.erpStaffId - b.erpStaffId);

    const leavers = existing.filter(
      (s) =>
        s.erpStaffId !== null &&
        s.active &&
        !plan.people.some((p) => p.erpStaffId === s.erpStaffId),
    );
    const activeManaged = existing.filter(
      (s) => s.erpStaffId !== null && s.active,
    ).length;
    if (!force && leavers.length > Math.max(5, Math.ceil(activeManaged * 0.3)))
      throw new Error(
        `ยกเลิกการซิงก์เพื่อความปลอดภัย: จะปิดบัญชี ${leavers.length} จาก ${activeManaged} บัญชีที่ซิงก์ไว้ ` +
          'ตรวจข้อมูลใน ERP แล้วสั่งรันซ้ำแบบ force ถ้าถูกต้อง',
      );

    for (const person of people) {
      const sb = branchOf.get(person.erpBranchId);
      const match = managedByErp.get(person.erpStaffId);
      if (!sb) {
        summary.staff.skipped.push({
          staffId: person.staffId,
          reason: 'ไม่พบสาขาที่ใช้ได้ใน SES',
        });
        continue;
      }
      if (!match) {
        if (byStaffId.has(person.staffId)) {
          summary.staff.skipped.push({
            staffId: person.staffId,
            reason: 'รหัสนี้เป็นบัญชีที่สร้างเองใน SES จึงไม่แตะ',
          });
          continue;
        }
        await tx.staff.create({
          data: {
            staffId: person.staffId,
            firstName: person.firstName,
            lastName: person.lastName,
            passwordHash: plan.hashes.get(person.erpStaffId) ?? '',
            branchId: sb.id,
            active: true,
            mustChangePassword: false,
            erpStaffId: person.erpStaffId,
            erpSyncedAt: now,
            roles: { create: person.roles.map((roleCode) => ({ roleCode })) },
          },
        });
        summary.staff.created += 1;
        continue;
      }
      const data: Prisma.StaffUpdateInput = {};
      const newHash = plan.hashes.get(person.erpStaffId) ?? null;
      if (match.firstName !== person.firstName)
        data.firstName = person.firstName;
      if (match.lastName !== person.lastName) data.lastName = person.lastName;
      if (match.branchId !== sb.id) data.branch = { connect: { id: sb.id } };
      if (!match.active) {
        data.active = true;
        summary.staff.reactivated += 1;
      }
      if (match.mustChangePassword) data.mustChangePassword = false;
      if (newHash) {
        data.passwordHash = newHash;
        summary.staff.passwordChanged += 1;
      }
      const have = new Set(match.roles.map((r) => r.roleCode));
      const wanted = new Set(person.roles);
      const drop = ERP_MANAGED_ROLES.filter(
        (r) => have.has(r) && !wanted.has(r),
      );
      const add = person.roles.filter((r) => !have.has(r));
      if (drop.length)
        await tx.staffRole.deleteMany({
          where: { staffId: match.staffId, roleCode: { in: drop } },
        });
      if (add.length)
        await tx.staffRole.createMany({
          data: add.map((roleCode) => ({ staffId: match.staffId, roleCode })),
        });
      const changed =
        Object.keys(data).length > 0 || drop.length > 0 || add.length > 0;
      if (!changed) {
        summary.staff.unchanged += 1;
        continue;
      }
      await tx.staff.update({
        where: { staffId: match.staffId },
        data: { ...data, erpSyncedAt: now },
      });
      if (newHash)
        await tx.loginSession.deleteMany({ where: { staffId: match.staffId } });
      summary.staff.updated += 1;
    }

    // 3. Leavers: accounts this import created that are no longer eligible.
    for (const leaver of leavers) {
      if (leaver.roles.some((r) => r.roleCode === 'ADMIN')) {
        const others = await tx.staff.count({
          where: {
            staffId: { not: leaver.staffId },
            active: true,
            roles: { some: { roleCode: 'ADMIN' } },
          },
        });
        if (!others) {
          summary.staff.skipped.push({
            staffId: leaver.staffId,
            reason: 'เป็น ADMIN ที่ใช้งานคนสุดท้าย จึงไม่ปิดบัญชี',
          });
          continue;
        }
      }
      await tx.staff.update({
        where: { staffId: leaver.staffId },
        data: { active: false, erpSyncedAt: now },
      });
      await tx.loginSession.deleteMany({ where: { staffId: leaver.staffId } });
      summary.staff.deactivated += 1;
    }

    // 4. Branches closed in the ERP: only when no active staff are left there (D39).
    for (const b of toDeactivate) {
      const left = await tx.staff.count({
        where: { branchId: b.id, active: true },
      });
      if (left) {
        summary.branches.notes.push({
          code: b.code,
          reason: `สาขาปิดใน ERP แต่ยังมี Staff ใช้งาน ${left} คนใน SES จึงยังไม่ปิดสาขา`,
        });
        continue;
      }
      await tx.branch.update({ where: { id: b.id }, data: { active: false } });
      summary.branches.deactivated += 1;
    }

    summary.staff.skipped = summary.staff.skipped.slice(0, SKIP_LIMIT);
    summary.staff.warnings = summary.staff.warnings.slice(0, SKIP_LIMIT);
    summary.branches.notes = summary.branches.notes.slice(0, SKIP_LIMIT);
    return summary;
  }

  async status(): Promise<{
    configured: boolean;
    schedule: string[];
    timezone: string;
    nextRunAt: string | null;
    running: boolean;
    lastRuns: ErpSyncRunDto[];
  }> {
    const times = this.times();
    const rows = await this.prisma.erpSyncRun.findMany({
      orderBy: { startedAt: 'desc' },
      take: 10,
    });
    const configured = this.erpConfig() !== null;
    return {
      configured,
      schedule: configured
        ? times.map(
            (m) =>
              `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`,
          )
        : [],
      timezone: 'Asia/Bangkok',
      nextRunAt: configured ? nextRunAt(new Date(), times) : null,
      running: this.running,
      lastRuns: rows.map(toDto),
    };
  }
}

function toDto(row: Prisma.ErpSyncRunGetPayload<object>): ErpSyncRunDto {
  // MySQL returns a parsed object; MariaDB (local tests) returns the JSON text.
  const summary =
    typeof row.summary === 'string'
      ? (JSON.parse(row.summary) as ErpSyncSummary)
      : (row.summary as unknown as ErpSyncSummary | null);
  return {
    id: row.id,
    kind: row.kind,
    slot: row.slot,
    trigger: row.trigger,
    dryRun: row.dryRun,
    attempts: row.attempts,
    startedAt: row.startedAt.toISOString(),
    finishedAt: row.finishedAt ? row.finishedAt.toISOString() : null,
    ok: row.ok,
    error: row.error,
    actorStaffId: row.actorStaffId,
    summary,
  };
}
