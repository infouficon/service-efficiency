import { BadRequestException, Injectable, Logger, NotFoundException, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { loadPaymentTypes, orderView, type OrderViewSource } from '../sessions/order-view';

/** What `enqueue` needs of a session: the order view plus its branch. */
export type FmpSession = OrderViewSource & { id: string; branch: { code: string; name: string } };
type Outbox = Pick<PrismaService, 'fmpOutbox' | 'fmpLog' | 'paymentMethod'> | Prisma.TransactionClient;

/** Minutes to wait before attempt 2, 3, … (attempt 1 is at once); after the last one the message is `failed` until an ADMIN retries it. */
const BACKOFF_MINUTES = [1, 2, 5, 10, 20, 30, 60];
export const FMP_MAX_ATTEMPTS = BACKOFF_MINUTES.length + 1;
const TICK_DEFAULT_SECONDS = 10;
const BATCH = 20;
const STALE_SENDING_MS = 5 * 60_000;
const HTTP_TIMEOUT_MS = 15_000;
/** The admin log (D90): how long a row is kept, how often the worker clears the old ones, and the longest body kept per row. */
const LOG_KEEP_DAYS = 90;
const PRUNE_EVERY_MS = 6 * 3_600_000;
const BODY_MAX = 8000;
/** Where FileMaker reports back (the route is in fmp.controller.ts); shown in the log. */
export const FMP_CALLBACK_PATH = '/api/integrations/fmp/callback';

interface FmpConfig {
  base: string;
  database: string;
  user: string;
  password: string;
  layout: string;
  field: string;
  script: string | null;
}
interface FmResponse {
  status: number;
  code: string;
  message: string;
  response: Record<string, unknown>;
}
/** What one Data API call is for, so its log row says so: Thai wording, the order it belongs to, the body sent. */
interface Trace {
  kind: 'login' | 'create' | 'logout';
  what: string;
  batchId: string;
  outboxId?: string;
  reference?: string;
  request?: string;
}
/** One row of the admin log (D90). */
interface LogEntry {
  direction: 'OUT' | 'IN' | 'SES';
  kind: string;
  ok: boolean;
  summary: string;
  batchId?: string | null;
  outboxId?: string | null;
  reference?: string | null;
  method?: string | null;
  path?: string | null;
  httpStatus?: number | null;
  fmCode?: string | null;
  durationMs?: number | null;
  request?: string | null;
  response?: string | null;
}

const PERSONAL_KEY = /phone|tel|mobile|msisdn/i;
const cut = (text: string) => (text.length > BODY_MAX ? `${text.slice(0, BODY_MAX)}…[ตัด]` : text);
/** `0812345678` -> `******5678`: enough to tell two customers apart, not enough to call one. */
export function maskPhone(value: string | number): string {
  const text = String(value);
  return text.length <= 4 ? '*'.repeat(text.length) : '*'.repeat(text.length - 4) + text.slice(-4);
}
/** A JSON text for the log: every phone-like value masked. Not JSON: kept as it is (cut), it is FileMaker's own words. */
export function maskedJson(value: unknown): string {
  const walk = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(walk);
    if (node && typeof node === 'object')
      return Object.fromEntries(
        Object.entries(node).map(([k, v]) => [k, PERSONAL_KEY.test(k) && (typeof v === 'string' || typeof v === 'number') ? maskPhone(v) : walk(v)]),
      );
    return node;
  };
  let parsed: unknown = value;
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value);
    } catch {
      return cut(value);
    }
  }
  return cut(JSON.stringify(walk(parsed)));
}
/** A response body for the log: the Data API session token is the only secret it can carry. */
const redactToken = (text: string) => text.replace(/("token"\s*:\s*")[^"]*(")/gi, '$1[redacted]$2');

const pickText = (source: Record<string, unknown>, keys: string[], max = 255): string | null => {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      const text = String(value).trim();
      if (text) return text.slice(0, max);
    }
  }
  return null;
};

/** What FileMaker says it did: `status` "success" / "error" (or a boolean). Anything else is kept as `reported`. */
export function ackStatusOf(body: Record<string, unknown>): 'success' | 'error' | 'reported' {
  for (const key of ['status', 'result', 'state', 'success', 'ok']) {
    const value = body[key];
    if (value === true) return 'success';
    if (value === false) return 'error';
    if (typeof value !== 'string') continue; // a number is ambiguous (FileMaker's 0 means "no error"): never guessed
    const word = value.trim().toLowerCase();
    if (/^(true|ok|success|succeeded|successful|done|complete|completed|สำเร็จ|เรียบร้อย)$/.test(word)) return 'success';
    if (/^(false|error|fail|failed|failure|ผิดพลาด|ไม่สำเร็จ|ล้มเหลว)$/.test(word)) return 'error';
  }
  return 'reported';
}

/**
 * The time FileMaker sends with a report. Understood: ISO 8601 with an offset or `Z`, the same without one (read as Bangkok
 * time, `YYYY-MM-DD HH:mm:ss` too), and epoch seconds / milliseconds. FileMaker's own `MM/DD/YYYY` text is NOT guessed (day and
 * month are ambiguous): null, and the text stays visible in the log.
 */
export function parseFmpTime(text: string): Date | null {
  const t = text.trim();
  if (/^\d{10}$/.test(t)) return new Date(Number(t) * 1000);
  if (/^\d{13}$/.test(t)) return new Date(Number(t));
  const m = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?)(Z|[+-]\d{2}:?\d{2})?$/.exec(t);
  if (!m) return null;
  const zone = !m[3] ? '+07:00' : m[3] === 'Z' ? 'Z' : m[3].replace(/^([+-]\d{2})(\d{2})$/, '$1:$2');
  const date = new Date(`${m[1]}T${m[2]}${zone}`);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * SES -> FileMaker (D88). When an order reaches the cashier SES writes a row of `FmpOutbox` in the same transaction; a worker
 * creates one record per row in the `ses` layout of the UFService database through the FileMaker Data API, putting the order
 * (the very same view the U POS door serves, `orderView`) as JSON text into the `ses_body` field. Per batch: one login, the
 * sends, one logout (FileMaker is slow to drop idle tokens). Retries with a back-off; at-least-once, so FileMaker dedupes by
 * `outboxId`. Nothing happens until `FMP_HOST`, `FMP_DATABASE`, `FMP_USER` and `FMP_PASSWORD` are set. Credentials are never logged.
 */
@Injectable()
export class FmpService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly log = new Logger('Fmp');
  private timer: ReturnType<typeof setInterval> | null = null;
  private first: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private lastPrune = 0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  private get(name: string): string {
    return (this.config.get<string>(name) ?? '').trim();
  }
  private cfg(): FmpConfig | null {
    const base = this.get('FMP_HOST').replace(/\/+$/, '');
    const database = this.get('FMP_DATABASE');
    const user = this.get('FMP_USER');
    const password = this.config.get<string>('FMP_PASSWORD') ?? '';
    if (!base || !database || !user || !password) return null;
    return {
      base,
      database,
      user,
      password,
      layout: this.get('FMP_LAYOUT') || 'ses',
      field: this.get('FMP_FIELD') || 'ses_body',
      script: this.get('FMP_SCRIPT') || null,
    };
  }
  configured(): boolean {
    return this.cfg() !== null;
  }

  onApplicationBootstrap(): void {
    if (!this.configured()) return;
    const seconds = Number(this.get('FMP_WORKER_INTERVAL_SECONDS') || TICK_DEFAULT_SECONDS);
    if (!(seconds > 0)) {
      this.log.log('FileMaker push configured; worker off (FMP_WORKER_INTERVAL_SECONDS=0): sends only on request');
      return;
    }
    this.timer = setInterval(() => void this.tick(), seconds * 1000);
    this.timer.unref();
    this.first = setTimeout(() => void this.tick(), 5_000);
    this.first.unref();
    this.log.log(`FileMaker push on: layout ${this.cfg()!.layout}, field ${this.cfg()!.field}, every ${seconds} s`);
  }
  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    if (this.first) clearTimeout(this.first);
  }

  /** Writes one row of the admin log. Best effort: a log that cannot be written never stops an order or a send. */
  async record(entry: LogEntry, db: Pick<PrismaService, 'fmpLog'> | Prisma.TransactionClient = this.prisma): Promise<void> {
    try {
      await db.fmpLog.create({
        data: {
          id: randomUUID(),
          createdAt: new Date(),
          direction: entry.direction,
          kind: entry.kind,
          ok: entry.ok,
          summary: entry.summary.slice(0, 255),
          batchId: entry.batchId ?? null,
          outboxId: entry.outboxId ?? null,
          reference: entry.reference?.slice(0, 32) ?? null,
          method: entry.method ?? null,
          path: entry.path?.slice(0, 255) ?? null,
          httpStatus: entry.httpStatus ?? null,
          fmCode: entry.fmCode?.slice(0, 16) ?? null,
          durationMs: entry.durationMs ?? null,
          request: entry.request ?? null,
          response: entry.response ?? null,
        },
      });
    } catch (error) {
      this.log.warn(`FileMaker log row not written: ${safe(error)}`);
    }
  }

  /** Clears the log rows older than `LOG_KEEP_DAYS` (the worker asks; it runs at most every 6 hours). */
  private async pruneLogs() {
    if (Date.now() - this.lastPrune < PRUNE_EVERY_MS) return;
    this.lastPrune = Date.now();
    try {
      await this.prisma.fmpLog.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - LOG_KEEP_DAYS * 86_400_000) } } });
    } catch (error) {
      this.log.warn(`FileMaker log clean-up failed: ${safe(error)}`);
    }
  }

  /**
   * Queues one message for FileMaker (inside the caller's transaction). Returns its id, or null when the push is not configured.
   * The payload is the order exactly as SES describes it elsewhere, plus where it comes from.
   */
  async enqueue(db: Outbox, session: FmpSession, event: string): Promise<string | null> {
    if (!this.configured()) return null;
    const id = randomUUID();
    const paymentTypes = await loadPaymentTypes(db);
    const payload = JSON.stringify({
      source: 'SES',
      event,
      outboxId: id,
      queuedAt: new Date().toISOString(),
      branch: { code: session.branch.code, name: session.branch.name },
      ...orderView(session, paymentTypes),
    });
    await db.fmpOutbox.create({
      data: { id, sessionId: session.id, reference: session.reference, event, payload },
    });
    await this.record(
      { direction: 'SES', kind: 'queued', ok: true, outboxId: id, reference: session.reference, summary: `ใส่คิวส่งไป FileMaker (${event})`, request: maskedJson(payload) },
      db,
    );
    return id;
  }

  // ---------------------------------------------------------------------------
  // Worker
  // ---------------------------------------------------------------------------
  /** One round: send what is due. Safe to call from several containers (a row is claimed before it is sent). */
  async tick(): Promise<{ sent: number; failed: number }> {
    const cfg = this.cfg();
    const result = { sent: 0, failed: 0 };
    if (!cfg || this.running) return result;
    this.running = true;
    const batchId = randomUUID();
    try {
      await this.pruneLogs();
      // a worker that died while sending leaves its rows `sending`: give them back
      await this.prisma.fmpOutbox.updateMany({
        where: { status: 'sending', lockedAt: { lt: new Date(Date.now() - STALE_SENDING_MS) } },
        data: { status: 'pending', lockedAt: null },
      });
      const due = await this.prisma.fmpOutbox.findMany({
        where: { status: 'pending', nextAttemptAt: { lte: new Date() } },
        orderBy: { createdAt: 'asc' },
        take: BATCH,
      });
      if (!due.length) return result;
      let token: string | null = null;
      try {
        for (const row of due) {
          const claimed = await this.prisma.fmpOutbox.updateMany({
            where: { id: row.id, status: 'pending' },
            data: { status: 'sending', lockedAt: new Date(), attempts: { increment: 1 } },
          });
          if (claimed.count !== 1) continue; // another container took it
          try {
            token ??= await this.login(cfg, batchId);
            let out;
            try {
              out = await this.createRecord(cfg, token, row, batchId);
            } catch (error) {
              if (!(error instanceof TokenExpired)) throw error;
              token = await this.login(cfg, batchId); // the token was dropped: once more with a new one
              out = await this.createRecord(cfg, token, row, batchId);
            }
            await this.prisma.fmpOutbox.update({
              where: { id: row.id },
              data: {
                status: 'sent',
                sentAt: new Date(),
                lockedAt: null,
                fmpRecordId: out.recordId,
                scriptResult: out.script,
                lastError: out.scriptError,
              },
            });
            result.sent += 1;
          } catch (error) {
            await this.fail(row, row.attempts + 1, error, batchId);
            result.failed += 1;
          }
        }
      } finally {
        if (token) await this.logout(cfg, token, batchId);
      }
    } catch (error) {
      this.log.error(`FileMaker push round failed: ${safe(error)}`);
    } finally {
      this.running = false;
    }
    return result;
  }

  private async fail(row: { id: string; reference: string }, attempts: number, error: unknown, batchId: string) {
    const message = safe(error);
    const dead = attempts >= FMP_MAX_ATTEMPTS;
    const wait = BACKOFF_MINUTES[Math.min(attempts - 1, BACKOFF_MINUTES.length - 1)] * 60_000;
    this.log.error(`FileMaker push ${dead ? 'gave up' : 'will retry'} (attempt ${attempts}): ${message}`);
    await this.record({
      direction: 'SES',
      kind: dead ? 'gave-up' : 'will-retry',
      ok: false,
      batchId,
      outboxId: row.id,
      reference: row.reference,
      summary: `ครั้งที่ ${attempts}/${FMP_MAX_ATTEMPTS} ไม่สำเร็จ: ${message} — ${dead ? 'เลิกส่ง ต้องกด "ส่งซ้ำ" เอง' : `ลองใหม่ใน ${wait / 60_000} นาที`}`,
    });
    await this.prisma.fmpOutbox.update({
      where: { id: row.id },
      data: {
        status: dead ? 'failed' : 'pending',
        lockedAt: null,
        lastError: message.slice(0, 255),
        nextAttemptAt: new Date(Date.now() + wait),
      },
    });
  }

  // ---------------------------------------------------------------------------
  // FileMaker Data API
  // ---------------------------------------------------------------------------
  private async fm(
    cfg: FmpConfig,
    method: 'POST' | 'DELETE',
    path: string,
    authorization: string,
    trace: Trace,
    body?: unknown,
  ): Promise<FmResponse> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);
    const started = Date.now();
    // the path as logged: no host, and the session token that ends a logout path masked
    const logPath = `/fmi/data/vLatest/databases/${encodeURIComponent(cfg.database)}${path}`.replace(/\/sessions\/[^/]+$/, '/sessions/[token]');
    const entry = { direction: 'OUT' as const, kind: trace.kind, batchId: trace.batchId, outboxId: trace.outboxId, reference: trace.reference, method, path: logPath, request: trace.request };
    try {
      const res = await fetch(`${cfg.base}/fmi/data/vLatest/databases/${encodeURIComponent(cfg.database)}${path}`, {
        method,
        headers: { 'Content-Type': 'application/json', Authorization: authorization },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: controller.signal,
      });
      const text = await res.text().catch(() => '');
      type FmJson = { response?: Record<string, unknown>; messages?: { code?: string; message?: string }[] };
      let json: FmJson | null;
      try {
        json = JSON.parse(text) as FmJson | null;
      } catch {
        json = null; // not JSON (an HTML error page of a proxy, say): the log keeps the text
      }
      const first = json?.messages?.[0];
      const out = { status: res.status, code: String(first?.code ?? ''), message: String(first?.message ?? ''), response: json?.response ?? {} };
      const recordId = out.response.recordId === undefined ? '' : ` · recordId ${String(out.response.recordId)}`;
      await this.record({
        ...entry,
        ok: out.status === 200 && out.code === '0',
        httpStatus: out.status,
        fmCode: out.code,
        durationMs: Date.now() - started,
        summary: `${trace.what} → HTTP ${out.status}${out.code ? ` · code ${out.code}` : ''}${out.message ? ` ${out.message}` : ''}${recordId}`,
        response: cut(redactToken(text)),
      });
      return out;
    } catch (error) {
      // never echo error.message: a runtime may quote the URL or headers in it
      const message = error instanceof Error && error.name === 'AbortError' ? 'FileMaker ไม่ตอบภายใน 15 วินาที' : 'เชื่อมต่อ FileMaker ไม่สำเร็จ';
      await this.record({ ...entry, ok: false, durationMs: Date.now() - started, summary: `${trace.what} → ${message}` });
      throw new Error(message);
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * A Data API session token. The header is the base64 of `user:password` with the trailing `=` taken off, as the FileMaker side
   * specified; if that is refused (401) the standard padded form is tried once.
   */
  private async login(cfg: FmpConfig, batchId: string): Promise<string> {
    const padded = Buffer.from(`${cfg.user}:${cfg.password}`).toString('base64');
    const forms = [...new Set([padded.replace(/=+$/, ''), padded])];
    let last: FmResponse | null = null;
    for (const form of forms) {
      const what = `login (header ${form === padded && forms.length === 1 ? 'Basic' : form === padded ? 'Basic แบบมาตรฐาน มี =' : 'Basic แบบตัด = ออก'})`;
      last = await this.fm(cfg, 'POST', '/sessions', `Basic ${form}`, { kind: 'login', what, batchId }, {});
      const token = last.response.token;
      if (last.status === 200 && typeof token === 'string' && token) return token;
      if (last.status !== 401) break;
    }
    throw new Error(`FileMaker login ไม่สำเร็จ (HTTP ${last?.status} ${last?.code} ${last?.message})`.trim());
  }

  private async createRecord(cfg: FmpConfig, token: string, row: { id: string; reference: string; event: string; payload: string }, batchId: string) {
    const body: Record<string, unknown> = { fieldData: { [cfg.field]: row.payload } };
    if (cfg.script) {
      body.script = cfg.script;
      body['script.param'] = row.reference; // D91: the FileMaker script takes the order's reference (its "ses id") and nothing else
    }
    const trace: Trace = {
      kind: 'create',
      what: `สร้าง record ใน layout ${cfg.layout} ฟิลด์ ${cfg.field} (${row.event})${cfg.script ? ` + script ${cfg.script}` : ''}`,
      batchId,
      outboxId: row.id,
      reference: row.reference,
      request: maskedJson(row.payload),
    };
    const res = await this.fm(cfg, 'POST', `/layouts/${encodeURIComponent(cfg.layout)}/records`, `Bearer ${token}`, trace, body);
    if (res.status === 401 || res.code === '952') throw new TokenExpired();
    if (res.status !== 200 || res.code !== '0')
      throw new Error(`FileMaker ปฏิเสธ (HTTP ${res.status} ${res.code} ${res.message})`.trim());
    const scriptError = res.response.scriptError === undefined ? '0' : String(res.response.scriptError);
    return {
      recordId: res.response.recordId === undefined ? null : String(res.response.recordId).slice(0, 32),
      script: cfg.script ? `${String(res.response.scriptResult ?? '').slice(0, 200)}` : null,
      // the record exists: a script error must not make SES send it again, it is only recorded
      scriptError: scriptError === '0' ? null : `script error ${scriptError}`,
    };
  }

  private async logout(cfg: FmpConfig, token: string, batchId: string) {
    try {
      await this.fm(cfg, 'DELETE', `/sessions/${encodeURIComponent(token)}`, 'Bearer unused', { kind: 'logout', what: 'logout (คืน token)', batchId });
    } catch {
      // the token ends by itself after ~15 minutes
    }
  }

  // ---------------------------------------------------------------------------
  // Admin
  // ---------------------------------------------------------------------------
  async status() {
    const cfg = this.cfg();
    const [counts, rows] = await Promise.all([
      this.prisma.fmpOutbox.groupBy({ by: ['status'], _count: { _all: true } }),
      this.prisma.fmpOutbox.findMany({
        orderBy: { createdAt: 'desc' },
        take: 50,
        select: {
          id: true,
          reference: true,
          event: true,
          status: true,
          attempts: true,
          nextAttemptAt: true,
          createdAt: true,
          sentAt: true,
          fmpRecordId: true,
          scriptResult: true,
          lastError: true,
          ackStatus: true,
          ackMessage: true,
          ackAt: true,
          ackTimeText: true,
          ackReceivedAt: true,
        },
      }),
    ]);
    const count = (s: string) => counts.find((c) => c.status === s)?._count._all ?? 0;
    return {
      configured: cfg !== null,
      host: cfg ? new URL(cfg.base).host : null,
      database: cfg?.database ?? null,
      layout: cfg?.layout ?? null,
      field: cfg?.field ?? null,
      script: cfg?.script ?? null,
      callback: { path: FMP_CALLBACK_PATH, keySet: this.callbackKey() !== null },
      counts: { pending: count('pending'), sending: count('sending'), sent: count('sent'), failed: count('failed') },
      rows,
    };
  }

  /** A failed (or waiting) message goes again at once. `by` is the ADMIN who asked, for the log. */
  async retry(id: string, by = 'ADMIN') {
    const row = await this.prisma.fmpOutbox.findUnique({ where: { id } });
    if (!row || !['failed', 'pending'].includes(row.status)) return null;
    await this.record({ direction: 'SES', kind: 'retry', ok: true, outboxId: row.id, reference: row.reference, summary: `${by} สั่งส่งซ้ำ (เดิม: ${row.status}, ลองมาแล้ว ${row.attempts} ครั้ง)` });
    await this.prisma.fmpOutbox.update({
      where: { id },
      data: { status: 'pending', attempts: 0, nextAttemptAt: new Date(), lockedAt: null },
    });
    return { ok: true };
  }

  /** Sends an existing order again (event `RESEND`), e.g. for the FileMaker team to test with a real order. */
  async resend(reference: string, by = 'ADMIN') {
    if (!this.configured()) return { error: 'not-configured' as const };
    const session = await this.prisma.customerSession.findUnique({
      where: { reference },
      include: {
        branch: true,
        items: { include: { sku: true }, orderBy: { createdAt: 'asc' } },
        accessories: true,
        ontop: true,
        points: true,
        burnPoints: true,
        payments: true,
      },
    });
    if (!session) return { error: 'not-found' as const };
    await this.record({ direction: 'SES', kind: 'resend', ok: true, reference, summary: `${by} สั่งส่งออเดอร์นี้ซ้ำ` });
    return { id: await this.enqueue(this.prisma, session, 'RESEND') };
  }

  // ---------------------------------------------------------------------------
  // FileMaker -> SES (D90)
  // ---------------------------------------------------------------------------
  /** The key FileMaker sends as `Authorization: Bearer <key>` to the callback door; null (door off) when unset or under 32 characters. */
  callbackKey(): string | null {
    const key = (this.config.get<string>('FMP_CALLBACK_KEY') ?? '').trim();
    return key.length >= 32 ? key : null;
  }

  /**
   * FileMaker reports what it did with a message ("done", "failed"). The message is found by `outboxId` (what SES sent in the
   * record) or, failing that, `reference` (its latest message). Tolerant on purpose: only the id is required; the status, a
   * message and a time are read when present, and the whole body (phones masked) is kept in the log, so what FileMaker really
   * sends is visible. Never changes the order; it only records. Every call is logged, whatever the outcome.
   */
  async receiveCallback(body: Record<string, unknown>) {
    const started = Date.now();
    const outboxId = pickText(body, ['outboxId'], 36);
    const reference = pickText(body, ['reference'], 32);
    const request = maskedJson(body);
    const finish = (httpStatus: number, summary: string, answer: object, ids: { outboxId?: string | null; reference?: string | null }) =>
      this.record({
        direction: 'IN',
        kind: 'callback',
        ok: httpStatus === 200,
        method: 'POST',
        path: FMP_CALLBACK_PATH,
        httpStatus,
        durationMs: Date.now() - started,
        summary,
        request,
        response: JSON.stringify(answer),
        outboxId: ids.outboxId ?? null,
        reference: ids.reference ?? null,
      });
    const refuse = async (httpStatus: 400 | 404, message: string) => {
      await finish(httpStatus, message, { error: message }, { outboxId, reference });
      throw httpStatus === 400 ? new BadRequestException(message) : new NotFoundException(message);
    };

    if (!outboxId && !reference) return refuse(400, 'ต้องส่ง outboxId หรือ reference');
    const row = outboxId
      ? await this.prisma.fmpOutbox.findUnique({ where: { id: outboxId } })
      : await this.prisma.fmpOutbox.findFirst({ where: { reference: reference! }, orderBy: { createdAt: 'desc' } });
    if (!row) return refuse(404, outboxId ? 'ไม่พบ outboxId นี้' : 'ไม่พบ reference นี้');
    if (reference && row.reference !== reference) return refuse(400, 'outboxId กับ reference ไม่ตรงกัน');

    const ackStatus = ackStatusOf(body);
    const message = pickText(body, ['message', 'msg', 'detail', 'note']);
    const timeText = pickText(body, ['time', 'occurredAt', 'at', 'timestamp', 'datetime', 'completedAt', 'doneAt'], 40);
    const ackAt = timeText ? parseFmpTime(timeText) : null;
    await this.prisma.fmpOutbox.update({
      where: { id: row.id },
      data: { ackStatus, ackMessage: message, ackAt, ackTimeText: timeText, ackReceivedAt: new Date() },
    });
    const answer = { ok: true, outboxId: row.id, reference: row.reference, status: ackStatus, time: ackAt?.toISOString() ?? null, timeReceived: timeText !== null };
    const timeNote = !timeText ? ' · ไม่ได้ส่งเวลา' : ackAt ? '' : ` · อ่านเวลา "${timeText}" ไม่ได้`;
    await finish(200, `FileMaker รายงาน ${ackStatus}${message ? `: ${message}` : ''}${timeNote}`, answer, { outboxId: row.id, reference: row.reference });
    return answer;
  }

  // ---------------------------------------------------------------------------
  // Admin log (D90)
  // ---------------------------------------------------------------------------
  /** The log, newest first, without the bodies (the list stays light); `after` is the id of the last row of the previous page. */
  async logs(query: { reference?: string; direction?: string; problems?: boolean; take?: number; after?: string }) {
    const take = Math.min(Math.max(query.take ?? 100, 1), 200);
    const rows = await this.prisma.fmpLog.findMany({
      where: {
        ...(query.reference ? { reference: { contains: query.reference } } : {}),
        ...(query.direction ? { direction: query.direction } : {}),
        ...(query.problems ? { ok: false } : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: take + 1,
      ...(query.after ? { cursor: { id: query.after }, skip: 1 } : {}),
      omit: { request: true, response: true },
    });
    return { rows: rows.slice(0, take), next: rows.length > take ? rows[take - 1].id : null };
  }

  /** One log row with what was sent and what came back. */
  logDetail(id: string) {
    return this.prisma.fmpLog.findUnique({ where: { id } });
  }
}

class TokenExpired extends Error {}

/** A message safe to log and to show an ADMIN: no URL, no headers, no credentials. */
function safe(error: unknown): string {
  const text = error instanceof Error ? error.message : 'unknown error';
  return text.replace(/https?:\/\/\S+/gi, '[url]').slice(0, 255);
}
