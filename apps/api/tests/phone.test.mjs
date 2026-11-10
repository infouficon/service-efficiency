import test from 'node:test';
import assert from 'node:assert/strict';

const {
  normalizePhone,
  isValidPhone,
  formatDisplayPhone,
  toOutboundCustomerPhone,
} = await import('../dist/common/phone.util.js');

const { orderView } = await import('../dist/sessions/order-view.js');

test('D120: Thai mobile normalization (10-digit with 0, 9-digit without 0)', () => {
  assert.equal(normalizePhone('0812345678'), '+66812345678');
  assert.equal(normalizePhone('812345678'), '+66812345678');
  assert.equal(normalizePhone('0912345678'), '+66912345678');
  assert.equal(normalizePhone('912345678'), '+66912345678');
  assert.equal(isValidPhone('0812345678'), true);
  assert.equal(isValidPhone('812345678'), true);
});

test('D120: Thai company / landline normalization (9-digit with 0, 8-digit without 0)', () => {
  assert.equal(normalizePhone('021234567'), '+6621234567');
  assert.equal(normalizePhone('21234567'), '+6621234567');
  assert.equal(normalizePhone('053123456'), '+6653123456');
  assert.equal(normalizePhone('53123456'), '+6653123456');
  assert.equal(isValidPhone('021234567'), true);
  assert.equal(isValidPhone('21234567'), true);
});

test('D120: International phone numbers (E.164)', () => {
  assert.equal(normalizePhone('+14155552671'), '+14155552671');
  assert.equal(normalizePhone('+819012345678'), '+819012345678');
  assert.equal(normalizePhone('+442079460919'), '+442079460919');
  assert.equal(isValidPhone('+14155552671'), true);
  assert.equal(isValidPhone('+819012345678'), true);
});

test('D120: Invalid phone numbers are rejected', () => {
  for (const bad of ['', '123', 'abc', '123456789a', '๐๑๒๓๔๕๖๗๘๙', '+999999999999999999']) {
    assert.equal(normalizePhone(bad), null, `expected ${bad} to be null`);
    assert.equal(isValidPhone(bad), false, `expected ${bad} to be invalid`);
  }
});

test('D120: Friendly display formatting', () => {
  assert.equal(formatDisplayPhone('+66812345678'), '081-234-5678');
  assert.equal(formatDisplayPhone('+6621234567'), '02-123-4567');
  assert.equal(formatDisplayPhone('+819012345678'), '+81 90 1234 5678');
});

test('D120: Outbound customerPhone for FileMaker & POS compatibility', () => {
  // Thai numbers: convert back to local 0xxxxxxxx or 02xxxxxxx
  assert.equal(toOutboundCustomerPhone('+66812345678'), '0812345678');
  assert.equal(toOutboundCustomerPhone('+6621234567'), '021234567');
  // Foreign numbers: retain E.164
  assert.equal(toOutboundCustomerPhone('+819012345678'), '+819012345678');
  assert.equal(toOutboundCustomerPhone('+14155552671'), '+14155552671');
  assert.equal(toOutboundCustomerPhone(null), null);
});

test('D121: orderView carries vatRefund and taxInvoice flags', () => {
  const v1 = orderView(
    {
      reference: 'SES-TAX-1',
      queueLetter: 'A',
      queueNo: 1,
      state: 'SENT_TO_CASHIER',
      phone: null,
      staffId: 's',
      productSelectionConfirmedAt: null,
      items: [],
      accessories: [],
      payments: [],
      ontop: [],
      points: [],
      burnPoints: [],
      posBillNo: null,
      vatRefund: true,
      taxInvoice: false,
    },
    new Map(),
  );
  assert.equal(v1.vatRefund, true);
  assert.equal(v1.taxInvoice, false);

  const v2 = orderView(
    {
      reference: 'SES-TAX-2',
      queueLetter: 'A',
      queueNo: 2,
      state: 'SENT_TO_CASHIER',
      phone: null,
      staffId: 's',
      productSelectionConfirmedAt: null,
      items: [],
      accessories: [],
      payments: [],
      ontop: [],
      points: [],
      burnPoints: [],
      posBillNo: null,
      vatRefund: false,
      taxInvoice: true,
    },
    new Map(),
  );
  assert.equal(v2.vatRefund, false);
  assert.equal(v2.taxInvoice, true);

  const v3 = orderView(
    {
      reference: 'SES-TAX-3',
      queueLetter: 'A',
      queueNo: 3,
      state: 'SENT_TO_CASHIER',
      phone: null,
      staffId: 's',
      productSelectionConfirmedAt: null,
      items: [],
      accessories: [],
      payments: [],
      ontop: [],
      points: [],
      burnPoints: [],
      posBillNo: null,
    },
    new Map(),
  );
  assert.equal(v3.vatRefund, false);
  assert.equal(v3.taxInvoice, false);
});
