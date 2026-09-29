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
