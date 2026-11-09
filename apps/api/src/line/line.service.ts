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

/**
 * Login codes over the UFiconStaff LINE OA (D113), the OA the staff already clock in with and UFPOS sends its own OTP
 * through. Push only: SES never receives the OA's webhook (UFHR owns it). Off until `LINE_CHANNEL_ACCESS_TOKEN` is set.
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
  /** UFHR can be asked for a person's LINE userId. */
  ufhrConfigured(): boolean {
    return this.env('UFHR_API_BASE').length > 0 && this.env('UFHR_API_KEY').length > 0;
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
    const base = this.env('UFHR_API_BASE').replace(/\/+$/, '');
    const data = (await this.call(
      `${base}/staff-contacts?ids=${erpStaffId}`,
      { headers: { Authorization: `Bearer ${this.env('UFHR_API_KEY')}`, Accept: 'application/json' } },
      'UFHR',
    )) as { staff?: { staffId?: unknown; lineUid?: unknown }[] } | null;
    const row = data?.staff?.find((s) => String(s.staffId) === String(erpStaffId));
    return normalizeLineUserId(row?.lineUid);
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
    const limit = this.timeoutMs();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), limit);
    let ok: boolean;
    let status: number;
    let data: { message?: unknown } | null;
    try {
      const response = await fetch(url, { ...init, signal: controller.signal });
      ok = response.ok;
      status = response.status;
      // the deadline runs until the body is read too: a server that sends headers and then stalls must not hold a code back
      data = (await response.json().catch((error: unknown) => {
        if (error instanceof Error && error.name === 'AbortError') throw error;
        return null;
      })) as { message?: unknown } | null;
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
    if (!ok) {
      const reason = typeof data?.message === 'string' ? data.message.slice(0, 120) : '';
      this.log.error(`${who} ${status} ${reason}`.trim());
      throw new Error(`${who} ปฏิเสธ (${status}${reason ? ` ${reason}` : ''})`);
    }
    return data;
  }
}
