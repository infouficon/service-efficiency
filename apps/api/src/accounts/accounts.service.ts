import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { Prisma, type RoleCode } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { formatQueue } from '../queue/queue.service';
import {
  hashPassword,
  LOCK_MS,
  SESSION_MS,
  tokenHash,
  verifyPassword,
} from './password';
import { SmsService } from '../sms/sms.service';
import { BranchDto, StaffCreateDto, StaffUpdateDto } from './dto';
const include = { roles: true, branch: true } satisfies Prisma.StaffInclude;
export type Account = Prisma.StaffGetPayload<{ include: typeof include }>;
export type PublicAccount = ReturnType<typeof publicAccount>;
type Tx = Prisma.TransactionClient;
/** Roles that follow the ERP for accounts created by the ERP import (D54); ADMIN and MANAGER stay manual. */
export const ERP_MANAGED_ROLES: RoleCode[] = ['STAFF', 'STOCK', 'CASHIER'];
const ERP_PASSWORD_MESSAGE =
  'บัญชีนี้ใช้รหัสผ่านเดียวกับ ERP กรุณาเปลี่ยนรหัสผ่านที่ ERP (ระบบซิงก์ทุกวัน 10:00)';
const queueOf = (
  session?: { queueLetter: string | null; queueNo: number | null } | null,
) =>
  session?.queueNo != null
    ? formatQueue(session.queueLetter, session.queueNo)
    : undefined;
export function publicAccount(account: Account) {
  const fullName = [account.firstName, account.lastName].filter(Boolean).join(' ');
  return {
    staffId: account.staffId,
    firstName: account.firstName || '',
    lastName: account.lastName || '',
    name: fullName || account.staffId,
    roles: account.roles.map((r) => r.roleCode),
    branchId: account.branchId,
    branchCode: account.branch?.code ?? null,
    branch: account.branch?.name ?? 'Global',
    active: account.active,
    mustChangePassword: account.mustChangePassword,
    erpManaged: account.erpStaffId !== null,
    /** the number the login OTP goes to, masked ("08X-XXX-1234"); null = none, so no OTP login (D85) */
    phone: maskPhone(account.phone),
  };
}
/** "0812345678" -> "08X-XXX-5678": enough for a person to recognise their own number, not to use it. */
export function maskPhone(phone: string | null): string | null {
  return phone && phone.length >= 10
    ? `${phone.slice(0, 2)}X-XXX-${phone.slice(-4)}`
    : null;
}
@Injectable()
export class AccountsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sms: SmsService,
  ) {}

  /** Login switches to SMS OTP once ThaiBulkSMS is configured (D85); until then everything works as before. */
  otpEnabled(): boolean {
    return this.sms.configured();
  }

  /** Starts a login session (12 h, D85) and sweeps the expired ones. Runs inside the caller's transaction. */
  async createSession(tx: Tx, staffId: string): Promise<string> {
    const token = randomBytes(32).toString('hex');
    await tx.loginSession.deleteMany({
      where: { createdAt: { lte: new Date(Date.now() - SESSION_MS) } },
    });
    await tx.loginSession.create({
      data: { tokenHash: tokenHash(token), staffId, lastSeenAt: new Date() },
    });
    return token;
  }

  async authenticate(tokenOrRequest: string | { headers?: { cookie?: string } } | undefined): Promise<PublicAccount> {
    const token = typeof tokenOrRequest === 'string'
      ? tokenOrRequest
      : tokenOrRequest?.headers?.cookie
          ?.split(';')
          .map((part) => part.trim())
          .find((part) => part.startsWith('se_session='))
          ?.slice('se_session='.length);
    if (!token || !/^[a-f0-9]{64}$/.test(token)) {
      throw new UnauthorizedException('กรุณาเข้าสู่ระบบใหม่');
    }
    return this.transaction(async (tx) => publicAccount(await this.actor(tx, token)));
  }
  async transaction<T>(work: (tx: Tx) => Promise<T>): Promise<T> {
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          await tx.$queryRaw`SELECT id FROM AccountLock WHERE id = 1 FOR UPDATE`;
          return work(tx);
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
          maxWait: 10000,
          timeout: 15000,
        },
      );
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      )
        throw new ConflictException('รหัสนี้มีอยู่แล้ว');
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2025'
      )
        throw new NotFoundException('ไม่พบข้อมูล');
      throw error;
    }
  }
  private async actor(
    tx: Tx,
    token: string | undefined,
    allowPasswordChange = false,
  ) {
    if (!token || !/^[a-f0-9]{64}$/.test(token))
      throw new UnauthorizedException();
    const session = await tx.loginSession.findUnique({
      where: { tokenHash: tokenHash(token) },
      include: { staff: { include } },
    });
    if (
      !session ||
      Date.now() - session.createdAt.getTime() >= SESSION_MS ||
      !session.staff.active ||
      (session.staff.branch && !session.staff.branch.active)
    )
      throw new UnauthorizedException('กรุณาเข้าสู่ระบบใหม่');
    if (session.staff.mustChangePassword && !allowPasswordChange)
      throw new ForbiddenException('ต้องเปลี่ยนรหัสผ่านก่อนใช้งาน');
    await tx.loginSession.update({
      where: { tokenHash: session.tokenHash },
      data: { lastSeenAt: new Date() },
    });
    return session.staff;
  }
  async login(staffId: string, password: string) {
    const result = await this.transaction(async (tx) => {
      const account = await tx.staff.findUnique({
        where: { staffId },
        include,
      });
      // Equal-cost verification also for unknown IDs; no account existence in the response.
      if (!account) {
        await hashPassword(password);
        return null;
      }
      if (
        !account.active ||
        (account.branch && !account.branch.active) ||
        (account.lockedUntil && account.lockedUntil > new Date())
      )
        return null;
      // With SMS OTP on, ERP accounts sign in by OTP only: their ERP password is not accepted (nor even kept, D85).
      if (this.otpEnabled() && account.erpStaffId !== null) {
        await hashPassword(password);
        return null;
      }
      if (!(await verifyPassword(password, account.passwordHash))) {
        const failures = account.lockedUntil ? 1 : account.failedAttempts + 1;
        await tx.staff.update({
          where: { staffId },
          data: {
            failedAttempts: failures >= 5 ? 0 : failures,
            lockedUntil: failures >= 5 ? new Date(Date.now() + LOCK_MS) : null,
          },
        });
        return null; // Commit failures; throwing inside the transaction would undo them.
      }
      await tx.staff.update({
        where: { staffId },
        data: { failedAttempts: 0, lockedUntil: null },
      });
      const token = await this.createSession(tx, staffId);
      return { token, user: publicAccount(account) };
    });
    if (!result)
      throw new UnauthorizedException(
        this.otpEnabled()
          ? 'Staff ID หรือรหัสผ่านไม่ถูกต้อง หรือบัญชีถูกพัก/ปิดใช้งาน (พนักงานที่ซิงก์จาก ERP ให้เข้าด้วยรหัส OTP ทาง SMS)'
          : 'Staff ID หรือรหัสผ่านไม่ถูกต้อง หรือบัญชีถูกพัก/ปิดใช้งาน',
      );
    return result;
  }
  me(token?: string) {
    if (!token || !/^[a-f0-9]{64}$/.test(token)) {
      throw new UnauthorizedException('กรุณาเข้าสู่ระบบใหม่');
    }
    return this.transaction(async (tx) =>
      publicAccount(await this.actor(tx, token, true)),
    );
  }
  logout(token?: string) {
    if (!token || !/^[a-f0-9]{64}$/.test(token)) {
      return { ok: true };
    }
    return this.transaction(async (tx) => {
      await tx.loginSession.deleteMany({
        where: { tokenHash: tokenHash(token) },
      });
      return { ok: true };
    });
  }
  changePassword(token: string | undefined, current: string, next: string) {
    return this.transaction(async (tx) => {
      const actor = await this.actor(tx, token, true);
      if (actor.erpStaffId !== null) throw new ForbiddenException(ERP_PASSWORD_MESSAGE);
      if (!(await verifyPassword(current, actor.passwordHash)))
        throw new BadRequestException('รหัสผ่านปัจจุบันไม่ถูกต้อง');
      if (current === next)
        throw new BadRequestException(
          'รหัสผ่านใหม่ต้องต่างจากรหัสผ่านชั่วคราว/เดิม',
        );
      await tx.staff.update({
        where: { staffId: actor.staffId },
        data: {
          passwordHash: await hashPassword(next),
          mustChangePassword: false,
        },
      });
      await tx.loginSession.deleteMany({ where: { staffId: actor.staffId } });
      return { ok: true };
    });
  }
  private manager(actor: Account) {
    const roles = actor.roles.map((r) => r.roleCode);
    if (!roles.includes('ADMIN') && !roles.includes('MANAGER'))
      throw new ForbiddenException();
    return roles.includes('ADMIN');
  }
  listStaff(token?: string) {
    return this.transaction(async (tx) => {
      const actor = await this.actor(tx, token);
      const admin = this.manager(actor);
      return (
        await tx.staff.findMany({
          where: admin ? {} : { branchId: actor.branchId },
          include,
          orderBy: { staffId: 'asc' },
        })
      ).map(publicAccount);
    });
  }
  listBranches(token?: string) {
    return this.transaction(async (tx) => {
      const actor = await this.actor(tx, token);
      const admin = this.manager(actor);
      return tx.branch.findMany({
        where: admin ? {} : { id: actor.branchId ?? '' },
        orderBy: { code: 'asc' },
      });
    });
  }
  private async validateAssignment(tx: Tx, data: StaffUpdateDto) {
    const needsBranch = data.roles.some((role) => role !== 'ADMIN');
    if (needsBranch !== Boolean(data.branchId))
      throw new BadRequestException(
        'ADMIN ล้วนไม่มี Branch; บทบาทอื่นต้องมี Branch เดียว',
      );
    if (data.branchId) {
      const branch = await tx.branch.findUnique({
        where: { id: data.branchId },
      });
      if (!branch || (data.active && !branch.active))
        throw new BadRequestException('ต้องเลือก Branch ที่ใช้งานอยู่');
    }
  }
  private assertManagement(
    actor: Account,
    data: StaffUpdateDto,
    target?: Account,
  ) {
    if (this.manager(actor)) return;
    if (
      data.branchId !== actor.branchId ||
      (target && target.branchId !== actor.branchId)
    )
      throw new ForbiddenException('จัดการได้เฉพาะ Branch ของตนเอง');
    // Managers cannot change higher-privilege accounts, including themselves.
    if (
      data.roles.some((r) => r === 'ADMIN' || r === 'MANAGER') ||
      target?.roles.some(
        (r) => r.roleCode === 'ADMIN' || r.roleCode === 'MANAGER',
      )
    )
      throw new ForbiddenException('MANAGER กำหนดได้เฉพาะ STAFF/STOCK/CASHIER');
  }
  createStaff(token: string | undefined, data: StaffCreateDto) {
    return this.transaction(async (tx) => {
      const actor = await this.actor(tx, token);
      this.assertManagement(actor, data);
      await this.validateAssignment(tx, data);
      return publicAccount(
        await tx.staff.create({
          data: {
            staffId: data.staffId,
            firstName: data.firstName ?? '',
            lastName: data.lastName ?? '',
            passwordHash: await hashPassword(data.password),
            phone: data.phone ?? null,
            branchId: data.branchId,
            active: data.active,
            roles: { create: data.roles.map((roleCode) => ({ roleCode })) },
          },
          include,
        }),
      );
    });
  }
  updateStaff(
    token: string | undefined,
    staffId: string,
    data: StaffUpdateDto,
  ) {
    return this.transaction(async (tx) => {
      const actor = await this.actor(tx, token);
      const target = await tx.staff.findUnique({ where: { staffId }, include });
      if (!target) throw new BadRequestException('ไม่พบบัญชี');
      this.assertManagement(actor, data, target);
      await this.validateAssignment(tx, data);
      if (target.erpStaffId !== null) {
        // ADMIN must not depend on data HR can edit in the ERP (it controls the account's password and active flag).
        if (
          data.roles.includes('ADMIN') &&
          !target.roles.some((r) => r.roleCode === 'ADMIN')
        )
          throw new ConflictException(
            'ห้ามตั้ง ADMIN ให้บัญชีที่ซิงก์จาก ERP (ตั้ง MANAGER ได้)',
          );
        // The daily ERP import owns these fields (D54); only ADMIN/MANAGER roles can still be set by hand.
        const managed = (roles: RoleCode[]) =>
          roles.filter((r) => ERP_MANAGED_ROLES.includes(r)).sort().join();
        if (
          (data.firstName !== undefined && data.firstName !== target.firstName) ||
          (data.lastName !== undefined && data.lastName !== target.lastName) ||
          data.branchId !== target.branchId ||
          data.active !== target.active ||
          managed(data.roles) !== managed(target.roles.map((r) => r.roleCode))
        )
          throw new ConflictException(
            'บัญชีนี้ซิงก์จาก ERP: แก้ชื่อ สาขา สถานะ และสิทธิ์ STAFF/STOCK/CASHIER ได้ที่ ERP เท่านั้น (ตั้ง ADMIN/MANAGER ได้ใน SES)',
          );
      }
      if (
        target.active &&
        target.roles.some((r) => r.roleCode === 'ADMIN') &&
        (!data.active || !data.roles.includes('ADMIN'))
      ) {
        const others = await tx.staff.count({
          where: {
            staffId: { not: staffId },
            active: true,
            roles: { some: { roleCode: 'ADMIN' } },
          },
        });
        if (!others)
          throw new ConflictException(
            'ต้องเหลือ ADMIN ที่ใช้งานอย่างน้อยหนึ่งบัญชี',
          );
      }
      // D85: the phone of an ERP account is the ERP's (`tel`); only hand-made accounts take one by hand
      if (data.phone !== undefined && target.erpStaffId !== null && data.phone !== target.phone)
        throw new ConflictException('เบอร์โทรของบัญชีที่ซิงก์จาก ERP แก้ที่ ERP (ฟิลด์ tel) เท่านั้น');
      await tx.staffRole.deleteMany({ where: { staffId } });
      const updated = await tx.staff.update({
        where: { staffId },
        data: {
          ...(data.phone !== undefined ? { phone: data.phone } : {}),
          firstName: data.firstName !== undefined ? data.firstName : target.firstName,
          lastName: data.lastName !== undefined ? data.lastName : target.lastName,
          active: data.active,
          branchId: data.branchId,
          roles: { create: data.roles.map((roleCode) => ({ roleCode })) },
        },
        include,
      });
      if (!data.active)
        await tx.loginSession.deleteMany({ where: { staffId } });
      return publicAccount(updated);
    });
  }
  resetPassword(token: string | undefined, staffId: string, password: string) {
    return this.transaction(async (tx) => {
      const actor = await this.actor(tx, token);
      if (!actor.roles.some((r) => r.roleCode === 'ADMIN'))
        throw new ForbiddenException();
      const target = await tx.staff.findUnique({ where: { staffId } });
      if (!target) throw new BadRequestException('ไม่พบบัญชี');
      if (target.erpStaffId !== null) throw new ConflictException(ERP_PASSWORD_MESSAGE);
      await tx.staff.update({
        where: { staffId },
        data: {
          passwordHash: await hashPassword(password),
          mustChangePassword: true,
          failedAttempts: 0,
          lockedUntil: null,
        },
      });
      await tx.loginSession.deleteMany({ where: { staffId } });
      return { ok: true };
    });
  }
  saveBranch(token: string | undefined, data: BranchDto, existing?: string) {
    return this.transaction(async (tx) => {
      const actor = await this.actor(tx, token);
      if (!actor.roles.some((r) => r.roleCode === 'ADMIN'))
        throw new ForbiddenException();
      if (existing) {
        const current = await tx.branch.findUnique({ where: { id: existing } });
        if (current?.erpBranchId != null)
          throw new ConflictException('สาขานี้ซิงก์จาก ERP (D53) แก้ที่ ERP เท่านั้น');
      }
      if (
        existing &&
        !data.active &&
        (await tx.staff.count({
          where: { branchId: existing, active: true },
        }))
      )
        throw new ConflictException('ยังมี Staff ใช้งานใน Branch นี้');
      if (existing) return tx.branch.update({ where: { id: existing }, data });
      return tx.branch.create({ data });
    });
  }

  /** F10: the QR on the receipt. ADMIN only; the ERP does not own this field, so ERP-managed branches take it too. */
  setBranchRegistrationUrl(token: string | undefined, id: string, url: string | null) {
    return this.transaction(async (tx) => {
      const actor = await this.actor(tx, token);
      if (!actor.roles.some((r) => r.roleCode === 'ADMIN'))
        throw new ForbiddenException();
      const branch = await tx.branch.findUnique({ where: { id } });
      if (!branch) throw new NotFoundException('ไม่พบสาขา');
      return tx.branch.update({ where: { id }, data: { registrationUrl: url } });
    });
  }

  async getAuditLogs(limit = 200) {
    const [events, loginSessions, staffMembers, sessionsWithAck] = await Promise.all([
      this.prisma.sessionEvent.findMany({
        take: Math.min(limit, 500),
        orderBy: { createdAt: 'desc' },
        include: {
          session: {
            select: {
              id: true,
              reference: true,
              queueLetter: true,
              queueNo: true,
              branch: { select: { name: true, code: true } },
            },
          },
        },
      }),
      this.prisma.loginSession.findMany({
        take: 50,
        orderBy: { lastSeenAt: 'desc' },
        include: {
          staff: {
            select: {
              staffId: true,
              firstName: true,
              lastName: true,
              branch: { select: { name: true, code: true } },
            },
          },
        },
      }),
      this.prisma.staff.findMany({
        select: { staffId: true, firstName: true, lastName: true },
      }),
      this.prisma.customerSession.findMany({
        where: {
          stockReview: { not: Prisma.DbNull },
        },
        select: {
          id: true,
          reference: true,
          queueLetter: true,
          queueNo: true,
          stockReview: true,
          branch: { select: { name: true, code: true } },
        },
        take: 100,
        orderBy: { customerWalkInAt: 'desc' },
      }),
    ]);

    const staffNameMap = new Map<string, string>();
    for (const s of staffMembers) {
      const fullName = [s.firstName, s.lastName].filter(Boolean).join(' ');
      staffNameMap.set(s.staffId, fullName || s.staffId);
    }

    const auditItems: Array<{
      id: string;
      timestamp: string;
      category: 'AUTH' | 'WORKFLOW' | 'STOCK' | 'ALERT';
      action: string;
      actionLabel: string;
      actorStaffId: string;
      actorName: string;
      branchName: string;
      sessionId?: string;
      sessionReference?: string;
      /** What staff call the customer by (D57), e.g. "A012". */
      sessionQueue?: string;
      metadata?: Record<string, unknown> | null;
    }> = [];

    // 1. Session Events
    for (const e of events) {
      let category: 'WORKFLOW' | 'STOCK' | 'ALERT' = 'WORKFLOW';
      let label = e.eventType as string;

      if (e.eventType.startsWith('STOCK_')) {
        category = e.eventType === 'STOCK_REPORTED_MISSING' ? 'ALERT' : 'STOCK';
      } else if (e.eventType === 'STAFF_RESOLVED_STOCK_REVIEW') {
        category = 'ALERT';
      }

      switch (e.eventType) {
        case 'SESSION_CREATED': label = 'สร้างรายการบริการ (Walk-in)'; break;
        case 'DEMO_STARTED': label = 'เริ่มสาธิตสินค้า (Demo)'; break;
        case 'DEMO_ENDED': label = 'สิ้นสุดการสาธิตสินค้า'; break;
        case 'DECISION_MADE': label = 'บันทึกการตัดสินใจของลูกค้า'; break;
        case 'PRODUCT_SELECTION_STARTED': label = 'เริ่มเลือกสินค้าและอุปกรณ์'; break;
        case 'PRODUCT_SELECTION_CONFIRMED': label = 'ยืนยันรายการสินค้า'; break;
        case 'STOCK_SEARCHING': label = 'คลังกำลังค้นหาสินค้า'; break;
        case 'STOCK_FOUND': label = 'พบสินค้าในคลังพร้อมส่ง'; break;
        case 'STOCK_SENT_TO_CASHIER': label = 'ส่งสินค้าไปแคชเชียร์'; break;
        case 'STOCK_REPORTED_MISSING': label = 'คลังแจ้งสินค้าไม่พบ / ของขาด'; break;
        case 'STAFF_RESOLVED_STOCK_REVIEW': label = 'พนักงานจัดการสินค้าขาดกับลูกค้า'; break;
        case 'STOCK_OUT_OF_STOCK': label = 'ลูกค้ายกเลิกเนื่องจากของหมด'; break;
        case 'CUSTOMER_CANCELLED': label = 'ลูกค้ายกเลิกรายการ'; break;
        case 'CASHIER_RECEIVED': label = 'แคชเชียร์รับรายการ'; break;
        case 'CASHIER_SCANNED': label = 'แคชเชียร์ยิงบาร์โค้ด'; break;
        case 'BILL_OPENED': label = 'เปิดบิลชำระเงิน'; break;
        case 'COMPLETED': label = 'ทำรายการเสร็จสมบูรณ์'; break;
        case 'CASHIER_REJECTED': label = 'แคชเชียร์ส่งสินค้ากลับ Stock'; break;
        case 'STOCK_ACKNOWLEDGED_CANCEL': label = 'Stock รับทราบการยกเลิก / คืนสินค้าเข้าชั้นแล้ว'; break;
      }

      auditItems.push({
        id: e.id,
        timestamp: e.createdAt.toISOString(),
        category,
        action: e.eventType,
        actionLabel: label,
        actorStaffId: e.actorStaffId,
        actorName: staffNameMap.get(e.actorStaffId) || e.actorStaffId,
        branchName: e.session?.branch?.name || '-',
        sessionId: e.sessionId,
        sessionReference: e.session?.reference,
        sessionQueue: queueOf(e.session),
        metadata: (e.metadata as Record<string, unknown>) || null,
      });
    }

    // 2. Manager Acknowledged Alerts
    for (const s of sessionsWithAck) {
      const sr = s.stockReview as Record<string, unknown> | null;
      if (sr && typeof sr.acknowledgedAt === 'string' && typeof sr.acknowledgedBy === 'string') {
        auditItems.push({
          id: `ack-${s.id}`,
          timestamp: sr.acknowledgedAt,
          category: 'ALERT',
          action: 'MANAGER_ACKNOWLEDGED_ALERT',
          actionLabel: 'ผู้จัดการรับทราบแจ้งเตือนของขาด',
          actorStaffId: sr.acknowledgedBy,
          actorName: staffNameMap.get(sr.acknowledgedBy) || sr.acknowledgedBy,
          branchName: s.branch?.name || '-',
          sessionId: s.id,
          sessionReference: s.reference,
          sessionQueue: queueOf(s),
          metadata: { acknowledgedAt: sr.acknowledgedAt, acknowledgedBy: sr.acknowledgedBy },
        });
      }
    }

    // 3. Login Sessions
    for (const ls of loginSessions) {
      const staffName = ls.staff
        ? [ls.staff.firstName, ls.staff.lastName].filter(Boolean).join(' ') || ls.staff.staffId
        : ls.staffId;
      auditItems.push({
        id: `login-${ls.tokenHash.slice(0, 16)}`,
        timestamp: ls.lastSeenAt.toISOString(),
        category: 'AUTH',
        action: 'ACTIVE_LOGIN_SESSION',
        actionLabel: 'เข้าสู่ระบบ / กำลังใช้งาน',
        actorStaffId: ls.staffId,
        actorName: staffName,
        branchName: ls.staff?.branch?.name || 'Global',
        metadata: { lastSeenAt: ls.lastSeenAt.toISOString() },
      });
    }

    // Sort all by timestamp descending
    auditItems.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    return auditItems.slice(0, limit);
  }
}

