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
  /** the number the login OTP goes to, masked ("08X-XXX-1234"); null = none, so no OTP login (D85) */
  phone?: string | null;
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
export const accountRoles: Role[] = [
  'ADMIN',
  'MANAGER',
  'STAFF',
  'STOCK',
  'CASHIER',
];
