import type { Role } from './session';
export interface Account {
  staffId: string;
  firstName?: string;
  lastName?: string;
  name?: string;
  roles: Role[];
  branchId: string | null;
  branchCode: string | null;
  branch: string;
  active: boolean;
  mustChangePassword: boolean;
  /** True for accounts created by the daily ERP import (D54): the ERP owns their password, name, branch, active flag and STAFF/STOCK/CASHIER roles. */
  erpManaged: boolean;
  /** the contact number, masked ("08X-XXX-1234"); null = none. Not used to send login codes (D117) */
  phone?: string | null;
  /** a LINE userId is stored (from the ERP), so the login code can go to it; UFHR may know one more (D113) */
  hasLine?: boolean;
}
export interface ManagedBranch {
  id: string;
  code: string;
  name: string;
  phone: string;
  active: boolean;
  /** The address the receipt's QR opens (F10). Set by ADMIN, also on ERP-managed branches. */
  registrationUrl?: string | null;
  erpBranchId?: number | null;
}
/** The roles an account can be given. D105: no CASHIER (the cashiers work in U POS; old accounts keep it in the database). */
export const accountRoles: Role[] = [
  'ADMIN',
  'MANAGER',
  'STAFF',
  'STOCK',
];
