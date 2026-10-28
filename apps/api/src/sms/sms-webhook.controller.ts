import { All, Body, Controller, HttpCode, Logger, NotFoundException, Param, Query } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { timingSafeEqual } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { SmsService } from './sms.service';

const pick = (source: Record<string, unknown>, keys: string[]): string | null => {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === 'string' || typeof value === 'number') {
      const text = String(value).trim();
      if (text) return text;
    }
  }
  return null;
};

/** "delivered" / "success" / "DELIVRD" -> delivered; "failed" / "undelivered" / "rejected" / "expired" -> undelivered. */
export function deliveryStatus(raw: string | null): string {
  const v = (raw ?? '').toLowerCase();
  if (!v) return 'reported';
  if (/undeliv|fail|reject|expire|error|unknown|blocked/.test(v)) return 'undelivered';
  if (/deliv|success|ok|sent/.test(v)) return 'delivered';
  return 'reported';
}

/** The report as kept on the OTP row: without anything that looks like a phone number, and never longer than ~2 KB. */
function reportOf(payload: Record<string, unknown>): Prisma.InputJsonValue {
  const safe = Object.fromEntries(
    Object.entries(payload).filter(([key]) => !/msisdn|phone|number|tel|mobile/i.test(key)),
  );
  const text = JSON.stringify(safe);
  return text.length <= 2000 ? (JSON.parse(text) as Prisma.InputJsonValue) : { truncated: text.slice(0, 2000) };
}

/**
 * Delivery-report webhook of ThaiBulkSMS (D85). Its API v2 document does not describe the payload, so this takes GET, POST
 * and PUT, reads the message id and status from the query string or the (JSON / form) body under the usual names, and keeps
 * the raw report on the OTP row for the admin log. It is public: the last URL segment is a secret
 * (`THAIBULKSMS_WEBHOOK_TOKEN`); a wrong token, or none configured, answers 404. The login never depends on it.
 */
@Controller('webhooks/thaibulksms')
export class SmsWebhookController {
  private readonly log = new Logger('SmsWebhook');
  constructor(
    private readonly prisma: PrismaService,
    private readonly sms: SmsService,
  ) {}

  @All(':token')
  @HttpCode(200)
  async report(
    @Param('token') token: string,
    @Query() query: Record<string, unknown>,
    @Body() body: Record<string, unknown> | undefined,
  ) {
    const expected = this.sms.webhookToken();
    const same =
      expected !== null &&
      token.length === expected.length &&
      timingSafeEqual(Buffer.from(token), Buffer.from(expected));
    if (!same) throw new NotFoundException();
    const merged = { ...(query ?? {}), ...(body && typeof body === 'object' ? body : {}) };
    const messageId = pick(merged, ['message_id', 'messageId', 'msg_id', 'id']);
    const status = deliveryStatus(
      pick(merged, ['status', 'delivery_status', 'deliveryStatus', 'dlr_status', 'state', 'result']),
    );
    // keys only in the log: the payload can carry the phone number
    this.log.log(`delivery report: ${Object.keys(merged).sort().join(',') || '(empty)'} -> ${status}`);
    if (messageId) {
      await this.prisma.loginOtp.updateMany({
        where: { smsMessageId: messageId },
        data: { smsStatus: status, smsReport: reportOf(merged) },
      });
    }
    return { ok: true };
  }
}
