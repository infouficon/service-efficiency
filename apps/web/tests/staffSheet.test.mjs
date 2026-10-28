import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  headerKey,
  IMPORT_KEYS,
  rowsFromSheet,
  sheetsFromExport,
  stampForFile,
} from '../src/utils/staffSheet.ts';

const known = ['staffId', 'firstName', 'lastName', 'branchCode', 'roles', 'active', 'phone', 'erpStaffId', 'updatedAt'];

test('headers are matched by their key, whatever the case or the explanation after it (D86)', () => {
  assert.equal(headerKey('staffId', known), 'staffId');
  assert.equal(headerKey(' StaffID ', known), 'staffId');
  assert.equal(headerKey('phone (เบอร์มือถือ)', known), 'phone');
  assert.equal(headerKey('BRANCHCODE', known), 'branchCode');
  assert.equal(headerKey('เบอร์โทร', known), null);
  assert.equal(headerKey(null, known), null);
  assert.equal(headerKey(42, known), null);
  assert.deepEqual([...IMPORT_KEYS], ['staffId', 'firstName', 'lastName', 'branchCode', 'roles', 'active', 'phone']);
});

test('an uploaded sheet becomes one object per data row; blank rows and empty cells are dropped', () => {
  const data = [
    [],
    ['staffId', 'firstName', 'phone', 'mystery', 'active', 'updatedAt'],
    ['1001', 'สมชาย', 812345678, 'x', true, new Date('2026-10-29T00:00:00Z')],
    [null, '', '', '', '', ''],
    [1002, '', '081-111-2222', null, 'FALSE', ''],
    ['   ', ' ', null],
  ];
  const out = rowsFromSheet(data, known);
  assert.equal(out.missingKey, false);
  assert.deepEqual(out.unknownColumns, ['mystery']);
  assert.deepEqual(out.columns, ['staffId', 'firstName', 'phone', 'active', 'updatedAt']);
  assert.deepEqual(out.rows, [
    { staffId: '1001', firstName: 'สมชาย', phone: 812345678, active: true, updatedAt: '2026-10-29T00:00:00.000Z' },
    { staffId: 1002, phone: '081-111-2222', active: 'FALSE' },
  ]);
});

test('a file without a staffId column, or an empty file, cannot be imported', () => {
  assert.equal(rowsFromSheet([['firstName'], ['a']], known).missingKey, true);
  assert.equal(rowsFromSheet([], known).missingKey, true);
  assert.deepEqual(rowsFromSheet([[null, '']], known).rows, []);
});

test('the export becomes a Staff sheet (header = keys, empty = blank cell) and a guide sheet', () => {
  const exp = {
    generatedAt: '2026-10-29 14:05:09',
    columns: [
      { key: 'staffId', label: 'รหัสพนักงาน', importable: true, note: 'กุญแจ' },
      { key: 'phone', label: 'เบอร์', importable: true, note: 'n' },
      { key: 'updatedAt', label: 'แก้ไขล่าสุด', importable: false, note: 'ดูอย่างเดียว' },
    ],
    rows: [{ staffId: '1001', phone: '0812345678', updatedAt: '' }, { staffId: '1002', phone: '', updatedAt: '2026-10-29 10:00:00' }],
  };
  const { staff, guide } = sheetsFromExport(exp);
  assert.deepEqual(staff, [
    ['staffId', 'phone', 'updatedAt'],
    ['1001', '0812345678', null],
    ['1002', null, '2026-10-29 10:00:00'],
  ]);
  assert.equal(staff[1][1], '0812345678', 'the phone stays text, so Excel keeps the leading zero');
  assert.ok(guide.some((r) => r[0] === 'phone' && r[2] === 'ได้'));
  assert.ok(guide.some((r) => r[0] === 'updatedAt' && r[2] === 'ดูอย่างเดียว'));
  assert.ok(guide[1][0].includes('2026-10-29 14:05:09'));
  // what comes out of an export reads back
  const back = rowsFromSheet(staff, ['staffId', 'phone', 'updatedAt']);
  assert.deepEqual(back.rows, [
    { staffId: '1001', phone: '0812345678' },
    { staffId: '1002', updatedAt: '2026-10-29 10:00:00' },
  ]);
});

test('the file name carries the Bangkok time', () => {
  assert.equal(stampForFile(new Date('2026-10-29T07:05:09Z')), '20261029-1405');
});
