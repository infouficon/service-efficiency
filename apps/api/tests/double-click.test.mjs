import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cleanup, seedCatalog, seedWorld, setCategory, startApi } from './support.mjs';

test('a double click or a retry applies an action once: stock moves once, one event, the other gets 409 (H-01)', async (t) => {
  const ctx = await startApi(t);
  if (!ctx) return;
  const { db, request } = ctx;
  let world;
  try {
    world = await seedWorld(ctx);
    const { cookies, branches } = world;
    const [sku] = await seedCatalog(ctx, world, 1, 10);
    await setCategory(ctx, [sku], 'Mac'); // D125: these tests use serials with letters (a Mac's)
    await request('/settings', 'PUT', { stockUnlimited: false }, cookies.admin);
    const app = (path, method, body, who) => request(path, method, body, cookies[who]);
    const stockOf = async () => (await db.branchInventory.findUnique({ where: { branchId_skuId: { branchId: branches.a.id, skuId: sku.id } } })).stock;
    const eventsOf = async (id, type) => db.sessionEvent.count({ where: { sessionId: id, eventType: type } });
    let phoneNo = 900;
    const toSearching = async () => {
      const s = await app('/sessions', 'POST', { phone: `09999009${String(phoneNo++).slice(-2)}` }, 'staff');
      const id = s.data.id;
      await app(`/sessions/${id}/selection`, 'PUT', { items: [{ skuId: sku.id, quantity: 2 }], accessories: [], payments: ['Cash'], ontop: [], points: [], receiptType: 'SIMPLIFIED' }, 'staff');
      assert.equal((await app(`/sessions/${id}/confirm`, 'POST', undefined, 'staff')).status, 201);
      assert.equal((await app(`/sessions/${id}/step`, 'POST', { action: 'search' }, 'stock')).status, 201);
      return id;
    };
    const twice = (fn) => Promise.all([fn(), fn()]);
    const statuses = (rs) => rs.map((r) => r.status).sort();

    await t.test('"found" clicked twice at once takes the units off the shelf once', async () => {
      const id = await toSearching();
      const before = await stockOf();
      const rs = await twice(() => app(`/sessions/${id}/step`, 'POST', { action: 'found' }, 'stock'));
      assert.equal(rs.filter((r) => r.status === 201).length, 1, JSON.stringify(statuses(rs)));
      assert.ok(rs.some((r) => r.status === 409 || r.status === 400), `the other is refused: ${JSON.stringify(statuses(rs))}`);
      assert.equal(await stockOf(), before - 2, 'deducted once');
      assert.equal(await eventsOf(id, 'STOCK_FOUND'), 1);
    });

    await t.test('"send" clicked twice queues one FileMaker message and saves the serials once', async () => {
      const id = await toSearching();
      await app(`/sessions/${id}/step`, 'POST', { action: 'found' }, 'stock');
      const s = (await app(`/sessions/${id}`, 'GET', undefined, 'staff')).data;
      const serials = [{ itemId: s.items[0].id, sn: [`DCX${phoneNo}000A`, `DCX${phoneNo}000B`] }];
      const rs = await twice(() => app(`/sessions/${id}/step`, 'POST', { action: 'send', serials }, 'stock'));
      assert.equal(rs.filter((r) => r.status === 201).length, 1, JSON.stringify(statuses(rs)));
      assert.equal(await eventsOf(id, 'STOCK_SENT_TO_CASHIER'), 1);
      assert.equal(await db.sessionItemSerial.count({ where: { item: { sessionId: id } } }), 2);
    });

    await t.test('a cancel clicked twice gives the units back once', async () => {
      const id = await toSearching();
      await app(`/sessions/${id}/step`, 'POST', { action: 'found' }, 'stock');
      const before = await stockOf();
      const rs = await twice(() => app(`/sessions/${id}/cancel`, 'POST', { reason: 'ลูกค้าเปลี่ยนใจ' }, 'staff'));
      assert.equal(rs.filter((r) => r.status === 201).length, 1, JSON.stringify(statuses(rs)));
      assert.equal(await stockOf(), before + 2, 'given back once');
      assert.equal(await eventsOf(id, 'CUSTOMER_CANCELLED'), 1);
    });

    await t.test('a "send back to stock" clicked twice gives the units back once', async () => {
      const id = await toSearching();
      await app(`/sessions/${id}/step`, 'POST', { action: 'found' }, 'stock');
      await app(`/sessions/${id}/step`, 'POST', { action: 'send' }, 'stock');
      const before = await stockOf();
      const rs = await twice(() => app(`/sessions/${id}/cashier/reject`, 'POST', { reason: 'หยิบสินค้าผิด' }, 'staff')); // D105: STAFF sends back
      assert.equal(rs.filter((r) => r.status === 201).length, 1, JSON.stringify(statuses(rs)));
      assert.equal(await stockOf(), before + 2, 'given back once');
      assert.equal(await eventsOf(id, 'CASHIER_REJECTED'), 1);
    });

    await t.test('the loser of a race is told plainly; a later click on a finished step is still a plain 400', async () => {
      const id = await toSearching();
      const rs = await twice(() => app(`/sessions/${id}/step`, 'POST', { action: 'found' }, 'stock'));
      const loser = rs.find((r) => r.status !== 201);
      if (loser.status === 409) assert.match(loser.data.message, /ดำเนินการไปแล้ว/);
      assert.equal((await app(`/sessions/${id}/step`, 'POST', { action: 'found' }, 'stock')).status, 400, 'a click after the fact is the old 400');
    });
  } finally {
    await cleanup(ctx, world);
  }
});
