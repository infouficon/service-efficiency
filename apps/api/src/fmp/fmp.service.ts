import { Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { orderView, type OrderViewSource } from '../sessions/order-view';

/** What `enqueue` needs of a session: the order view plus its branch. */
export type FmpSession = OrderViewSource & { id: string; branch: { code: string; name: string } };
type Outbox = Pick<PrismaService, 'fmpOutbox'> | Prisma.TransactionClient;

/** Minutes to wait before attempt 2, 3, … (attempt 1 is at once); after the last one the message is `failed` until an ADMIN retries it. */
const BACKOFF_MINUTES = [1, 2, 5, 10, 20, 30, 60];
export const FMP_MAX_ATTEMPTS = BACKOFF_MINUTES.length + 1;
const TICK_DEFAULT_SECONDS = 10;
const BATCH = 20;
const STALE_SENDING_MS = 5 * 60_000;
const HTTP_TIMEOUT_MS = 15_000;

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

  /**
   * Queues one message for FileMaker (inside the caller's transaction). Returns its id, or null when the push is not configured.
   * The payload is the order exactly as SES describes it elsewhere, plus where it comes from.
   */
  async enqueue(db: Outbox, session: FmpSession, event: string): Promise<string | null> {
    if (!this.configured()) return null;
    const id = randomUUID();
    const payload = JSON.stringify({
      source: 'SES',
      event,
      outboxId: id,
      queuedAt: new Date().toISOString(),
      branch: { code: session.branch.code, name: session.branch.name },
      ...orderView(session),
    });
    await db.fmpOutbox.create({
      data: { id, sessionId: session.id, reference: session.reference, event, payload },
    });
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
    try {
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
            token ??= await this.login(cfg);
            let out;
            try {
              out = await this.createRecord(cfg, token, row);
            } catch (error) {
              if (!(error instanceof TokenExpired)) throw error;
              token = await this.login(cfg); // the token was dropped: once more with a new one
              out = await this.createRecord(cfg, token, row);
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
            await this.fail(row.id, row.attempts + 1, error);
            result.failed += 1;
          }
        }
      } finally {
        if (token) await this.logout(cfg, token);
      }
    } catch (error) {
      this.log.error(`FileMaker push round failed: ${safe(error)}`);
    } finally {
      this.running = false;
    }
    return result;
  }

  private async fail(id: string, attempts: number, error: unknown) {
    const message = safe(error);
    const dead = attempts >= FMP_MAX_ATTEMPTS;
    const wait = BACKOFF_MINUTES[Math.min(attempts - 1, BACKOFF_MINUTES.length - 1)] * 60_000;
    this.log.error(`FileMaker push ${dead ? 'gave up' : 'will retry'} (attempt ${attempts}): ${message}`);
    await this.prisma.fmpOutbox.update({
      where: { id },
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
    body?: unknown,
  ): Promise<FmResponse> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);
    try {
      const res = await fetch(`${cfg.base}/fmi/data/vLatest/databases/${encodeURIComponent(cfg.database)}${path}`, {
        method,
        headers: { 'Content-Type': 'application/json', Authorization: authorization },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: controller.signal,
      });
      const json = (await res.json().catch(() => null)) as {
        response?: Record<string, unknown>;
        messages?: { code?: string; message?: string }[];
      } | null;
      const first = json?.messages?.[0];
      return { status: res.status, code: String(first?.code ?? ''), message: String(first?.message ?? ''), response: json?.response ?? {} };
    } catch (error) {
      // never echo error.message: a runtime may quote the URL or headers in it
      throw new Error(error instanceof Error && error.name === 'AbortError' ? 'FileMaker ไม่ตอบภายใน 15 วินาที' : 'เชื่อมต่อ FileMaker ไม่สำเร็จ');
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * A Data API session token. The header is the base64 of `user:password` with the trailing `=` taken off, as the FileMaker side
   * specified; if that is refused (401) the standard padded form is tried once.
   */
  private async login(cfg: FmpConfig): Promise<string> {
    const padded = Buffer.from(`${cfg.user}:${cfg.password}`).toString('base64');
    const forms = [...new Set([padded.replace(/=+$/, ''), padded])];
    let last: FmResponse | null = null;
    for (const form of forms) {
      last = await this.fm(cfg, 'POST', '/sessions', `Basic ${form}`, {});
      const token = last.response.token;
      if (last.status === 200 && typeof token === 'string' && token) return token;
      if (last.status !== 401) break;
    }
    throw new Error(`FileMaker login ไม่สำเร็จ (HTTP ${last?.status} ${last?.code} ${last?.message})`.trim());
  }

  private async createRecord(cfg: FmpConfig, token: string, row: { id: string; reference: string; event: string; payload: string }) {
    const body: Record<string, unknown> = { fieldData: { [cfg.field]: row.payload } };
    if (cfg.script) {
      body.script = cfg.script;
      body['script.param'] = JSON.stringify({ source: 'SES', reference: row.reference, event: row.event, outboxId: row.id });
    }
    const res = await this.fm(cfg, 'POST', `/layouts/${encodeURIComponent(cfg.layout)}/records`, `Bearer ${token}`, body);
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

  private async logout(cfg: FmpConfig, token: string) {
    try {
      await this.fm(cfg, 'DELETE', `/sessions/${encodeURIComponent(token)}`, 'Bearer unused');
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
      counts: { pending: count('pending'), sending: count('sending'), sent: count('sent'), failed: count('failed') },
      rows,
    };
  }

  /** A failed (or waiting) message goes again at once. */
  async retry(id: string) {
    const row = await this.prisma.fmpOutbox.findUnique({ where: { id } });
    if (!row || !['failed', 'pending'].includes(row.status)) return null;
    await this.prisma.fmpOutbox.update({
      where: { id },
      data: { status: 'pending', attempts: 0, nextAttemptAt: new Date(), lockedAt: null },
    });
    return { ok: true };
  }

  /** Sends an existing order again (event `RESEND`), e.g. for the FileMaker team to test with a real order. */
  async resend(reference: string) {
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
    return { id: await this.enqueue(this.prisma, session, 'RESEND') };
  }
}

class TokenExpired extends Error {}

/** A message safe to log and to show an ADMIN: no URL, no headers, no credentials. */
function safe(error: unknown): string {
  const text = error instanceof Error ? error.message : 'unknown error';
  return text.replace(/https?:\/\/\S+/gi, '[url]').slice(0, 255);
}
