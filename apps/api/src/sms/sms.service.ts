import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const DEFAULT_URL = 'https://api-v2.thaibulksms.com/sms';
const TIMEOUT_MS = 10_000;

export interface SmsResult {
  /** ThaiBulkSMS `message_id` of the first recipient (what its delivery webhook refers to) */
  messageId: string | null;
  usedCredit: number;
}

/** A Thai mobile number as 10 digits ("0812345678") from the spellings the ERP and people use; null when it is not one. */
export function normalizeThaiMobile(value: unknown): string | null {
  let digits = String(value ?? '').replace(/\D/g, '');
  if (digits.startsWith('66') && digits.length === 11) digits = `0${digits.slice(2)}`;
  return /^0[689]\d{8}$/.test(digits) ? digits : null;
}

/**
 * Sends SMS through the ThaiBulkSMS API v2 (D85): `POST /sms`, HTTP Basic with the API key and secret, form-encoded
 * `msisdn` / `message` / `sender`. Used for the login OTP. Nothing is sent, and OTP login stays off, until
 * `THAIBULKSMS_API_KEY` and `THAIBULKSMS_API_SECRET` are set. The secret is never logged.
 */
@Injectable()
export class SmsService {
  private readonly log = new Logger('Sms');
  constructor(private readonly config: ConfigService) {}

  private get key() {
    return (this.config.get<string>('THAIBULKSMS_API_KEY') ?? '').trim();
  }
  private get secret() {
    return (this.config.get<string>('THAIBULKSMS_API_SECRET') ?? '').trim();
  }
  get sender(): string {
    return (this.config.get<string>('THAIBULKSMS_SENDER') ?? '').trim();
  }
  /** SMS can be sent: both credentials are set. The login switches to OTP only then. */
  configured(): boolean {
    return this.key.length > 0 && this.secret.length > 0;
  }
  /** The webhook secret (the last segment of the URL given to ThaiBulkSMS); shorter than 16 characters = webhook off. */
  webhookToken(): string | null {
    const token = (this.config.get<string>('THAIBULKSMS_WEBHOOK_TOKEN') ?? '').trim();
    return token.length >= 16 ? token : null;
  }

  async send(msisdn: string, message: string): Promise<SmsResult> {
    if (!this.configured()) throw new Error('ยังไม่ได้ตั้งค่า THAIBULKSMS_API_KEY / THAIBULKSMS_API_SECRET');
    const phone = normalizeThaiMobile(msisdn);
    if (!phone) throw new Error('เบอร์โทรไม่ใช่เบอร์มือถือไทย');
    const body = new URLSearchParams({ msisdn: phone, message });
    if (this.sender) body.set('sender', this.sender);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetch(
        (this.config.get<string>('THAIBULKSMS_API_URL') ?? '').trim() || DEFAULT_URL,
        {
          method: 'POST',
          headers: {
            Authorization: `Basic ${Buffer.from(`${this.key}:${this.secret}`).toString('base64')}`,
            'Content-Type': 'application/x-www-form-urlencoded',
            Accept: 'application/json',
          },
          body,
          signal: controller.signal,
        },
      );
    } catch (error) {
      // never echo error.message: some runtimes quote the URL or headers in it
      throw new Error(
        error instanceof Error && error.name === 'AbortError'
          ? 'ThaiBulkSMS ไม่ตอบภายใน 10 วินาที'
          : 'เชื่อมต่อ ThaiBulkSMS ไม่สำเร็จ',
      );
    } finally {
      clearTimeout(timer);
    }
    const data = (await response.json().catch(() => null)) as {
      error?: { code?: number | string; name?: string; description?: string };
      phone_number_list?: { message_id?: string; used_credit?: number }[];
      bad_phone_number_list?: unknown[];
    } | null;
    if (!response.ok || data?.error) {
      const e = data?.error;
      this.log.error(`ThaiBulkSMS ${response.status} ${e?.name ?? ''} ${e?.description ?? ''}`.trim());
      throw new Error(`ThaiBulkSMS ปฏิเสธ (${response.status}${e?.name ? ` ${e.name}` : ''})`);
    }
    if (data?.bad_phone_number_list?.length) throw new Error('ThaiBulkSMS ปฏิเสธเบอร์ปลายทาง');
    const first = data?.phone_number_list?.[0];
    return { messageId: first?.message_id ?? null, usedCredit: first?.used_credit ?? 0 };
  }
}
