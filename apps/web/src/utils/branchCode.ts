/**
 * D94: a branch made by hand must use the ERP's branch code (ISTA, ISFI, USPSU …). Orders are sent to FileMaker with the branch
 * code (its `ses` script looks it up in the ERP's `branch` table) and warroom keys stock and serial numbers by it, so a code the
 * ERP does not know (the 12 hand-made branches removed on 2026-11-03 were all like that: IS-TM, IS-FI, US-PSU …) silently breaks
 * both. Only a warning: making the branch is still allowed.
 */
export interface BranchLike {
  id?: string;
  code: string;
  name: string;
  erpBranchId?: number | null;
}

export type BranchCodeWarning =
  | { kind: 'duplicate-of-erp'; erpName: string }
  | { kind: 'not-an-erp-code'; examples: string[] }
  | null;

/** What to tell the ADMIN about `code` for a hand-made branch (`branch.erpBranchId` empty); ERP branches are never warned about. */
export function branchCodeWarning(branch: BranchLike, all: BranchLike[]): BranchCodeWarning {
  const code = branch.code.trim();
  if (!code || branch.erpBranchId) return null;
  const erp = all.filter((b) => b.erpBranchId && b.id !== branch.id);
  if (erp.length === 0) return null; // the ERP import has not run: nothing to compare with
  const same = erp.find((b) => b.code.trim().toLowerCase() === code.toLowerCase());
  if (same) return { kind: 'duplicate-of-erp', erpName: same.name };
  return { kind: 'not-an-erp-code', examples: erp.map((b) => b.code).sort().slice(0, 4) };
}
