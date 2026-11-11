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

test('a unit FileMaker does not have here yet, and a held bill waiting for serials (D103)', () => {
  const wrong = fmpStatusText({ ...base, ackStatus: 'error', ackMessage: 'SN_WRONG_BRANCH: SN 3577 is in branch 16, not ISTA (9)' });
  assert.equal(wrong.tone, 'bad');
  assert.match(wrong.hint, /รับโอนใน FileMaker แล้ว ADMIN กด "ส่งซ้ำ"/);
  assert.match(fmpStatusText({ ...base, ackStatus: 'error', ackMessage: 'SN_MODEL_MISMATCH: SN X is model Y' }).hint, /^Serial Number ไม่ตรง/);
  const later = fmpStatusText({ ...base, ackStatus: 'success', ackMessage: 'CREATED_SN_LATER saleID S-9 (1 รายการ): แคชเชียร์สแกนขายเพิ่ม 1 เครื่อง' });
  assert.equal(later.tone, 'warn');
  assert.match(later.hint, /สแกนขายเครื่องที่ขาดเพิ่มในบิล/);
});

test('an order sent with serials missing, refused by an older FileMaker script, says to key the bill in by hand (D103)', () => {
  const r = fmpStatusText({ ...base, ackStatus: 'error', ackMessage: 'SN_COUNT_MISMATCH: MG6M4ZP/A quantity=1 but sn=0' });
  assert.equal(r.tone, 'bad');
  assert.match(r.hint, /คีย์บิลเอง/);
  assert.doesNotMatch(r.hint, /ส่งกลับ Stock/);
});


test('answers about taking the held draft out read as what the cashier must do (D129)', () => {
  const released = fmpStatusText({ ...base, ackStatus: 'success', ackMessage: 'RELEASED saleID 99 (2 รายการ): ส่งกลับ STOCK: เอาบิลพักออกแล้ว 2 รายการ' });
  assert.deepEqual([released.tone, released.text], ['ok', 'FileMaker เอาร่างบิลออกแล้ว SN ว่าง สแกนใหม่ได้']);
  assert.equal(fmpStatusText({ ...base, ackStatus: 'success', ackMessage: 'NOTHING_TO_RELEASE: ส่งกลับ STOCK: ไม่มีบิลพักให้เอาออก' }).tone, 'ok');
  const confirmed = fmpStatusText({ ...base, ackStatus: 'error', ackMessage: 'BILL_CONFIRMED saleID 99: ไม่พบร่างบิลแล้ว' });
  assert.equal(confirmed.tone, 'bad');
  assert.match(confirmed.text, /บิลจริง/);
  assert.match(confirmed.hint, /ยกเลิกบิลจริง/);
  assert.match(fmpStatusText({ ...base, ackStatus: 'error', ackMessage: 'BILL_IN_USE saleID 99: status open' }).text, /ทำรายการอยู่/);
  assert.match(fmpStatusText({ ...base, ackStatus: 'error', ackMessage: 'RELEASE_FAILED: 5011 locked' }).hint, /ส่งซ้ำ/);
  assert.match(fmpStatusText({ ...base, ackStatus: 'error', ackMessage: 'QUERY_FAILED: customer lookup failed' }).hint, /ส่งซ้ำ/);
  // anything else keeps its old wording
  assert.equal(fmpStatusText({ ...base, ackStatus: 'success', ackMessage: 'CREATED saleID S-1 (1 รายการ)' }).text, 'FileMaker รับแล้ว: CREATED saleID S-1 (1 รายการ)');
});
