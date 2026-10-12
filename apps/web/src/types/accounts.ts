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
}
export interface ManagedBranch {
  id: string;
  code: string;
  name: string;
  phone: string;
  active: boolean;
}
export const accountRoles: Role[] = [
  'ADMIN',
  'MANAGER',
  'STAFF',
  'STOCK',
  'CASHIER',
];
