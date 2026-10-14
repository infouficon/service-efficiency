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
  visitDuration,
  cashierRejectNotice,
  addItem,
  stepItem,
  itemName,
  itemLabel,
  itemsText,
  getSessionMissingDescription,
  progressIndex,
  removeDamagedItems,
} from '../src/features/session/workflow.ts';
import { qrCode } from '../src/utils/qr.ts';
const fixture = () => ({
  reference: 'fixture',
  phone: '1234567890',
  staffId: 'mock',
  state: 'WALK_IN',
  confirmed: false,
  timestamps: {},
  selection: {
    items: [{ product: { id: 'mock' }, quantity: 1 }],
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
      items: [{ product: { id: 'p-1', product: 'iPhone', model: '16 Pro', sku: 'SKU1' }, quantity: 1 }],
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
  assert.equal(updated.selection.items.length, 1);

  const noMain = partialFulfillStock(s, ['MAIN_PRODUCT'], 'time-2');
  assert.equal(noMain.state, 'FOUND');
  assert.deepEqual(noMain.selection.items, []);
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

test('step durations come from the events, add up when a step happens twice, and are empty when it did not happen (F14, F13)', () => {
  const at = (m, sec = 0) => new Date(Date.UTC(2026, 9, 13, 3, m, sec)).toISOString();
  const ev = (eventType, time, metadata = null) => ({ eventType, createdAt: time, metadata });
  const complete = {
    ...fixture(),
    state: 'COMPLETED',
    events: [
      ev('SESSION_CREATED', at(0)),
      ev('PRODUCT_SELECTION_STARTED', at(0)),
      ev('PRODUCT_SELECTION_CONFIRMED', at(6)),
      ev('STOCK_SEARCHING', at(7)),
      ev('STOCK_FOUND', at(11, 30)),
      ev('STOCK_SENT_TO_CASHIER', at(12)),
      ev('CASHIER_RECEIVED', at(14)),
      ev('CASHIER_SCANNED', at(15)),
      ev('BILL_OPENED', at(17)),
      ev('COMPLETED', at(22, 5)),
    ],
  };
  const by = (session) => Object.fromEntries(stepDurations(session).map((d) => [d.key, d.ms]));
  const d = by(complete);
  assert.equal(d.selection, 6 * 60_000);
  assert.equal(d.stock_search, (4 * 60 + 30) * 1000);
  assert.equal(d.stock_send, 30_000);
  assert.equal(d.wait_cashier, 2 * 60_000);
  assert.equal(d.cashier_scan, 60_000);
  assert.equal(d.cashier_bill, 2 * 60_000);
  assert.equal(d.cashier_complete, (5 * 60 + 5) * 1000);
  assert.equal(d.total, (22 * 60 + 5) * 1000);
  assert.equal(formatDuration(d.total), '0:22:05');
  assert.equal(formatDuration(3_725_000), '1:02:05');
  assert.equal(formatDuration(null), '');

  // F13: the cashier sends the order back after receiving it; stock searches again, the steps add up
  const rejected = {
    ...complete,
    events: [
      ev('SESSION_CREATED', at(0)),
      ev('PRODUCT_SELECTION_CONFIRMED', at(1)),
      ev('STOCK_SEARCHING', at(2)),
      ev('STOCK_FOUND', at(4)),
      ev('STOCK_SENT_TO_CASHIER', at(5)),
      ev('CASHIER_RECEIVED', at(6)),
      ev('CASHIER_REJECTED', at(8), { reason: 'หยิบสินค้าผิด', fromState: 'CASHIER_RECEIVED' }),
      ev('STOCK_FOUND', at(11)),
      ev('STOCK_SENT_TO_CASHIER', at(12)),
      ev('CASHIER_RECEIVED', at(13)),
      ev('CASHIER_SCANNED', at(14)),
      ev('BILL_OPENED', at(15)),
      ev('COMPLETED', at(16)),
    ],
  };
  const r = by(rejected);
  assert.equal(r.stock_search, (2 + 3) * 60_000, 'first search + the search after the reject');
  assert.equal(r.stock_send, 2 * 60_000, 'found to sent, twice');
  assert.equal(r.wait_cashier, 2 * 60_000, 'sent to received, twice');
  assert.equal(r.cashier_scan, (2 + 1) * 60_000, 'received to rejected + received to scanned');
  assert.equal(r.total, 16 * 60_000);

  // the customer changes the items after a stock review: selection counts twice
  const changed = {
    ...fixture(),
    events: [
      ev('SESSION_CREATED', at(0)),
      ev('PRODUCT_SELECTION_STARTED', at(1)),
      ev('PRODUCT_SELECTION_CONFIRMED', at(3)),
      ev('STOCK_SEARCHING', at(4)),
      ev('STOCK_REPORTED_MISSING', at(5)),
      ev('STAFF_RESOLVED_STOCK_REVIEW', at(7), { action: 'CHANGE_ITEMS' }),
      ev('PRODUCT_SELECTION_CONFIRMED', at(9)),
    ],
  };
  const c = by(changed);
  assert.equal(c.selection, (3 + 2) * 60_000);
  assert.equal(c.stock_search, 3 * 60_000, 'the wait for the customer after the report counts as searching');
  assert.equal(c.total, null, 'still running');

  // cancelled during selection: only the steps that happened; the total ends at the cancel
  const cancelled = {
    ...fixture(),
    outcome: 'CUSTOMER_CANCELLED',
    events: [ev('SESSION_CREATED', at(0)), ev('CUSTOMER_CANCELLED', at(4))],
  };
  const x = by(cancelled);
  assert.equal(x.selection, 4 * 60_000);
  assert.equal(x.total, 4 * 60_000);

  // NOT_BUY ends at the decision
  const notBuy = {
    ...fixture(),
    outcome: 'NOT_BUY',
    events: [ev('SESSION_CREATED', at(0)), ev('DECISION_MADE', at(7), { outcome: 'NOT_BUY' })],
  };
  assert.equal(by(notBuy).total, 7 * 60_000);

  // a session opened by "buy again" starts at product selection
  const rebuy = {
    ...fixture(),
    events: [
      ev('SESSION_CREATED', at(0), { rebuyOf: 'SES-1' }),
      ev('PRODUCT_SELECTION_STARTED', at(0, 1)),
      ev('PRODUCT_SELECTION_CONFIRMED', at(3)),
    ],
  };
  assert.equal(by(rebuy).selection, 3 * 60_000);
});

test('a visit that was bought again is timed from its first walk-in to the end of its last session (F11)', () => {
  const at = (m) => new Date(Date.UTC(2026, 9, 13, 3, m)).toISOString();
  const ev = (eventType, time) => ({ eventType, createdAt: time, metadata: null });
  const first = { ...fixture(), reference: 'R1', outcome: 'CUSTOMER_CANCELLED', rebuiltAs: { id: 'b', reference: 'R2' }, events: [ev('SESSION_CREATED', at(0)), ev('CUSTOMER_CANCELLED', at(10))] };
  const second = { ...fixture(), reference: 'R2', state: 'COMPLETED', rebuyOf: { id: 'a', reference: 'R1' }, events: [ev('SESSION_CREATED', at(10)), ev('COMPLETED', at(25))] };
  const alone = { ...fixture(), reference: 'R3', state: 'COMPLETED', events: [ev('SESSION_CREATED', at(0)), ev('COMPLETED', at(5))] };
  const all = [first, second, alone];
  assert.equal(visitDuration(first, all), 25 * 60_000);
  assert.equal(visitDuration(second, all), 25 * 60_000, 'from either end of the chain');
  assert.equal(visitDuration(alone, all), 5 * 60_000);
  const running = { ...fixture(), reference: 'R4', events: [ev('SESSION_CREATED', at(0))] };
  assert.equal(visitDuration(running, [running]), null);
});

test('stock sees why the cashier sent an order back until it finds the goods again (F13)', () => {
  const at = (m) => new Date(Date.UTC(2026, 9, 13, 3, m)).toISOString();
  const session = {
    ...fixture(),
    state: 'SEARCHING',
    events: [
      { eventType: 'STOCK_FOUND', createdAt: at(1), metadata: null },
      { eventType: 'CASHIER_REJECTED', createdAt: at(3), metadata: { reason: 'หยิบสินค้าผิด', otherReason: null } },
    ],
  };
  assert.deepEqual(cashierRejectNotice(session), { reason: 'หยิบสินค้าผิด', at: at(3) });
  assert.equal(cashierRejectNotice({ ...session, state: 'FOUND' }), undefined);
  assert.equal(
    cashierRejectNotice({ ...session, events: [...session.events, { eventType: 'STOCK_FOUND', createdAt: at(5), metadata: null }] }),
    undefined,
    'found again: the notice is over',
  );
  assert.equal(cashierRejectNotice({ ...fixture(), state: 'SEARCHING', events: [] }), undefined);

  const sessionWithWrong = {
    ...fixture(),
    state: 'SEARCHING',
    events: [
      { eventType: 'STOCK_FOUND', createdAt: at(1), metadata: null },
      {
        eventType: 'CASHIER_REJECTED',
        createdAt: at(3),
        metadata: {
          reason: 'หยิบสินค้าผิด',
          otherReason: null,
          wrongItems: ['iPhone 16 Pro 128GB (x1) (หยิบสินค้าผิด)'],
          wrongItemIds: ['item-1'],
          wrongItemDetails: {
            'item-1': { reason: 'หยิบสินค้าผิด' },
          },
        },
      },
    ],
  };
  assert.deepEqual(cashierRejectNotice(sessionWithWrong), {
    reason: 'หยิบสินค้าผิด',
    at: at(3),
    wrongItems: ['iPhone 16 Pro 128GB (x1) (หยิบสินค้าผิด)'],
    wrongItemIds: ['item-1'],
    wrongItemDetails: {
      'item-1': { reason: 'หยิบสินค้าผิด' },
    },
  });
});
test('main products (F3): picking adds or raises, + / − step, below 1 removes', () => {
  const a = { id: 'sku-a', category: 'iPhone', product: 'iPhone 16', model: 'iPhone 16 128GB Black', sku: 'A' };
  const b = { id: 'sku-b', category: 'iPad', product: 'iPad Air', model: '', sku: 'B' };
  let items = addItem([], a);
  assert.deepEqual(items, [{ product: a, quantity: 1 }]);
  items = addItem(items, b);
  assert.equal(items.length, 2);
  items = addItem(items, a);
  assert.equal(items[0].quantity, 2, 'the same product again raises its quantity');
  assert.equal(items.length, 2);
  items = stepItem(items, 'sku-a', 1);
  assert.equal(items[0].quantity, 3);
  items = stepItem(items, 'sku-a', -1);
  assert.equal(items[0].quantity, 2);
  assert.deepEqual(stepItem(items, 'sku-b', -1).map((i) => i.product.id), ['sku-a'], 'below 1 removes the product');
  assert.equal(stepItem(items, 'nope', 1).length, 2, 'an unknown product changes nothing');
  assert.equal(itemName(items[0]), 'iPhone 16 128GB Black');
  assert.equal(itemName(items[1]), 'iPad Air', 'no SKU name: the product name');
  assert.equal(
    itemName({ product: { id: 'x', product: 'iPhone 16', model: '128GB Black', sku: 'X' }, quantity: 1 }),
    'iPhone 16 128GB Black',
    'a SKU name without the product name gets it in front',
  );
  assert.equal(itemLabel(items[0]), 'iPhone 16 128GB Black (x2)');
  assert.equal(itemsText(items), 'iPhone 16 128GB Black ×2, iPad Air');
  assert.equal(itemsText([]), '');
});

test('confirmation needs at least one main product', () => {
  const s = { ...fixture(), state: 'PRODUCT_SELECTION' };
  s.selection = { ...s.selection, items: [] };
  assert.equal(confirmSelection(s, 'bad'), s);
});

test('the manager alert names what is missing and what the order holds (F3)', () => {
  const items = [
    { product: { id: 'a', model: 'iPhone 16 128GB', product: 'iPhone 16', sku: 'A' }, quantity: 2 },
    { product: { id: 'b', model: 'iPad Air', product: 'iPad', sku: 'B' }, quantity: 1 },
  ];
  assert.equal(
    getSessionMissingDescription({ selection: { items }, stockPendingReview: { missingItems: ['iPad Air (x1)'] } }),
    'iPad Air (x1)',
  );
  assert.equal(
    getSessionMissingDescription({ selection: { items }, stockPendingReview: { missingItems: ['Case (x1)'] } }),
    'Case (x1) (ในคำสั่งซื้อ iPhone 16 128GB ×2, iPad Air)',
  );
  assert.equal(getSessionMissingDescription({ selection: { items } }), 'iPhone 16 128GB ×2, iPad Air');
  assert.equal(getSessionMissingDescription({ selection: { items: [] } }), 'สินค้าไม่ระบุ');
});

test('the receipt QR is a real QR matrix: finder patterns in three corners, the same text gives the same code (F10)', () => {
  const a = qrCode('https://pos.example.test/register?branch=ISTUDIO-01');
  assert.ok(a.size >= 21 && (a.size - 21) % 4 === 0, `a valid QR side, got ${a.size}`);
  assert.ok(a.path.startsWith('M0 0h1v1h-1z'), 'the top-left finder pattern starts with a dark module');
  const modules = (a.path.match(/M/g) ?? []).length;
  assert.ok(modules > a.size * 3 && modules < a.size * a.size, 'dark modules are a share of the matrix');
  assert.equal(qrCode('https://pos.example.test/register?branch=ISTUDIO-01').path, a.path);
  assert.notEqual(qrCode('https://pos.example.test/register?branch=ISTUDIO-02').path, a.path);
  // Thai text is encoded as UTF-8 (three bytes a letter), so it needs a bigger matrix than the same number of ASCII letters
  assert.ok(qrCode('สวัสดีสวัสดีสวัสดี').size > qrCode('abcdefghijklmnopqr').size);
  // a longer address needs a bigger matrix
  assert.ok(qrCode(`https://pos.example.test/register?branch=${'x'.repeat(200)}`).size > a.size);
});

test('progressIndex maps to the 5 steps: phone, product, confirmation, stock, cashier (D68)', () => {
  const s = fixture();
  s.state = 'PRODUCT_SELECTION';
  assert.equal(progressIndex(s, false), 1, 'selecting product');
  assert.equal(progressIndex(s, true), 2, 'reviewing before confirmation');
  s.state = 'STOCK_REQUESTED';
  assert.equal(progressIndex(s), 3, 'stock queue');
  s.state = 'SEARCHING';
  assert.equal(progressIndex(s), 3, 'stock searching');
  s.state = 'SENT_TO_CASHIER';
  assert.equal(progressIndex(s), 4, 'cashier stage');
  s.state = 'COMPLETED';
  assert.equal(progressIndex(s), 4, 'completed');
});

test('removeDamagedItems removes damaged items and leaves remaining items (D75)', () => {
  const s = {
    ...fixture(),
    state: 'CASHIER_RECEIVED',
    selection: {
      ...fixture().selection,
      items: [
        { id: 'item-1', product: { id: 'p1', model: 'iPhone 16' }, quantity: 1 },
        { id: 'item-2', product: { id: 'p2', model: 'iPad Air' }, quantity: 1 },
      ],
      accessories: {
        'Case A': '1',
      },
    },
  };

  const updated = removeDamagedItems(s, ['item-1'], '2026-10-14T10:00:00Z');
  assert.equal(updated.outcome, undefined);
  assert.equal(updated.selection.items.length, 1);
  assert.equal(updated.selection.items[0].id, 'item-2');
  assert.equal(updated.selection.accessories['Case A'], '1');
  assert.equal(updated.events.length, 1);
  assert.equal(updated.events[0].eventType, 'CASHIER_REJECTED');
  assert.equal(updated.events[0].metadata.action, 'REMOVE_DAMAGED');
  // Cashier reject notice should ignore REMOVE_DAMAGED even if state were SEARCHING
  assert.equal(cashierRejectNotice({ ...updated, state: 'SEARCHING' }), undefined);
});

test('removeDamagedItems cancels session when all items are removed (D75)', () => {
  const s = {
    ...fixture(),
    state: 'CASHIER_RECEIVED',
    selection: {
      ...fixture().selection,
      items: [
        { id: 'item-1', product: { id: 'p1', model: 'iPhone 16' }, quantity: 1 },
      ],
      accessories: {},
    },
  };

  const updated = removeDamagedItems(s, ['item-1'], '2026-10-14T10:00:00Z', 'หน้าจอแตก');
  assert.equal(updated.outcome, 'CUSTOMER_CANCELLED');
  assert.equal(updated.reason, 'สินค้าชำรุด/มีตำหนิ');
  assert.equal(updated.otherReason, 'หน้าจอแตก');
  assert.equal(updated.timestamps.cancelled_at, '2026-10-14T10:00:00Z');
});
