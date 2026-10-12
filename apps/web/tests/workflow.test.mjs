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
  formatQueue,
  stepAccessory,
  stepDurations,
  formatDuration,
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

test('queue label: letter plus three digits, four after 999, no letter for sessions from before D57', () => {
  assert.equal(formatQueue('A', 1), 'A001');
  assert.equal(formatQueue('B', 12), 'B012');
  assert.equal(formatQueue('C', 999), 'C999');
  assert.equal(formatQueue('A', 1000), 'A1000');
  assert.equal(formatQueue(null, 7), '007');
  assert.equal(formatQueue(undefined, 123), '123');
});

test('the + / − buttons change an accessory by one and remove it below 1 (F4)', () => {
  assert.deepEqual(stepAccessory({ Case: '1' }, 'Case', 1), { Case: '2' });
  assert.deepEqual(stepAccessory({ Case: '9' }, 'Case', 1), { Case: '10' });
  assert.deepEqual(stepAccessory({ Case: '3' }, 'Case', -1), { Case: '2' });
  assert.deepEqual(stepAccessory({ Case: '1', Pencil: '2' }, 'Case', -1), { Pencil: '2' });
  assert.deepEqual(stepAccessory({ Case: '007' }, 'Case', 1), { Case: '8' });
  // a box that is empty or not a number yet counts as 0
  assert.deepEqual(stepAccessory({ Case: '' }, 'Case', 1), { Case: '1' });
  assert.deepEqual(stepAccessory({ Case: 'abc' }, 'Case', -1), {});
  // an accessory that is not selected stays unselected
  const none = { Pencil: '2' };
  assert.equal(stepAccessory(none, 'Case', 1), none);
});

test('step durations come from consecutive milestones and are empty when a step did not happen (F14)', () => {
  const at = (m, s = 0) => new Date(Date.UTC(2026, 9, 13, 3, m, s)).toISOString();
  const complete = {
    ...fixture(),
    state: 'COMPLETED',
    timestamps: {
      customer_walk_in_at: at(0),
      demo_start_at: at(2),
      demo_end_at: at(12),
      decision_at: at(13),
      product_selection_start_at: at(14),
      product_selection_confirmed_at: at(20),
      stock_started_at: at(21),
      stock_found_at: at(25, 30),
      cashier_received_at: at(28),
      cashier_scan_at: at(29),
      bill_opened_at: at(31),
    },
    events: [
      { eventType: 'STOCK_SENT_TO_CASHIER', createdAt: at(26) },
      { eventType: 'COMPLETED', createdAt: at(36, 5) },
    ],
  };
  const by = Object.fromEntries(stepDurations(complete).map((d) => [d.key, d.ms]));
  assert.equal(by.wait_demo, 2 * 60_000);
  assert.equal(by.demo, 10 * 60_000);
  assert.equal(by.stock_search, (4 * 60 + 30) * 1000);
  assert.equal(by.stock_send, 30_000, 'found to sent comes from the STOCK_SENT_TO_CASHIER event');
  assert.equal(by.wait_cashier, 2 * 60_000);
  assert.equal(by.cashier_complete, (5 * 60 + 5) * 1000, 'bill to completed comes from the COMPLETED event');
  assert.equal(by.total, (36 * 60 + 5) * 1000);
  assert.equal(formatDuration(by.total), '0:36:05');
  assert.equal(formatDuration(3_725_000), '1:02:05');
  assert.equal(formatDuration(null), '');

  // a visit cancelled during DEMO: only the steps that happened have a duration; the total ends at the cancel time
  const cancelled = {
    ...fixture(),
    outcome: 'CUSTOMER_CANCELLED',
    timestamps: {
      customer_walk_in_at: at(0),
      demo_start_at: at(1),
      cancelled_at: at(4),
    },
  };
  const c = Object.fromEntries(stepDurations(cancelled).map((d) => [d.key, d.ms]));
  assert.equal(c.wait_demo, 60_000);
  assert.equal(c.demo, null);
  assert.equal(c.total, 4 * 60_000);

  // still running: no total
  const running = { ...fixture(), timestamps: { customer_walk_in_at: at(0), demo_start_at: at(1) } };
  assert.equal(Object.fromEntries(stepDurations(running).map((d) => [d.key, d.ms])).total, null);
  // NOT_BUY ends at the decision
  const notBuy = { ...fixture(), outcome: 'NOT_BUY', timestamps: { customer_walk_in_at: at(0), decision_at: at(7) } };
  assert.equal(Object.fromEntries(stepDurations(notBuy).map((d) => [d.key, d.ms])).total, 7 * 60_000);
});
