import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cleanup, seedCatalog, seedWorld, startApi } from './support.mjs';

const POS_KEY = 'test-pos-key-0123456789abcdef0123456789abcdef';
process.env.POS_API_KEY = POS_KEY;

test('STOCK scans the serial number of every unit when it sends the goods to the cashier (D92)', async (t) => {
  const ctx = await startApi(t);
  if (!ctx) return;
  const { db, request } = ctx;
  let world;
  try {
    world = await seedWorld(ctx);
    const { cookies, branches, prefix } = world;
    const [skuA, skuB] = await seedCatalog(ctx, world, 2, 20);
    await db.productSku.update({ where: { id: skuA.id }, data: { upc: '194253000001' } });
    const base = await ctx.app.getUrl();
    const app = (path, method, body, who) => request(path, method, body, cookies[who]);
    let phoneNo = 800;
    const snOf = (n) => `${prefix.replace(/[^A-Za-z0-9]/g, '').toUpperCase()}${n}`;

    /** A session taken to FOUND: A x2 and B x1 (so 3 units), plus an accessory. */
    const toFound = async () => {
      const created = await app('/sessions', 'POST', { phone: `09999008${String(phoneNo++).slice(-2)}` }, 'staff');
      const id = created.data.id;
      await app(`/sessions/${id}/selection`, 'PUT', {
        items: [{ skuId: skuA.id, quantity: 2 }, { skuId: skuB.id, quantity: 1 }],
        accessories: [{ accessoryName: 'Case', quantity: 1 }],
        payments: ['Cash'],
        ontop: [],
        points: [],
      }, 'staff');
      await app(`/sessions/${id}/confirm`, 'POST', undefined, 'staff');
      for (const action of ['search', 'found']) {
        const res = await app(`/sessions/${id}/step`, 'POST', { action }, 'stock');
        assert.equal(res.status, 201, `${action}: ${JSON.stringify(res.data)}`);
      }
      return (await app(`/sessions/${id}`, 'GET', undefined, 'staff')).data;
    };
    const send = (s, serials, who = 'stock') => app(`/sessions/${s.id}/step`, 'POST', { action: 'send', serials }, who);
    const itemOf = (s, sku) => s.items.find((i) => i.skuId === sku.id);
    const full = (s, n0) => [
      { itemId: itemOf(s, skuA).id, sn: [snOf(n0), snOf(n0 + 1)] },
      { itemId: itemOf(s, skuB).id, sn: [snOf(n0 + 2)] },
    ];
    const stored = (s) => db.sessionItemSerial.count({ where: { item: { sessionId: s.id } } });
    const stateOf = async (s) => (await app(`/sessions/${s.id}`, 'GET', undefined, 'staff')).data.state;

    await t.test('without every serial number the goods do not leave stock, and nothing is saved', async () => {
      const s = await toFound();
      const a = itemOf(s, skuA).id;
      const b = itemOf(s, skuB).id;
      const bad = {
        'none at all': [],
        'one product missing': [{ itemId: a, sn: [snOf(1), snOf(2)] }],
        'too few for A (needs 2)': [{ itemId: a, sn: [snOf(1)] }, { itemId: b, sn: [snOf(3)] }],
        'too many for B (needs 1)': [{ itemId: a, sn: [snOf(1), snOf(2)] }, { itemId: b, sn: [snOf(3), snOf(4)] }],
        'an empty serial': [{ itemId: a, sn: [snOf(1), '   '] }, { itemId: b, sn: [snOf(3)] }],
        'a space inside': [{ itemId: a, sn: [snOf(1), 'AB CD'] }, { itemId: b, sn: [snOf(3)] }],
        'a Thai character': [{ itemId: a, sn: [snOf(1), 'ซีเรียล'] }, { itemId: b, sn: [snOf(3)] }],
        'longer than 64': [{ itemId: a, sn: [snOf(1), 'X'.repeat(65)] }, { itemId: b, sn: [snOf(3)] }],
        'the same serial twice for A': [{ itemId: a, sn: [snOf(1), snOf(1)] }, { itemId: b, sn: [snOf(3)] }],
        'the same serial for A and B, other case': [{ itemId: a, sn: [snOf(1), snOf(2)] }, { itemId: b, sn: [snOf(1).toLowerCase()] }],
        'an unknown item': [{ itemId: a, sn: [snOf(1), snOf(2)] }, { itemId: b, sn: [snOf(3)] }, { itemId: 'nope', sn: [snOf(4)] }],
        'the same item twice': [{ itemId: a, sn: [snOf(1), snOf(2)] }, { itemId: a, sn: [snOf(1), snOf(2)] }, { itemId: b, sn: [snOf(3)] }],
      };
      for (const [why, serials] of Object.entries(bad)) {
        const res = await send(s, serials);
        assert.equal(res.status, 400, `${why}: ${JSON.stringify(res.data)}`);
        assert.equal(await stateOf(s), 'FOUND', `${why}: still at stock`);
        assert.equal(await stored(s), 0, `${why}: nothing saved`);
      }
      assert.equal((await app(`/sessions/${s.id}/step`, 'POST', { action: 'send', serials: [{ itemId: a, sn: [snOf(1), snOf(2)], extra: 1 }] }, 'stock')).status, 400, 'unknown fields are refused');
      const named = await send(s, [{ itemId: a, sn: [snOf(1)] }, { itemId: b, sn: [snOf(3)] }]);
      assert.match(JSON.stringify(named.data), /ต้องสแกน 2 เครื่อง แต่ได้ 1/, 'the message says which product and how many');
    });

    let first;
    await t.test('with all of them the order goes to the cashier; they are saved in the order scanned and trimmed', async () => {
      first = await toFound();
      for (const who of ['staff', 'manager']) assert.equal((await send(first, full(first, 10), who)).status, 403, who);
      assert.equal(await stored(first), 0);
      const serials = full(first, 10);
      serials[0].sn[0] = `  ${serials[0].sn[0].toLowerCase()}\n`; // a scanner often adds a line break; typed in lower case
      const res = await send(first, serials);
      assert.equal(res.status, 201, JSON.stringify(res.data));
      assert.equal(res.data.state, 'SENT_TO_CASHIER');
      assert.equal(await stored(first), 3);
      const detail = (await app(`/sessions/${first.id}`, 'GET', undefined, 'staff')).data;
      assert.deepEqual(itemOf(detail, skuA).serials.map((x) => x.sn), [snOf(10), snOf(11)], 'in the order scanned, trimmed, in capitals like FileMaker (D95)');
      assert.deepEqual(itemOf(detail, skuB).serials.map((x) => x.sn), [snOf(12)]);
    });

    await t.test('the U POS door and the FileMaker message carry them with the UPC (one view for both)', async () => {
      const res = await fetch(`${base}/api/integrations/pos/orders?branch=${branches.a.code}`, { headers: { Authorization: `Bearer ${POS_KEY}` } });
      const order = (await res.json()).orders.find((o) => o.reference === first.reference);
      const a = order.items.find((i) => i.partNo === skuA.sku);
      const b = order.items.find((i) => i.partNo === skuB.sku);
      assert.deepEqual(a.sn, [snOf(10), snOf(11)]);
      assert.equal(a.upc, '194253000001');
      assert.deepEqual(b.sn, [snOf(12)]);
      assert.equal(b.upc, null, 'a part with no UPC says null');
      assert.equal(a.quantity, a.sn.length, 'one serial per unit, the number the FileMaker script checks');
    });

    await t.test('a serial that is in another order that is still open is refused, naming that order; once that one is over it is free', async () => {
      const other = await toFound();
      const clash = full(other, 20);
      clash[1].sn[0] = snOf(12).toLowerCase(); // the unit first holds, typed in lower case
      const res = await send(other, clash);
      assert.equal(res.status, 409, JSON.stringify(res.data));
      assert.match(res.data.message, new RegExp(`${snOf(12)}.*${String(first.queueNo).padStart(3, '0')}`, 'i'), 'D110: the queue without a letter');
      assert.equal(await stateOf(other), 'FOUND');
      assert.equal(await stored(other), 0, 'nothing saved by a refused send');

      // cancelling the order that holds the unit frees it for the other one
      const cancelled = await app(`/sessions/${first.id}/cancel`, 'POST', { reason: 'ลูกค้าเปลี่ยนใจ' }, 'staff');
      assert.equal(cancelled.status, 201, JSON.stringify(cancelled.data));
      const again = await send(other, clash);
      assert.equal(again.status, 201, `a cancelled order frees its units: ${JSON.stringify(again.data)}`);
    });

    await t.test('when the cashier sends the order back to stock the scanned serials are cleared; stock scans again', async () => {
      const s = await toFound();
      assert.equal((await send(s, full(s, 30))).status, 201);
      assert.equal(await stored(s), 3);
      const back = await app(`/sessions/${s.id}/cashier/reject`, 'POST', { reason: 'หยิบสินค้าผิด' }, 'staff');
      assert.equal(back.status, 201, JSON.stringify(back.data));
      assert.equal(await stored(s), 0, 'the units went back to the shelf, so their serials no longer stand');
      for (const action of ['found']) assert.equal((await app(`/sessions/${s.id}/step`, 'POST', { action }, 'stock')).status, 201);
      const refused = await send(s, []);
      assert.equal(refused.status, 400, 'the scan has to be done again');
      const detail = (await app(`/sessions/${s.id}`, 'GET', undefined, 'staff')).data;
      assert.equal((await send(detail, full(detail, 40))).status, 201);
      assert.deepEqual(itemOf((await app(`/sessions/${s.id}`, 'GET', undefined, 'staff')).data, skuB).serials.map((x) => x.sn), [snOf(42)]);
    });

    await t.test('a session that is bought again, or deleted, keeps no stale serials (they belong to the item)', async () => {
      const s = await toFound();
      assert.equal((await send(s, full(s, 50))).status, 201);
      await db.customerSession.delete({ where: { id: s.id } });
      assert.equal(await db.sessionItemSerial.count({ where: { sn: { in: [snOf(50), snOf(51), snOf(52)] } } }), 0, 'removed with the session');
    });
  } finally {
    await cleanup(ctx, world);
  }
});
