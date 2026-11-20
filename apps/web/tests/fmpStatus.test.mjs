import assert from 'node:assert/strict';
import { test } from 'node:test';

// the pure part of Summary.tsx's FileMaker line, kept in step with it (D100)
const base = { status: 'sent', attempts: 1, error: null, ackStatus: null, ackMessage: null, at: '2026-11-03T05:00:00.000Z' };
const { fmpStatusText } = await import('../src/features/session/fmpStatusText.ts');

test('the FileMaker line says what happened, worst first (D100)', () => {
  assert.equal(fmpStatusText(null), null);
  assert.equal(fmpStatusText({ ...base, status: 'pending', attempts: 0 }).text, 'กำลังส่งเข้า U POS…');
  assert.match(fmpStatusText({ ...base, status: 'pending', attempts: 2, error: 'FileMaker ไม่ตอบภายใน 60 วินาที' }).text, /ครั้งที่ 2/);
  assert.equal(fmpStatusText(base).tone, 'wait');
  const failed = fmpStatusText({ ...base, status: 'failed', error: 'FileMaker ปฏิเสธ (HTTP 500)' });
  assert.equal(failed.tone, 'bad');
  assert.match(failed.hint, /ส่งซ้ำ/);
  assert.equal(failed.detail, 'FileMaker ปฏิเสธ (HTTP 500)'); // D185: FileMaker's words are folded away, not lost
  const ok = fmpStatusText({ ...base, ackStatus: 'success', ackMessage: 'CREATED saleID S-1 (1 รายการ)' });
  assert.deepEqual([ok.tone, ok.text, ok.detail], ['ok', 'ส่งเข้า U POS แล้ว บิลพักครบ 1 รายการ', 'CREATED saleID S-1 (1 รายการ)']);
  const sn = fmpStatusText({ ...base, ackStatus: 'error', ackMessage: 'SN_NOT_FOUND: SN F9X not found in stock' });
  assert.equal(sn.tone, 'bad');
  assert.match(sn.hint, /ส่งกลับ Stock/);
  assert.match(fmpStatusText({ ...base, ackStatus: 'error', ackMessage: 'WRONG_BRANCH: branch.code is wrong' }).hint, /ADMIN/);
});

test('a unit FileMaker does not have here yet, and a held bill waiting for serials (D103)', () => {
  const wrong = fmpStatusText({ ...base, ackStatus: 'error', ackMessage: 'SN_WRONG_BRANCH: SN 3577 is in branch 16, not ISTA (9)' });
  assert.equal(wrong.tone, 'bad');
  assert.match(wrong.hint, /รับโอนใน U POS แล้ว ADMIN กด "ส่งซ้ำ"/);
  assert.equal(wrong.detail, 'SN_WRONG_BRANCH: SN 3577 is in branch 16, not ISTA (9)');
  assert.match(fmpStatusText({ ...base, ackStatus: 'error', ackMessage: 'SN_MODEL_MISMATCH: SN X is model Y' }).hint, /^Serial Number ไม่ตรง/);
  const later = fmpStatusText({ ...base, ackStatus: 'success', ackMessage: 'CREATED_SN_LATER saleID S-9 (1 รายการ): แคชเชียร์สแกนขายเพิ่ม 1 เครื่อง' });
  assert.equal(later.tone, 'warn');
  assert.match(later.hint, /สแกนขายเครื่องที่ขาดเพิ่มในบิล/);
  // D185: the line counts the serials left off in the shop's words; the script's message (saleID, codes) is the detail
  assert.equal(later.text, 'ส่งเข้า U POS แล้ว แต่ยังขาดบางเครื่องในบิล');
  const counted = fmpStatusText({ ...base, ackStatus: 'success', ackMessage: 'CREATED_SN_LATER saleID S-9 (0 รายการ)', snMissing: [{ sn: 'A' }, { sn: 'B' }] });
  assert.equal(counted.text, 'ส่งเข้า U POS แล้ว แต่ยังขาด 2 เครื่องในบิล');
  assert.doesNotMatch(counted.text, /saleID|CREATED/);
  assert.match(counted.detail, /^CREATED_SN_LATER saleID S-9/);
});

test('an order sent with serials missing, refused by an older FileMaker script, says to key the bill in by hand (D103)', () => {
  const r = fmpStatusText({ ...base, ackStatus: 'error', ackMessage: 'SN_COUNT_MISMATCH: MG6M4ZP/A quantity=1 but sn=0' });
  assert.equal(r.tone, 'bad');
  assert.match(r.hint, /คีย์บิลเอง/);
  assert.doesNotMatch(r.hint, /ส่งกลับ Stock/);
});


test('answers about taking the held draft out read as what the cashier must do (D129)', () => {
  const released = fmpStatusText({ ...base, ackStatus: 'success', ackMessage: 'RELEASED saleID 99 (2 รายการ): ส่งกลับ STOCK: เอาบิลพักออกแล้ว 2 รายการ' });
  assert.deepEqual([released.tone, released.text], ['ok', 'U POS เอาร่างบิลออกแล้ว SN ว่าง สแกนใหม่ได้']);
  assert.equal(fmpStatusText({ ...base, ackStatus: 'success', ackMessage: 'NOTHING_TO_RELEASE: ส่งกลับ STOCK: ไม่มีบิลพักให้เอาออก' }).tone, 'ok');
  const confirmed = fmpStatusText({ ...base, ackStatus: 'error', ackMessage: 'BILL_CONFIRMED saleID 99: ไม่พบร่างบิลแล้ว' });
  assert.equal(confirmed.tone, 'bad');
  assert.match(confirmed.text, /บิลจริง/);
  assert.match(confirmed.hint, /ยกเลิกบิลจริง/);
  assert.match(fmpStatusText({ ...base, ackStatus: 'error', ackMessage: 'BILL_IN_USE saleID 99: status open' }).text, /ทำรายการอยู่/);
  assert.match(fmpStatusText({ ...base, ackStatus: 'error', ackMessage: 'RELEASE_FAILED: 5011 locked' }).hint, /ส่งซ้ำ/);
  assert.match(fmpStatusText({ ...base, ackStatus: 'error', ackMessage: 'QUERY_FAILED: customer lookup failed' }).hint, /ส่งซ้ำ/);
  // anything else reads as an ordinary answer
  assert.equal(fmpStatusText({ ...base, ackStatus: 'success', ackMessage: 'CREATED saleID S-1 (1 รายการ)' }).text, 'ส่งเข้า U POS แล้ว บิลพักครบ 1 รายการ');
  assert.equal(fmpStatusText({ ...base, ackStatus: 'success', ackMessage: 'SOMETHING_NEW' }).text, 'U POS รับแล้ว');
});

test('D130: a message ADMIN held back says U POS got nothing and the cashier keys the bill in', () => {
  const line = fmpStatusText({ status: 'skipped', target: 'NONE', attempts: 0, error: 'ADMIN ปิดการส่งเข้า U POS (FileMaker) อยู่', ackStatus: null, ackMessage: null, at: '2026-11-12T10:00:00Z' });
  assert.equal(line.tone, 'warn');
  assert.match(line.text, /^ไม่ได้ส่งเข้า U POS: ADMIN ปิดการส่ง/);
  assert.match(line.hint, /คีย์บิลเองใน U POS/);
});

test('D130: an order sent to the test FileMaker is labelled UAT; production orders read as before', () => {
  const base = { status: 'sent', attempts: 1, error: null, ackStatus: 'success', ackMessage: 'CREATED', at: '2026-11-12T10:00:00Z' };
  assert.match(fmpStatusText({ ...base, target: 'UAT' }).text, /^\[ระบบทดสอบ\] U POS รับแล้ว/);
  assert.equal(fmpStatusText({ ...base, target: 'PRODUCTION' }).text, fmpStatusText(base).text);
  assert.doesNotMatch(fmpStatusText({ ...base, target: 'PRODUCTION' }).text, /UAT/);
});

test('D140: a queue card gets a short red tag only when the FileMaker side needs a person', async () => {
  const { fmpAlert } = await import('../src/features/session/fmpStatusText.ts');
  assert.equal(fmpAlert(null), null);
  assert.equal(fmpAlert(base), null); // sent, no answer yet
  assert.equal(fmpAlert({ ...base, ackStatus: 'success', ackMessage: 'CREATED saleID S-1 (1 รายการ)' }), null);
  assert.equal(fmpAlert({ ...base, ackStatus: 'success', ackMessage: 'RELEASED saleID 99 (2 รายการ)' }), null);
  assert.equal(fmpAlert({ status: 'skipped', target: 'NONE', attempts: 0, error: 'ADMIN ปิดการส่ง', ackStatus: null, ackMessage: null, at: base.at }), null);
  // a held bill cancelled in FileMaker is not an SES cancel (D121): never just "ยกเลิก"
  assert.equal(fmpAlert({ ...base, target: 'UAT', ackStatus: 'error', ackMessage: 'CANCELLED (บิลพัก): ยกเลิกบิลพักใน FMP' }), 'FMP ยกเลิกบิลพัก');
  assert.equal(fmpAlert({ ...base, ackStatus: 'error', ackMessage: 'CANCELLED (ชำระแล้ว บิล 6611-0042): ลูกค้าคืนเครื่อง' }), 'FMP ยกเลิกบิลที่ชำระแล้ว');
  assert.equal(fmpAlert({ ...base, ackStatus: 'error', ackMessage: 'BILL_CONFIRMED saleID 99: ไม่พบร่างบิลแล้ว' }), 'FMP เอาร่างบิลออกไม่ได้');
  assert.equal(fmpAlert({ ...base, ackStatus: 'error', ackMessage: 'SN_NOT_FOUND: SN F9X not found in stock' }), 'FMP ไม่รับ');
  assert.equal(fmpAlert({ ...base, status: 'failed', error: 'FileMaker ปฏิเสธ (HTTP 500)' }), 'ส่ง FMP ไม่สำเร็จ');

  // the API's rule decides (`attention`, the same as Admin's "ออเดอร์ที่ต้องดู"): a message stuck in the queue, a bill opened without some serials
  assert.equal(fmpAlert({ ...base, status: 'pending', attempts: 0, attention: 'stuck' }), 'ส่ง FMP ค้าง');
  assert.equal(fmpAlert({ ...base, status: 'pending', attempts: 0, attention: null }), null); // just queued
  assert.equal(fmpAlert({ ...base, ackStatus: 'success', ackMessage: 'CREATED_SN_LATER saleID S-1', attention: 'sn-skipped' }), 'บิล FMP ขาด SN');
  assert.equal(fmpAlert({ ...base, ackStatus: 'error', ackMessage: 'CANCELLED (บิลพัก): ยกเลิกบิลพักใน FMP', attention: 'ack-error' }), 'FMP ยกเลิกบิลพัก');
  assert.equal(fmpAlert({ ...base, ackStatus: 'error', ackMessage: 'SN_NOT_FOUND', attention: null }), null); // the API says no: the card follows it
  // a failed delivery wins over an answer that came on the callback door: red, and the summary says the delivery failed
  const failedWithReport = { ...base, status: 'failed', error: 'FileMaker ไม่ตอบภายใน 60 วินาที', ackStatus: 'reported', ackMessage: 'หมายเหตุจากร้าน' };
  assert.equal(fmpAlert(failedWithReport), 'ส่ง FMP ไม่สำเร็จ');
  assert.equal(fmpAlert({ ...failedWithReport, attention: 'failed' }), 'ส่ง FMP ไม่สำเร็จ');
  assert.equal(fmpStatusText(failedWithReport).tone, 'bad');
  assert.match(fmpStatusText(failedWithReport).text, /^ส่งเข้า U POS ไม่สำเร็จ/);
});
