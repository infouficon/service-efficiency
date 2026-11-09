import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const DEFAULT_API_URL = 'https://api.line.me';
const TIMEOUT_MS = 10_000;

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
 * `UFHR_API_KEY` set, UFHR's `GET /staff-contacts?ids=` is asked first; otherwise, or when UFHR has nothing, the copy the
 * ERP import stored (`Staff.lineUserId`, FileMaker's `line_user_id`) is used. The token and the key are never logged.
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

  /** The LINE userId to send to: UFHR's when it has one, else the ERP copy. Never throws. */
  async target(staff: { erpStaffId: number | null; lineUserId: string | null }): Promise<LineTarget> {
    const stored = normalizeLineUserId(staff.lineUserId);
    let note = 'ไม่มี LINE userId ใน ERP';
    if (this.ufhrConfigured() && staff.erpStaffId !== null) {
      try {
        const fromHr = await this.askUfhr(staff.erpStaffId);
        if (fromHr) return { userId: fromHr, source: 'ufhr' };
        note = 'UFHR ไม่มี LINE ของคนนี้ (ยังไม่ผูก LINE หรือไม่ได้ active ใน HR)';
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

  private async call(url: string, init: RequestInit, who: 'LINE' | 'UFHR'): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetch(url, { ...init, signal: controller.signal });
    } catch (error) {
      // never echo error.message: some runtimes quote the URL or headers in it
      throw new Error(
        error instanceof Error && error.name === 'AbortError'
          ? `${who} ไม่ตอบภายใน ${TIMEOUT_MS / 1000} วินาที`
          : `เชื่อมต่อ ${who} ไม่สำเร็จ`,
      );
    } finally {
      clearTimeout(timer);
    }
    const data = (await response.json().catch(() => null)) as { message?: unknown } | null;
    if (!response.ok) {
      const reason = typeof data?.message === 'string' ? data.message.slice(0, 120) : '';
      this.log.error(`${who} ${response.status} ${reason}`.trim());
      throw new Error(`${who} ปฏิเสธ (${response.status}${reason ? ` ${reason}` : ''})`);
    }
    return data;
  }
}
