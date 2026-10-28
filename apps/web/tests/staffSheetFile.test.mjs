import { test } from 'node:test';
import assert from 'node:assert/strict';
import writeExcelFile from 'write-excel-file/universal';
import { readSheet } from 'read-excel-file/universal';
import { rowsFromSheet, sheetsFromExport } from '../src/utils/staffSheet.ts';

// The real libraries, with the shapes StaffSheetTools gives them: an .xlsx written, then read back, as a person would after Excel.
test('an exported staff file is a real .xlsx that reads back to the same rows (D86)', async () => {
  const exp = {
    generatedAt: '2026-10-29 14:05:09',
    columns: [
      { key: 'staffId', label: 'รหัสพนักงาน', importable: true, note: 'กุญแจ' },
      { key: 'firstName', label: 'ชื่อ', importable: true, note: '' },
      { key: 'phone', label: 'เบอร์', importable: true, note: '' },
      { key: 'active', label: 'ใช้งาน', importable: true, note: '' },
      { key: 'erpStaffId', label: 'staff_id ใน ERP', importable: false, note: '' },
      { key: 'updatedAt', label: 'แก้ไขล่าสุด', importable: false, note: '' },
    ],
    rows: [
      { staffId: '1001', firstName: 'สมชาย ใจดี', phone: '0812345678', active: true, erpStaffId: 1001, updatedAt: '2026-10-29 10:00:00' },
      { staffId: 'ADMIN001', firstName: '', phone: '', active: false, erpStaffId: '', updatedAt: '' },
    ],
  };
  const { staff, guide } = sheetsFromExport(exp);
  const importable = new Set(exp.columns.filter((c) => c.importable).map((c) => c.key));
  const blob = await writeExcelFile([
    {
      sheet: 'Staff',
      data: [
        staff[0].map((v) => ({ value: String(v), fontWeight: 'bold', backgroundColor: importable.has(String(v)) ? '#d8f3ee' : '#e9ecef' })),
        ...staff.slice(1),
      ],
      columns: exp.columns.map(() => ({ width: 16 })),
      stickyRowsCount: 1,
    },
    { sheet: 'คำอธิบาย', data: guide.map((r) => r.map((v) => (v === null ? undefined : v))), columns: [{ width: 22 }, { width: 28 }, { width: 12 }, { width: 90 }] },
  ]).toBlob();
  assert.ok(blob.size > 1000);
  const data = await readSheet(blob, 'Staff');
  const parsed = rowsFromSheet(data, exp.columns.map((c) => c.key));
  assert.equal(parsed.missingKey, false);
  assert.deepEqual(parsed.unknownColumns, []);
  assert.deepEqual(parsed.rows[0], {
    staffId: '1001',
    firstName: 'สมชาย ใจดี',
    phone: '0812345678',
    active: true,
    erpStaffId: 1001,
    updatedAt: '2026-10-29 10:00:00',
  });
  assert.equal(typeof parsed.rows[0].phone, 'string', 'the phone is text: the leading zero survives');
  assert.deepEqual(parsed.rows[1], { staffId: 'ADMIN001', active: false });
  // the guide sheet is a second sheet, and the file also reads without naming the sheet (the first is Staff)
  const guideRows = await readSheet(blob, 'คำอธิบาย');
  assert.ok(guideRows.some((r) => r[0] === 'phone'));
  const firstSheet = await readSheet(blob);
  assert.equal(firstSheet[0][0], 'staffId');
  await assert.rejects(() => readSheet(blob, 'NoSuchSheet'));
});
