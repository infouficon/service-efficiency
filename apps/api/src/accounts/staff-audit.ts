import { randomUUID } from 'node:crypto';
import type { Prisma, RoleCode } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service';

/**
 * The audit trail of user accounts (D92): who created or changed an account, reset a password, exported the staff list or picked
 * a person from the ERP by hand. Rows are written with the caller's transaction (`tx`), so a change and its row stand or fall
 * together. A row never holds a password or a hash, and a phone number only as its last four digits.
 */
type Db = Pick<PrismaService, 'staffAudit'> | Prisma.TransactionClient;

export type StaffAuditAction =
  | 'ACCOUNT_CREATED'
  | 'ACCOUNT_UPDATED'
  | 'ACCOUNT_PASSWORD_RESET'
  | 'ACCOUNT_PASSWORD_CHANGED'
  | 'ACCOUNTS_EXPORTED'
  | 'ERP_EXTRA_SET'
  | 'ERP_EXTRA_REMOVED';
/** Where the change came from: the staff form, the spreadsheet import, the person themself, the ERP "pick by hand" list. */
export type StaffAuditVia = 'form' | 'import' | 'self' | 'erp-extras';

/** `0812345678` -> `******5678`. */
export function maskedPhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  return phone.length <= 4 ? '*'.repeat(phone.length) : '*'.repeat(phone.length - 4) + phone.slice(-4);
}

/** The fields of an account the trail follows. */
export interface AccountState {
  firstName: string;
  lastName: string;
  roles: RoleCode[];
  branchCode: string | null;
  active: boolean;
  phone: string | null;
}
export const stateOf = (a: {
  firstName: string;
  lastName: string;
  roles: { roleCode: RoleCode }[];
  branch: { code: string } | null;
  active: boolean;
  phone: string | null;
}): AccountState => ({
  firstName: a.firstName,
  lastName: a.lastName,
  roles: a.roles.map((r) => r.roleCode),
  branchCode: a.branch?.code ?? null,
  active: a.active,
  phone: a.phone,
});

type Change = { from: unknown; to: unknown };
const sortedRoles = (roles: RoleCode[]) => [...roles].sort();

/** The fields that differ, as `{ from, to }`; the phone masked, roles sorted. Empty = nothing changed. */
export function accountChanges(before: AccountState, after: AccountState): Record<string, Change> {
  const changes: Record<string, Change> = {};
  if (before.firstName !== after.firstName) changes.firstName = { from: before.firstName, to: after.firstName };
  if (before.lastName !== after.lastName) changes.lastName = { from: before.lastName, to: after.lastName };
  if (sortedRoles(before.roles).join() !== sortedRoles(after.roles).join())
    changes.roles = { from: sortedRoles(before.roles), to: sortedRoles(after.roles) };
  if (before.branchCode !== after.branchCode) changes.branch = { from: before.branchCode, to: after.branchCode };
  if (before.active !== after.active) changes.active = { from: before.active, to: after.active };
  if (before.phone !== after.phone) changes.phone = { from: maskedPhone(before.phone), to: maskedPhone(after.phone) };
  return changes;
}

/** What a new account started with (the same shape as `accountChanges`, `from` is nothing). */
export function accountStart(state: AccountState): Record<string, Change> {
  return {
    firstName: { from: null, to: state.firstName },
    lastName: { from: null, to: state.lastName },
    roles: { from: null, to: sortedRoles(state.roles) },
    branch: { from: null, to: state.branchCode },
    active: { from: null, to: state.active },
    phone: { from: null, to: maskedPhone(state.phone) },
  };
}

/** Writes one row of the trail with the caller's transaction. */
export async function recordStaffAudit(
  db: Db,
  entry: {
    actorStaffId: string;
    action: StaffAuditAction;
    targetStaffId?: string | null;
    via: StaffAuditVia;
    changes?: Record<string, unknown>;
  },
): Promise<void> {
  await db.staffAudit.create({
    data: {
      id: randomUUID(),
      createdAt: new Date(),
      actorStaffId: entry.actorStaffId.slice(0, 64),
      action: entry.action,
      targetStaffId: entry.targetStaffId?.slice(0, 64) ?? null,
      via: entry.via,
      changes: (entry.changes ?? undefined) as Prisma.InputJsonValue | undefined,
    },
  });
}

/** The Thai wording of a row on the audit page; an update says what happened to the account that matters most. */
export function staffAuditLabel(action: string, changes: unknown): string {
  const diff = (changes && typeof changes === 'object' ? changes : {}) as Record<string, Change | undefined>;
  switch (action) {
    case 'ACCOUNT_CREATED':
      return 'สร้างบัญชีผู้ใช้';
    case 'ACCOUNT_PASSWORD_RESET':
      return 'ตั้งรหัสผ่านใหม่ให้บัญชี';
    case 'ACCOUNT_PASSWORD_CHANGED':
      return 'เปลี่ยนรหัสผ่านของตนเอง';
    case 'ACCOUNTS_EXPORTED':
      return 'ส่งออกรายชื่อผู้ใช้ (Excel)';
    case 'ERP_EXTRA_SET':
      return 'เลือกพนักงานจาก ERP เพิ่มเอง';
    case 'ERP_EXTRA_REMOVED':
      return 'เอาพนักงานออกจากรายการเลือกเอง (ERP)';
    case 'ACCOUNT_UPDATED': {
      const from = (diff.roles?.from as RoleCode[] | undefined) ?? [];
      const to = (diff.roles?.to as RoleCode[] | undefined) ?? [];
      if (diff.roles && !from.includes('ADMIN') && to.includes('ADMIN')) return 'ให้สิทธิ์ ADMIN';
      if (diff.roles && from.includes('ADMIN') && !to.includes('ADMIN')) return 'ถอนสิทธิ์ ADMIN';
      if (diff.active?.to === false) return 'ปิดใช้งานบัญชี';
      if (diff.active?.to === true) return 'เปิดใช้งานบัญชีอีกครั้ง';
      const names: Record<string, string> = { firstName: 'ชื่อ', lastName: 'นามสกุล', roles: 'บทบาท', branch: 'สาขา', phone: 'เบอร์โทร' };
      const fields = Object.keys(diff).map((k) => names[k] ?? k);
      return `แก้ไขบัญชีผู้ใช้${fields.length ? ` (${fields.join(', ')})` : ''}`;
    }
    default:
      return action;
  }
}
