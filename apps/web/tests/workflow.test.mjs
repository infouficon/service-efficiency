import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  advance,
  confirmSelection,
  toggleOption,
  reasonIsValid,
  phoneIsValid,
  quantityIsValid,
  toggleAccessory,
} from '../src/features/session/workflow.ts';
const fixture = () => ({
  reference: 'fixture',
  phone: '1234567890',
  staffId: 'mock',
  state: 'WALK_IN',
  confirmed: false,
  timestamps: {},
  selection: {
    product: { id: 'mock' },
    accessories: {},
    ontop: [],
    points: [],
    burnPoints: [],
    payments: [],
  },
});
test('purchase path requires confirmation and separate cashier completion', () => {
  let s = fixture();
  for (const action of ['startDemo', 'endDemo', 'buy', 'startSelection'])
    s = advance(s, action, action);
  assert.equal(advance(s, 'requestStock', 'blocked'), s);
  s = confirmSelection(s, 'confirmed');
  assert.equal(s.state, 'STOCK_REQUESTED');
  assert.equal(s.timestamps.product_selection_confirmed_at, 'confirmed');
  for (const action of [
    'search',
    'found',
    'send',
    'receive',
    'scan',
    'bill',
  ])
    s = advance(s, action, action);
  assert.equal(s.state, 'BILL_OPENED');
  assert.equal(s.timestamps.bill_opened_at, 'bill');
  s = advance(s, 'complete', 'done');
  assert.equal(s.state, 'COMPLETED');
  assert.equal(advance(s, 'receive', 'again'), s);
});
test('out-of-order and repeated clicks cannot overwrite milestone time', () => {
  const s = fixture();
  assert.equal(advance(s, 'bill', 'bad'), s);
  const started = advance(s, 'startDemo', 'first');
  assert.equal(advance(started, 'startDemo', 'second'), started);
});
test('terminal UI outcomes prevent workflow continuation', () => {
  for (const outcome of ['NOT_BUY', 'OUT_OF_STOCK', 'CUSTOMER_CANCELLED']) {
    const s = { ...fixture(), outcome };
    assert.equal(advance(s, 'startDemo', 'bad'), s);
  }
});
test('None never becomes a selected option', () => {
  assert.deepEqual(toggleOption(['AIS'], 'None'), []);
  assert.deepEqual(toggleOption(['None'], 'AIS'), ['AIS']);
  assert.deepEqual(toggleOption(['AIS'], 'AIS'), []);
});
test('other reason requires non-whitespace text', () => {
  assert.equal(reasonIsValid('อื่น ๆ', '  '), false);
  assert.equal(reasonIsValid('อื่น ๆ', 'ข้อความ'), true);
  assert.equal(reasonIsValid('', 'ข้อความ'), false);
});
test('confirmation cannot be repeated or applied after terminal outcome', () => {
  const s = { ...fixture(), state: 'PRODUCT_SELECTION' };
  const confirmed = confirmSelection(s, 'first');
  assert.equal(confirmSelection(confirmed, 'second'), confirmed);
  const cancelled = { ...s, outcome: 'CUSTOMER_CANCELLED' };
  assert.equal(confirmSelection(cancelled, 'bad'), cancelled);
});

test('phone accepts exactly ten ASCII digits without a prefix rule', () => {
  for (const phone of ['0123456789', '1234567890', '9999999999'])
    assert.equal(phoneIsValid(phone), true);
  for (const phone of [
    '',
    '123456789',
    '12345678901',
    '123-456789',
    '123456789a',
    ' 1234567890',
    '๐๑๒๓๔๕๖๗๘๙',
  ])
    assert.equal(phoneIsValid(phone), false);
});
test('accessory quantity is a positive integer and resets on deselection', () => {
  for (const quantity of ['1', '2', '100'])
    assert.equal(quantityIsValid(quantity), true);
  for (const quantity of ['', '0', '-1', '1.5', '1e2', 'abc'])
    assert.equal(quantityIsValid(quantity), false);
  const selected = toggleAccessory({}, 'Case');
  assert.equal(selected.Case, '1');
  const removed = toggleAccessory({ Case: '4' }, 'Case');
  assert.deepEqual(removed, {});
  assert.equal(toggleAccessory(removed, 'Case').Case, '1');
});
test('confirmation rejects invalid phone or accessory quantity', () => {
  for (const phone of ['', '123']) {
    const s = { ...fixture(), state: 'PRODUCT_SELECTION', phone };
    assert.equal(confirmSelection(s, 'bad'), s);
  }
  for (const quantity of ['', '0', '-1', '1.5']) {
    const s = { ...fixture(), state: 'PRODUCT_SELECTION' };
    s.selection.accessories = { Case: quantity };
    assert.equal(confirmSelection(s, 'bad'), s);
  }
});

test('partialFulfillStock removes missing accessories or main product and advances to FOUND', async () => {
  const { partialFulfillStock } = await import('../src/features/session/workflow.ts');
  const s = {
    ...fixture(),
    state: 'SEARCHING',
    selection: {
      product: { id: 'p-1', product: 'iPhone', model: '16 Pro', sku: 'SKU1' },
      accessories: { Case: '1', Pencil: '2' },
      ontop: [],
      points: [],
      burnPoints: [],
      payments: [],
    },
  };
  const updated = partialFulfillStock(s, ['Case'], 'time-1');
  assert.equal(updated.state, 'FOUND');
  assert.equal(updated.timestamps.stock_found_at, 'time-1');
  assert.deepEqual(updated.selection.accessories, { Pencil: '2' });
  assert.notEqual(updated.selection.product, null);

  const noMain = partialFulfillStock(s, ['MAIN_PRODUCT'], 'time-2');
  assert.equal(noMain.state, 'FOUND');
  assert.equal(noMain.selection.product, null);
  assert.deepEqual(noMain.selection.accessories, { Case: '1', Pencil: '2' });
});
