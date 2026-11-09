import {
  BadRequestException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { LineService } from '../line/line.service';
import { SmsService } from '../sms/sms.service';
import { AccountsService, RETIRED_ROLES, publicAccount } from './accounts.service';

export const OTP_TTL_MS = 5 * 60_000;
export const OTP_MAX_ATTEMPTS = 5;
export const OTP_RESEND_MS = 60_000;
/** Per staff member: codes per rolling hour / per rolling day (keeps a stranger from filling someone's phone or LINE). */
export const OTP_HOURLY_LIMIT = 5;
export const OTP_DAILY_LIMIT = 10;
const DEFAULT_GLOBAL_DAILY_LIMIT = 1000;

const hashCode = (id: string, code: string) =>
  createHash('sha256').update(`${id}:${code}`).digest('hex');
const codeText = (code: string) => `รหัส OTP เข้าระบบ SES: ${code} (ใช้ได้ 5 นาที) ห้ามบอกผู้อื่น`;
const reason = (error: unknown, fallback: string) => (error instanceof Error ? error.message : fallback);

type OtpAccount = { staffId: string; phone: string | null; erpStaffId: number | null; lineUserId: string | null };

/**
 * OTP login (D85 SMS, D113 LINE). `request` always answers the same way, whoever asks for whom: an unknown, inactive or
 * unreachable account just gets no code. The code goes out after the answer, so the response time does not tell either. It
 * goes to the person's LINE on the UFiconStaff OA first; when LINE is off, has no userId for them or refuses, it goes by SMS
 * to the phone on the account. A code is six digits, kept as a hash, valid 5 minutes, single use, 5 wrong tries, and a staff
 * member can have 1 a minute, 5 an hour and 10 a day. `verify` starts the same 12-hour session as the password login.
 */
@Injectable()
export class OtpService {
  private readonly log = new Logger('Otp');
  constructor(
    private readonly prisma: PrismaService,
    private readonly sms: SmsService,
    private readonly line: LineService,
    private readonly accounts: AccountsService,
    private readonly config: ConfigService,
  ) {}

  private globalDailyLimit(): number {
    const n = Number(this.config.get<string>('OTP_SMS_DAILY_LIMIT'));
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_GLOBAL_DAILY_LIMIT;
  }

  /** The ways codes can go out, in the order they are tried (the login page words its hint from this). */
  channels(): ('line' | 'sms')[] {
    return [...(this.line.configured() ? (['line'] as const) : []), ...(this.sms.configured() ? (['sms'] as const) : [])];
  }

  /** The person can be sent a code at all: by SMS (a phone) or by LINE (a stored userId, or UFHR can be asked). */
  private reachable(account: OtpAccount): boolean {
    const bySms = this.sms.configured() && Boolean(account.phone);
    const byLine =
      this.line.configured() &&
      (Boolean(account.lineUserId) || (this.line.ufhrConfigured() && account.erpStaffId !== null));
    return bySms || byLine;
  }

  async request(staffIdInput: string): Promise<{ ok: true }> {
    if (!this.accounts.otpEnabled()) throw new BadRequestException('ยังไม่เปิดใช้การเข้าสู่ระบบด้วย OTP');
    const staffId = staffIdInput.trim();
    const account = await this.prisma.staff.findUnique({
      where: { staffId },
      include: { branch: true, roles: true },
    });
    const eligible =
      account &&
      account.active &&
      this.reachable(account) &&
      (!account.branch || account.branch.active) &&
      // D105: no SMS (and no cost) for an account SES has no screen for (the cashiers work in U POS)
      account.roles.some((r) => !RETIRED_ROLES.includes(r.roleCode));
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
        phoneLast4: account.phone?.slice(-4) ?? '',
        channel: this.line.configured() ? 'line' : 'sms',
        expiresAt: new Date(now + OTP_TTL_MS),
      },
    });
    // housekeeping: the log keeps 30 days
    void this.prisma.loginOtp
      .deleteMany({ where: { createdAt: { lt: new Date(now - 30 * 24 * 3600_000) } } })
      .catch(() => undefined);
    void this.deliver(id, account, code);
    return { ok: true };
  }

  /**
   * Sends the code, LINE first then SMS, and records on the OTP row which channel took it and what went wrong on the way
   * (a LINE miss stays as a note when the SMS then worked). Never throws: the caller already answered.
   */
  private async deliver(id: string, account: OtpAccount, code: string) {
    const notes: string[] = [];
    const record = (data: { channel?: string; smsStatus: string; smsMessageId?: string | null }) =>
      this.prisma.loginOtp
        .update({ where: { id }, data: { ...data, smsError: notes.join(' · ').slice(0, 255) || null } })
        .catch(() => undefined);
    if (this.line.configured()) {
      const target = await this.line.target(account);
      if (!target.userId) notes.push(`LINE: ${target.note ?? 'ไม่พบ LINE userId'}`);
      else {
        try {
          await this.line.push(target.userId, codeText(code));
          return record({ channel: 'line', smsStatus: 'sent' });
        } catch (error) {
          notes.push(`LINE: ${reason(error, 'ส่งไม่สำเร็จ')}`);
        }
      }
    }
    if (this.sms.configured() && account.phone) {
      try {
        const result = await this.sms.send(account.phone, codeText(code));
        return record({ channel: 'sms', smsStatus: 'sent', smsMessageId: result.messageId });
      } catch (error) {
        notes.push(`SMS: ${reason(error, 'ส่งไม่สำเร็จ')}`);
      }
    } else if (this.sms.configured()) notes.push('SMS: ไม่มีเบอร์มือถือ');
    this.log.error(`OTP not delivered: ${notes.join(' · ')}`);
    return record({ smsStatus: 'failed' });
  }

  async verify(staffIdInput: string, code: string) {
    const fail = () => new UnauthorizedException('รหัส OTP ไม่ถูกต้องหรือหมดอายุ ขอรหัสใหม่ได้');
    if (!this.accounts.otpEnabled()) throw new BadRequestException('ยังไม่เปิดใช้การเข้าสู่ระบบด้วย OTP');
    const staffId = staffIdInput.trim();
    const result = await this.accounts.transaction(async (tx) => {
      const account = await tx.staff.findUnique({
        where: { staffId },
        include: { roles: true, branch: true },
      });
      if (!account || !account.active || (account.branch && !account.branch.active)) return null;
      if (!account.roles.some((r) => !RETIRED_ROLES.includes(r.roleCode))) return null; // D105
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

  /** ADMIN: how LINE and SMS are set up, and the latest codes with how they went. No code, no full phone number. */
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
          channel: true,
          smsStatus: true,
          smsError: true,
        },
      }),
      this.prisma.loginOtp.count({ where: { createdAt: { gte: since } } }),
    ]);
    const activeErp = { active: true, erpStaffId: { not: null } };
    const [erpActive, erpWithLine] = await Promise.all([
      this.prisma.staff.count({ where: activeErp }),
      this.prisma.staff.count({ where: { ...activeErp, lineUserId: { not: null } } }),
    ]);
    const staff = await this.prisma.staff.groupBy({
      by: ['active'],
      where: { phone: null },
      _count: { _all: true },
    });
    return {
      otp: this.accounts.otpEnabled(),
      line: {
        configured: this.line.configured(),
        ufhrConfigured: this.line.ufhrConfigured(),
        erpActive,
        erpWithLine,
      },
      configured: this.sms.configured(),
      sender: this.sms.sender || null,
      webhookConfigured: this.sms.webhookToken() !== null,
      dailyLimit: this.globalDailyLimit(),
      last24h,
      activeWithoutPhone: staff.find((s) => s.active)?._count._all ?? 0,
      rows,
    };
  }

  /** ADMIN: one test LINE message to a staff member, to prove the token works and where their LINE userId comes from. */
  async sendTestLine(staffIdInput: string) {
    if (!this.line.configured()) throw new BadRequestException('ยังไม่ได้ตั้งค่า LINE_CHANNEL_ACCESS_TOKEN');
    const account = await this.prisma.staff.findUnique({ where: { staffId: staffIdInput.trim() } });
    if (!account) throw new BadRequestException('ไม่พบ Staff ID นี้ใน SES');
    const target = await this.line.target(account);
    if (!target.userId) throw new BadRequestException(target.note ?? 'ไม่พบ LINE userId ของคนนี้');
    try {
      await this.line.push(target.userId, 'ทดสอบ LINE จากระบบ SES (ไม่ต้องดำเนินการใด ๆ) รหัสเข้าระบบจะมาทางนี้');
    } catch (error) {
      throw new BadRequestException(reason(error, 'ส่ง LINE ไม่สำเร็จ'));
    }
    return { ok: true, source: target.source };
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
