import assert from 'node:assert/strict';
import { test } from 'node:test';

// the pure part of Summary.tsx's FileMaker line, kept in step with it (D100)
const base = { status: 'sent', attempts: 1, error: null, ackStatus: null, ackMessage: null, at: '2026-11-03T05:00:00.000Z' };
const { fmpStatusText } = await import('../src/features/session/fmpStatusText.ts');

test('the FileMaker line says what happened, worst first (D100)', () => {
  assert.equal(fmpStatusText(null), null);
  assert.equal(fmpStatusText({ ...base, status: 'pending', attempts: 0 }).text, 'กำลังส่งไป FileMaker…');
  assert.match(fmpStatusText({ ...base, status: 'pending', attempts: 2, error: 'FileMaker ไม่ตอบภายใน 60 วินาที' }).text, /ครั้งที่ 2/);
  assert.equal(fmpStatusText(base).tone, 'wait');
  const failed = fmpStatusText({ ...base, status: 'failed', error: 'FileMaker ปฏิเสธ (HTTP 500)' });
  assert.equal(failed.tone, 'bad');
  assert.match(failed.hint, /ส่งซ้ำ/);
  const ok = fmpStatusText({ ...base, ackStatus: 'success', ackMessage: 'CREATED saleID S-1 (1 รายการ)' });
  assert.deepEqual([ok.tone, ok.text], ['ok', 'FileMaker รับแล้ว: CREATED saleID S-1 (1 รายการ)']);
  const sn = fmpStatusText({ ...base, ackStatus: 'error', ackMessage: 'SN_NOT_FOUND: SN F9X not found in stock' });
  assert.equal(sn.tone, 'bad');
  assert.match(sn.hint, /ส่งกลับ Stock/);
  assert.match(fmpStatusText({ ...base, ackStatus: 'error', ackMessage: 'WRONG_BRANCH: branch.code is wrong' }).hint, /ADMIN/);
});
