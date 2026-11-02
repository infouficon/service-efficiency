import assert from 'node:assert/strict';
import { test } from 'node:test';
import { branchCodeWarning } from '../src/utils/branchCode.ts';

const erp = [
  { id: 'e1', code: 'ISTA', name: 'iStudio @ Terminal 21 Asok', erpBranchId: 9 },
  { id: 'e2', code: 'ISFI', name: 'iStudio @ Fashion Island', erpBranchId: 19 },
  { id: 'e3', code: 'USPSU', name: 'U•Store @ Prince of Songkla U.', erpBranchId: 30 },
];

test('a hand-made code the ERP does not know is warned about, with real codes as examples (D94)', () => {
  assert.deepEqual(branchCodeWarning({ code: 'IS-TM', name: 'Terminal 21' }, erp), { kind: 'not-an-erp-code', examples: ['ISFI', 'ISTA', 'USPSU'] });
  assert.deepEqual(branchCodeWarning({ code: ' HO ', name: 'สำนักงานใหญ่' }, erp)?.kind, 'not-an-erp-code');
});

test('a hand-made branch that repeats an ERP code is pointed at the ERP branch instead (case and spaces do not matter)', () => {
  assert.deepEqual(branchCodeWarning({ code: 'ista ', name: 'x' }, erp), { kind: 'duplicate-of-erp', erpName: 'iStudio @ Terminal 21 Asok' });
});

test('nothing to say: an ERP branch, an empty code, or no ERP branches yet (the import has not run)', () => {
  assert.equal(branchCodeWarning({ id: 'e1', code: 'ISTA', name: 'x', erpBranchId: 9 }, erp), null);
  assert.equal(branchCodeWarning({ code: '  ', name: 'x' }, erp), null);
  assert.equal(branchCodeWarning({ code: 'IS-TM', name: 'x' }, [{ code: 'HO', name: 'hand', erpBranchId: null }]), null);
  assert.equal(branchCodeWarning({ id: 'e1', code: 'ISTA', name: 'x', erpBranchId: null }, erp)?.kind, 'not-an-erp-code', 'its own row is not compared with itself');
});
