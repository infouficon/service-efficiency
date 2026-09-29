import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import {
  hashPassword,
  IDLE_MS,
  LOCK_MS,
  tokenHash,
  verifyPassword,
} from './password';
import { BranchDto, StaffCreateDto, StaffUpdateDto } from './dto';
const include = { roles: true, branch: true } satisfies Prisma.StaffInclude;
export type Account = Prisma.StaffGetPayload<{ include: typeof include }>;
export type PublicAccount = ReturnType<typeof publicAccount>;
type Tx = Prisma.TransactionClient;
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
  };
}
@Injectable()
export class AccountsService {
  constructor(private readonly prisma: PrismaService) {}

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
      Date.now() - session.lastSeenAt.getTime() >= IDLE_MS ||
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
      const token = randomBytes(32).toString('hex');
      await tx.loginSession.deleteMany({
        where: { lastSeenAt: { lte: new Date(Date.now() - IDLE_MS) } },
      });
      await tx.loginSession.create({
        data: { tokenHash: tokenHash(token), staffId, lastSeenAt: new Date() },
      });
      return { token, user: publicAccount(account) };
    });
    if (!result)
      throw new UnauthorizedException(
        'Staff ID หรือรหัสผ่านไม่ถูกต้อง หรือบัญชีถูกพัก/ปิดใช้งาน',
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
      await tx.staffRole.deleteMany({ where: { staffId } });
      const updated = await tx.staff.update({
        where: { staffId },
        data: {
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
}
