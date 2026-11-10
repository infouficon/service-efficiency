import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const DEFAULT_API_URL = 'https://api.line.me';
const DEFAULT_TIMEOUT_MS = 10_000;

/** A LINE Messaging API userId: "U" and 32 hex digits. Anything else (an old LINE Notify token, a typo) is not one. */
export function normalizeLineUserId(value: unknown): string | null {
  const id = String(value ?? '').trim();
  return /^U[0-9a-f]{32}$/.test(id) ? id : null;
}

export interface LineTarget {
  userId: string | null;
  /** where the userId came from: UFHR (the HR system staff link their LINE in) or the copy the ERP import stored */
  source: 'ufhr' | 'erp' | null;
  /** why there is none, for the ADMIN log */
  note?: string;
}

/** UFHR's FileMaker file and the layout its team opened for SES (D118): `staff_id`, `line_uid`, `status`, names. */
const DEFAULT_UFHR_FM_DATABASE = 'UFHR';
const DEFAULT_UFHR_FM_LAYOUT = 'api_staff';
/** FileMaker Data API: "no records match the request" (an answer, not an error) */
const FM_NO_RECORDS = '401';

/**
 * Login codes over the UFiconStaff LINE OA (D113), the OA the staff already clock in with and UFPOS sends its own OTP
 * through. Push only: SES never receives the OA's webhook (UFHR owns it). Off until `LINE_CHANNEL_ACCESS_TOKEN` is set.
 *
 * D118: UFHR can also be asked straight in its FileMaker file (`UFHR_FM_HOST` / `UFHR_FM_USER` / `UFHR_FM_PASSWORD`,
 * database `UFHR`, layout `api_staff`, a read-only account the UFHR team made for SES). It is preferred over the HTTP API
 * when both are set. A person counts as linked only with `status` Active and a real userId in `line_uid`.
 *
 * Who is who on LINE is kept by UFHR (`staff::line_uid`, linked by each person in the OA). With `UFHR_API_BASE` and
 * `UFHR_API_KEY` set, UFHR's `GET /staff-contacts?ids=` decides: its answer is final, so a person HR has unlinked (or
 * who is no longer active there) gets no LINE code even if an older copy is stored. Only when UFHR is not set up or does
 * not answer is the copy the ERP import stored (`Staff.lineUserId`, FileMaker's `line_user_id`) used. The token and the
 * key are never logged.
 */
@Injectable()
export class LineService {
  private readonly log = new Logger('Line');
  constructor(private readonly config: ConfigService) {}

  private env(name: string): string {
    return (this.config.get<string>(name) ?? '').trim();
  }
  /** Codes can be pushed: the OA's channel access token is set. */
  configured(): boolean {
    return this.env('LINE_CHANNEL_ACCESS_TOKEN').length > 0;
  }
  /** UFHR can be asked for a person's LINE userId (its FileMaker layout, D118, or its HTTP API, D113). */
  ufhrConfigured(): boolean {
    return this.ufhrFmConfigured() || (this.env('UFHR_API_BASE').length > 0 && this.env('UFHR_API_KEY').length > 0);
  }
  /** D118: UFHR's FileMaker layout can be read (host, user and password set). */
  ufhrFmConfigured(): boolean {
    return ['UFHR_FM_HOST', 'UFHR_FM_USER', 'UFHR_FM_PASSWORD'].every((k) => this.env(k).length > 0);
  }

  /**
   * The LINE userId to send to: UFHR's answer when UFHR is set up and answers (no LINE there = no LINE code, the code goes
   * by SMS), else the ERP copy. Never throws.
   */
  async target(staff: { erpStaffId: number | null; lineUserId: string | null }): Promise<LineTarget> {
    const stored = normalizeLineUserId(staff.lineUserId);
    let note = 'ไม่มี LINE userId ใน ERP';
    if (this.ufhrConfigured() && staff.erpStaffId !== null) {
      try {
        const fromHr = await this.askUfhr(staff.erpStaffId);
        return fromHr
          ? { userId: fromHr, source: 'ufhr' }
          : { userId: null, source: null, note: 'UFHR ไม่มี LINE ของคนนี้ (ยังไม่ผูก LINE, เลิกผูก หรือไม่ได้ active ใน HR)' };
      } catch (error) {
        note = error instanceof Error ? error.message : 'ถาม UFHR ไม่สำเร็จ';
      }
      if (!stored) return { userId: null, source: null, note: `${note} และไม่มีใน ERP` };
    }
    return stored ? { userId: stored, source: 'erp' } : { userId: null, source: null, note };
  }

  private async askUfhr(erpStaffId: number): Promise<string | null> {
    if (this.ufhrFmConfigured()) return (await this.ufhrLines([erpStaffId])).get(erpStaffId) ?? null;
    const base = this.env('UFHR_API_BASE').replace(/\/+$/, '');
    const data = (await this.call(
      `${base}/staff-contacts?ids=${erpStaffId}`,
      { headers: { Authorization: `Bearer ${this.env('UFHR_API_KEY')}`, Accept: 'application/json' } },
      'UFHR',
    )) as { staff?: { staffId?: unknown; lineUid?: unknown }[] } | null;
    const row = data?.staff?.find((s) => String(s.staffId) === String(erpStaffId));
    return normalizeLineUserId(row?.lineUid);
  }

  /**
   * D118: ERP staff id -> LINE userId from UFHR's FileMaker layout (null = in UFHR but not linked or not Active), for the
   * given ids or for everybody. A staff id UFHR does not have is absent from the map. One login, one read, one logout.
   * Throws a short Thai reason when UFHR refuses or does not answer.
   */
  async ufhrLines(ids?: number[]): Promise<Map<number, string | null>> {
    const host = this.env('UFHR_FM_HOST').replace(/\/+$/, '');
    const db = `${host}/fmi/data/vLatest/databases/${encodeURIComponent(this.env('UFHR_FM_DATABASE') || DEFAULT_UFHR_FM_DATABASE)}`;
    const layout = `${db}/layouts/${encodeURIComponent(this.env('UFHR_FM_LAYOUT') || DEFAULT_UFHR_FM_LAYOUT)}`;
    const basic = Buffer.from(`${this.env('UFHR_FM_USER')}:${this.env('UFHR_FM_PASSWORD')}`).toString('base64');
    const login = await this.request(`${db}/sessions`, {
      method: 'POST',
      headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/json' },
      body: '{}',
    }, 'UFHR');
    const token = (login.data as { response?: { token?: unknown } } | null)?.response?.token;
    if (!login.ok || typeof token !== 'string') throw new Error(`UFHR ปฏิเสธการเข้าระบบ (${login.status} ${fmCode(login.data)})`);
    const auth = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
    try {
      const res = ids
        ? await this.request(`${layout}/_find`, {
            method: 'POST',
            headers: auth,
            body: JSON.stringify({ query: ids.map((id) => ({ staff_id: `==${id}` })), limit: ids.length * 5 + 10 }),
          }, 'UFHR')
        : await this.request(`${layout}/records?_limit=5000`, { headers: auth }, 'UFHR');
      const code = fmCode(res.data);
      if (code === FM_NO_RECORDS) return new Map();
      if (!res.ok || code !== '0') throw new Error(`UFHR ปฏิเสธ (${res.status} ${code})`);
      const rows = ((res.data as { response?: { data?: { fieldData?: Record<string, unknown> }[] } } | null)?.response?.data ?? []);
      const lines = new Map<number, string | null>();
      for (const row of rows) {
        const f = row.fieldData ?? {};
        const id = Number(f.staff_id);
        if (!Number.isInteger(id) || id <= 0) continue;
        const active = String(f.status ?? '').trim().toLowerCase() === 'active';
        const uid = active ? normalizeLineUserId(f.line_uid) : null;
        // a staff id twice: a linked Active row wins over one that is not
        if (!lines.get(id)) lines.set(id, uid);
      }
      return lines;
    } finally {
      // always give the session back: FileMaker counts them
      await this.request(`${db}/sessions/${encodeURIComponent(token)}`, { method: 'DELETE' }, 'UFHR').catch(() => undefined);
    }
  }

  /** One text message to one person. Throws a short Thai reason when LINE refuses or does not answer. */
  async push(to: string, text: string): Promise<void> {
    if (!this.configured()) throw new Error('ยังไม่ได้ตั้งค่า LINE_CHANNEL_ACCESS_TOKEN');
    const base = (this.env('LINE_API_URL') || DEFAULT_API_URL).replace(/\/+$/, '');
    await this.call(
      `${base}/v2/bot/message/push`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.env('LINE_CHANNEL_ACCESS_TOKEN')}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ to, messages: [{ type: 'text', text }] }),
      },
      'LINE',
    );
  }

  /** Milliseconds to wait for a whole answer (headers and body); `LINE_TIMEOUT_MS` exists for the tests only. */
  private timeoutMs(): number {
    const n = Number(this.env('LINE_TIMEOUT_MS'));
    return Number.isFinite(n) && n > 0 ? n : DEFAULT_TIMEOUT_MS;
  }

  private async call(url: string, init: RequestInit, who: 'LINE' | 'UFHR'): Promise<unknown> {
    const { ok, status, data } = await this.request(url, init, who);
    if (!ok) {
      const message = (data as { message?: unknown } | null)?.message;
      const reason = typeof message === 'string' ? message.slice(0, 120) : '';
      this.log.error(`${who} ${status} ${reason}`.trim());
      throw new Error(`${who} ปฏิเสธ (${status}${reason ? ` ${reason}` : ''})`);
    }
    return data;
  }

  /** One HTTP call with the deadline over headers and body; a refusal is returned, only no answer throws. */
  private async request(url: string, init: RequestInit, who: 'LINE' | 'UFHR'): Promise<{ ok: boolean; status: number; data: unknown }> {
    const limit = this.timeoutMs();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), limit);
    let ok: boolean;
    let status: number;
    let data: unknown;
    try {
      const response = await fetch(url, { ...init, signal: controller.signal });
      ok = response.ok;
      status = response.status;
      // the deadline runs until the body is read too: a server that sends headers and then stalls must not hold a code back
      data = (await response.json().catch((error: unknown) => {
        if (error instanceof Error && error.name === 'AbortError') throw error;
        return null;
      })) as unknown;
    } catch (error) {
      // never echo error.message: some runtimes quote the URL or headers in it
      throw new Error(
        error instanceof Error && error.name === 'AbortError'
          ? `${who} ไม่ตอบภายใน ${limit / 1000} วินาที`
          : `เชื่อมต่อ ${who} ไม่สำเร็จ`,
      );
    } finally {
      clearTimeout(timer);
    }
    return { ok, status, data };
  }
}

/** The FileMaker Data API message code of an answer ("0" = OK, "401" = no records, "212" = bad login, ...). */
function fmCode(data: unknown): string {
  const messages = (data as { messages?: { code?: unknown }[] } | null)?.messages;
  return String(messages?.[0]?.code ?? '?');
}
