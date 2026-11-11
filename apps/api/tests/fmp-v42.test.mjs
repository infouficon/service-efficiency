import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cleanup, seedCatalog, seedWorld, startApi } from './support.mjs';

const { orderView } = await import('../dist/sessions/order-view.js');
const { scriptIsBusy } = await import('../dist/fmp/fmp.service.js');

const baseOrder = {
  reference: 'SES-X',
  queueLetter: null,
  queueNo: 4,
  state: 'SENT_TO_CASHIER',
  phone: null,
  staffId: 's',
  productSelectionConfirmedAt: null,
  items: [],
  accessories: [],
  ontop: [],
  points: [],
  burnPoints: [],
  posBillNo: null,
};

test('FileMaker gets the card, the months and the receipt type staff picked (D129)', () => {
  const types = new Map([
    ['cash', 'เงินสด'],
    ['0% credit card', 'บัตรเงินผ่อน'],
    ['full credit card', 'บัตรเครดิต'],
  ]);
  const view = orderView(
    {
      ...baseOrder,
      payments: [
        { method: '0% Credit Card', cardType: ' SCB ', installmentMonths: 10 },
        { method: 'Full Credit Card', cardType: 'KBank', installmentMonths: null },
        { method: 'Cash', cardType: null, installmentMonths: null },
      ],
      receiptType: 'TAX_CORPORATE',
      vatRefund: true,
    },
    types,
  );
  assert.deepEqual(view.paymentDetails, [
    { method: '0% Credit Card', type: 'บัตรเงินผ่อน', cardType: 'SCB', installmentMonths: 10, label: '0% Credit Card (SCB 10 เดือน)' },
    { method: 'Full Credit Card', type: 'บัตรเครดิต', cardType: 'KBank', installmentMonths: null, label: 'Full Credit Card (KBank)' },
    { method: 'Cash', type: 'เงินสด', cardType: null, installmentMonths: null, label: 'Cash' },
  ]);
  // what ses v4 already reads stays exactly as it was
  assert.deepEqual(view.payments, ['0% Credit Card', 'Full Credit Card', 'Cash']);
  assert.deepEqual(view.paymentTypes, ['บัตรเงินผ่อน', 'บัตรเครดิต', 'เงินสด']);
  assert.equal(view.receiptType, 'TAX_CORPORATE');
  assert.equal(view.receiptTypeLabel, 'ใบกำกับภาษีในนามนิติบุคคล');
  assert.equal(view.taxInvoice, true);

  const old = orderView({ ...baseOrder, payments: [{ method: 'Gone' }] }, types);
  assert.deepEqual(old.paymentDetails, [{ method: 'Gone', type: 'อื่นๆ', cardType: null, installmentMonths: null, label: 'Gone' }]);
  assert.equal(old.receiptTypeLabel, null, 'an order from before D128 has no receipt type');
});

test('only IN_PROGRESS from the script is sent again; every other answer is final (D129)', () => {
  assert.equal(scriptIsBusy('{"ok":false,"code":"IN_PROGRESS","sesID":"SES-X"}'), true);
  assert.equal(scriptIsBusy('{"ok":false,"code":"BILL_CONFIRMED"}'), false);
  assert.equal(scriptIsBusy('{"ok":true,"code":"IN_PROGRESS"}'), false);
  assert.equal(scriptIsBusy('not json'), false);
  assert.equal(scriptIsBusy(null), false);
});

test('an order paid by card cannot be confirmed without the card and months ADMIN offers (D129)', async (t) => {
  const ctx = await startApi(t);
  if (!ctx) return;
  const { db, request } = ctx;
  let world;
  const made = [];
  try {
    world = await seedWorld(ctx);
    const { cookies, prefix } = world;
    const [sku] = await seedCatalog(ctx, world, 1);
    const method = async (name) => db.paymentMethod.findFirst({ where: { name } });
    const zero = await method('0% Credit Card');
    const full = await method('Full Credit Card');
    assert.ok(zero && full, 'the card payment methods are seeded');
    const card = `${prefix} Bank`;
    made.push(
      await db.paymentCardOption.create({ data: { paymentMethodId: zero.id, name: card, installmentMonths: [3, 10] } }),
      await db.paymentCardOption.create({ data: { paymentMethodId: full.id, name: card } }),
      await db.paymentCardOption.create({ data: { paymentMethodId: zero.id, name: `${card} Off`, active: false, installmentMonths: [10] } }),
    );

    let phoneNo = 10;
    const tryConfirm = async (paymentDetails) => {
      const created = await request('/sessions', 'POST', { phone: `099990129${phoneNo++ % 10}` }, cookies.staff);
      assert.equal(created.status, 201, JSON.stringify(created.data));
      const id = created.data.id;
      const put = await request(
        `/sessions/${id}/selection`,
        'PUT',
        { items: [{ skuId: sku.id, quantity: 1 }], paymentDetails, receiptType: 'SIMPLIFIED' },
        cookies.staff,
      );
      assert.equal(put.status, 200, JSON.stringify(put.data));
      return request(`/sessions/${id}/confirm`, 'POST', undefined, cookies.staff);
    };

    const noCard = await tryConfirm([{ method: 'Full Credit Card' }]);
    assert.equal(noCard.status, 400);
    assert.match(JSON.stringify(noCard.data), /card type/);
    assert.equal((await tryConfirm([{ method: '0% Credit Card', cardType: card }])).status, 400, '0% needs the months too');
    assert.equal((await tryConfirm([{ method: '0% Credit Card', cardType: card, installmentMonths: 6 }])).status, 400, 'a plan the card does not have');
    assert.equal((await tryConfirm([{ method: '0% Credit Card', cardType: `${card} Off`, installmentMonths: 10 }])).status, 400, 'a card ADMIN switched off');
    assert.equal((await tryConfirm([{ method: '0% Credit Card', cardType: 'No Such Bank', installmentMonths: 10 }])).status, 400);

    assert.equal((await tryConfirm([{ method: '0% Credit Card', cardType: card, installmentMonths: 10 }])).status, 201);
    assert.equal((await tryConfirm([{ method: 'Full Credit Card', cardType: card }, { method: 'Cash' }])).status, 201);
    assert.equal((await tryConfirm([{ method: 'Cash' }])).status, 201, 'no card payment: nothing more to pick');
  } finally {
    if (made.length) await db.paymentCardOption.deleteMany({ where: { id: { in: made.map((m) => m.id) } } });
    await cleanup(ctx, world);
    await ctx.stop();
  }
});
