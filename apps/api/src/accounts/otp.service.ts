import {
  BadRequestException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { SmsService } from '../sms/sms.service';
import { AccountsService, publicAccount } from './accounts.service';

export const OTP_TTL_MS = 5 * 60_000;
export const OTP_MAX_ATTEMPTS = 5;
export const OTP_RESEND_MS = 60_000;
/** Per staff member: codes per rolling hour / per rolling day (keeps a stranger from filling someone's phone with SMS). */
export const OTP_HOURLY_LIMIT = 5;
export const OTP_DAILY_LIMIT = 10;
const DEFAULT_GLOBAL_DAILY_LIMIT = 1000;

const hashCode = (id: string, code: string) =>
  createHash('sha256').update(`${id}:${code}`).digest('hex');

/**
 * SMS OTP login (D85). `request` always answers the same way, whoever asks for whom: an unknown, inactive or phoneless
 * account just gets no SMS. The SMS goes out after the answer, so the response time does not tell either. A code is six
 * digits, kept as a hash, valid 5 minutes, single use, 5 wrong tries, and a staff member can have 1 a minute, 5 an hour and
 * 10 a day. `verify` starts the same 12-hour session as the password login.
 */
@Injectable()
export class OtpService {
  private readonly log = new Logger('Otp');
  constructor(
    private readonly prisma: PrismaService,
    private readonly sms: SmsService,
    private readonly accounts: AccountsService,
    private readonly config: ConfigService,
  ) {}

  private globalDailyLimit(): number {
    const n = Number(this.config.get<string>('OTP_SMS_DAILY_LIMIT'));
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_GLOBAL_DAILY_LIMIT;
  }

  async request(staffIdInput: string): Promise<{ ok: true }> {
    if (!this.sms.configured()) throw new BadRequestException('ยังไม่เปิดใช้การเข้าสู่ระบบด้วย OTP');
    const staffId = staffIdInput.trim();
    const account = await this.prisma.staff.findUnique({
      where: { staffId },
      include: { branch: true },
    });
    const eligible =
      account &&
      account.active &&
      account.phone &&
      (!account.branch || account.branch.active);
    if (!eligible) return { ok: true };

    const now = Date.now();
    const day = await this.prisma.loginOtp.findMany({
      where: { staffId: account.staffId, createdAt: { gte: new Date(now - 24 * 3600_000) } },
      select: { createdAt: true },
      orderBy: { createdAt: 'desc' },
    });
    const sentLastMinute = day.some((o) => now - o.createdAt.getTime() < OTP_RESEND_MS);
    const sentLastHour = day.filter((o) => now - o.createdAt.getTime() < 3600_000).length;
    if (sentLastMinute || sentLastHour >= OTP_HOURLY_LIMIT || day.length >= OTP_DAILY_LIMIT) return { ok: true };
    const today = await this.prisma.loginOtp.count({
      where: { createdAt: { gte: new Date(now - 24 * 3600_000) } },
    });
    if (today >= this.globalDailyLimit()) {
      this.log.error(`OTP_SMS_DAILY_LIMIT reached (${today} in 24 h): no more codes until it drops`);
      return { ok: true };
    }

    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    const id = randomUUID();
    await this.prisma.loginOtp.create({
      data: {
        id,
        staffId: account.staffId,
        codeHash: hashCode(id, code),
        phoneLast4: account.phone!.slice(-4),
        expiresAt: new Date(now + OTP_TTL_MS),
      },
    });
    // housekeeping: the log keeps 30 days
    void this.prisma.loginOtp
      .deleteMany({ where: { createdAt: { lt: new Date(now - 30 * 24 * 3600_000) } } })
      .catch(() => undefined);
    void this.deliver(id, account.phone!, code);
    return { ok: true };
  }

  /** Sends the code and records what happened on the OTP row (never throws: the caller already answered). */
  private async deliver(id: string, phone: string, code: string) {
    try {
      const result = await this.sms.send(
        phone,
        `รหัส OTP เข้าระบบ SES: ${code} (ใช้ได้ 5 นาที) ห้ามบอกผู้อื่น`,
      );
      await this.prisma.loginOtp.update({
        where: { id },
        data: { smsStatus: 'sent', smsMessageId: result.messageId },
      });
    } catch (error) {
      const message = (error instanceof Error ? error.message : 'ส่ง SMS ไม่สำเร็จ').slice(0, 255);
      this.log.error(`OTP SMS failed: ${message}`);
      await this.prisma.loginOtp
        .update({ where: { id }, data: { smsStatus: 'failed', smsError: message } })
        .catch(() => undefined);
    }
  }

  async verify(staffIdInput: string, code: string) {
    const fail = () => new UnauthorizedException('รหัส OTP ไม่ถูกต้องหรือหมดอายุ ขอรหัสใหม่ได้');
    if (!this.sms.configured()) throw new BadRequestException('ยังไม่เปิดใช้การเข้าสู่ระบบด้วย OTP');
    const staffId = staffIdInput.trim();
    const result = await this.accounts.transaction(async (tx) => {
      const account = await tx.staff.findUnique({
        where: { staffId },
        include: { roles: true, branch: true },
      });
      if (!account || !account.active || (account.branch && !account.branch.active)) return null;
      const otp = await tx.loginOtp.findFirst({
        where: { staffId: account.staffId, consumedAt: null, expiresAt: { gt: new Date() } },
        orderBy: { createdAt: 'desc' },
      });
      if (!otp) return null;
      const given = Buffer.from(hashCode(otp.id, code));
      const expected = Buffer.from(otp.codeHash);
      if (!(given.length === expected.length && timingSafeEqual(given, expected))) {
        // the attempt is committed (we return, not throw): five wrong tries burn the code
        await tx.loginOtp.update({
          where: { id: otp.id },
          data: {
            attempts: { increment: 1 },
            ...(otp.attempts + 1 >= OTP_MAX_ATTEMPTS ? { consumedAt: new Date() } : {}),
          },
        });
        return null;
      }
      await tx.loginOtp.update({ where: { id: otp.id }, data: { consumedAt: new Date() } });
      await tx.staff.update({
        where: { staffId: account.staffId },
        data: { failedAttempts: 0, lockedUntil: null },
      });
      const token = await this.accounts.createSession(tx, account.staffId);
      return { token, user: publicAccount(account) };
    });
    if (!result) throw fail();
    return result;
  }

  /** ADMIN: how the SMS side is set up, and the latest codes with how their SMS went. No code, no full phone number. */
  async status() {
    const since = new Date(Date.now() - 24 * 3600_000);
    const [rows, last24h] = await Promise.all([
      this.prisma.loginOtp.findMany({
        orderBy: { createdAt: 'desc' },
        take: 50,
        select: {
          id: true,
          staffId: true,
          phoneLast4: true,
          createdAt: true,
          consumedAt: true,
          attempts: true,
          smsStatus: true,
          smsError: true,
        },
      }),
      this.prisma.loginOtp.count({ where: { createdAt: { gte: since } } }),
    ]);
    const staff = await this.prisma.staff.groupBy({
      by: ['active'],
      where: { phone: null },
      _count: { _all: true },
    });
    return {
      configured: this.sms.configured(),
      sender: this.sms.sender || null,
      webhookConfigured: this.sms.webhookToken() !== null,
      dailyLimit: this.globalDailyLimit(),
      last24h,
      activeWithoutPhone: staff.find((s) => s.active)?._count._all ?? 0,
      rows,
    };
  }

  /** ADMIN: one test SMS to a number the admin types, to prove the key, the secret and the sender work. */
  async sendTest(phone: string) {
    if (!this.sms.configured()) throw new BadRequestException('ยังไม่ได้ตั้งค่า THAIBULKSMS_API_KEY / THAIBULKSMS_API_SECRET');
    try {
      const result = await this.sms.send(phone, 'ทดสอบ SMS จากระบบ SES (ไม่ต้องดำเนินการใด ๆ)');
      return { ok: true, messageId: result.messageId, usedCredit: result.usedCredit };
    } catch (error) {
      throw new BadRequestException(error instanceof Error ? error.message : 'ส่ง SMS ไม่สำเร็จ');
    }
  }
}
