import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cleanup, madeUpImei, seedCatalog, seedWorld, setCategory, startApi } from './support.mjs';

const POS_KEY = 'test-pos-key-0123456789abcdef0123456789abcdef';
process.env.POS_API_KEY = POS_KEY;

test('STOCK scans serials one by one while searching (server time); "send" then needs no list; the POS can close the sale (D101)', async (t) => {
  const ctx = await startApi(t);
  if (!ctx) return;
  const { db, request } = ctx;
  let world;
  try {
    world = await seedWorld(ctx);
    const { cookies, prefix } = world;
    const [skuA, skuB, skuC] = await seedCatalog(ctx, world, 3, 20);
    await setCategory(ctx, [skuA, skuB, skuC], 'Mac'); // D125: these tests use serials with letters (a Mac's)
    const base = await ctx.app.getUrl();
    const app = (path, method, body, who) => request(path, method, body, cookies[who]);
    const tag = prefix.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
    let n = 0;
    const sn = () => `${tag}S${++n}`;
    let phoneNo = 950;
    const toSearching = async () => {
      const s = await app('/sessions', 'POST', { phone: `09999009${String(phoneNo++).slice(-2)}` }, 'staff');
      const id = s.data.id;
      await app(`/sessions/${id}/selection`, 'PUT', { items: [{ skuId: skuA.id, quantity: 2 }, { skuId: skuB.id, quantity: 1 }], accessories: [{ accessoryName: 'Case', quantity: 1 }], payments: ['Cash'], ontop: [], points: [], receiptType: 'SIMPLIFIED' }, 'staff');
      await app(`/sessions/${id}/confirm`, 'POST', undefined, 'staff');
      return (await app(`/sessions/${id}`, 'GET', undefined, 'staff')).data;
    };
    const itemOf = (s, sku) => s.items.find((i) => i.skuId === sku.id);
    const scan = (s, item, value, who = 'stock') => app(`/sessions/${s.id}/serials`, 'POST', { itemId: item.id, sn: value }, who);
    const step = (s, action, body = {}, who = 'stock') => app(`/sessions/${s.id}/step`, 'POST', { action, ...body }, who);

    await t.test('a scan is saved at once with the server time, in capitals; only STOCK, only while searching or found', async () => {
      const s = await toSearching();
      const a = itemOf(s, skuA);
      assert.equal((await scan(s, a, sn())).status, 400, 'not before the search started (STOCK_REQUESTED)');
      assert.equal((await step(s, 'search')).status, 201);
      for (const who of ['staff', 'manager']) assert.equal((await scan(s, a, sn(), who)).status, 403, who);
      const before = Date.now();
      const first = sn();
      const res = await scan(s, a, `  ${first.toLowerCase()} `);
      assert.equal(res.status, 201, JSON.stringify(res.data));
      const saved = itemOf(res.data, skuA).serials;
      assert.deepEqual(saved.map((x) => x.sn), [first], 'trimmed, in capitals');
      const at = new Date(saved[0].createdAt).getTime();
      assert.ok(at >= before - 2000 && at <= Date.now() + 2000, 'the server stamped it');
      assert.equal(res.data.state, 'SEARCHING', 'one unit is not "found" yet');
    });

    await t.test('refused: a repeat in the order, more than the quantity, a unit held by another open order, an unknown item, a bad serial', async () => {
      const s = await toSearching();
      await step(s, 'search');
      const a = itemOf(s, skuA);
      const b = itemOf(s, skuB);
      const x = sn();
      assert.equal((await scan(s, a, x)).status, 201);
      assert.equal((await scan(s, b, x.toLowerCase())).status, 400, 'the same unit twice in one order');
      assert.equal((await scan(s, a, sn())).status, 201);
      assert.equal((await scan(s, a, sn())).status, 400, 'A needs 2: a third is refused');
      assert.equal((await scan(s, { id: 'nope' }, sn())).status, 400);
      for (const bad of ['', '   ', 'AB CD', 'ซีเรียล', 'X'.repeat(65)]) assert.equal((await scan(s, b, bad)).status, 400, JSON.stringify(bad));
      // D125: a Mac carries a serial starting with a letter: an IMEI (digits) is refused, on a scan and on a send with a list
      const imeiOnMac = await scan(s, b, '355713696420008');
      assert.equal(imeiOnMac.status, 400);
      assert.match(imeiOnMac.data.message, /Serial No\. ขึ้นต้นด้วยตัวอักษร/);
      const sent = await step(s, 'send', { serials: [{ itemId: a.id, sn: [x, '355713696420008'] }, { itemId: b.id, sn: [sn()] }] });
      assert.equal(sent.status, 400, 'a send with a list is checked the same way');
      const other = await toSearching();
      await step(other, 'search');
      const clash = await scan(other, itemOf(other, skuA), x);
      assert.equal(clash.status, 409, 'held by an order that is still open');
      assert.match(clash.data.message, /ยังไม่จบ/);
    });

    await t.test('a wrong scan is removed and scanned again; "send" without a list uses the saved serials and needs them complete', async () => {
      const s = await toSearching();
      await step(s, 'search');
      const a = itemOf(s, skuA);
      const b = itemOf(s, skuB);
      const wrong = (await scan(s, a, sn())).data;
      const wrongId = itemOf(wrong, skuA).serials[0].id;
      const removed = await app(`/sessions/${s.id}/serials/${wrongId}`, 'DELETE', undefined, 'stock');
      assert.equal(removed.status, 200, JSON.stringify(removed.data));
      assert.deepEqual(itemOf(removed.data, skuA).serials, []);
      assert.equal((await app(`/sessions/${s.id}/serials/${wrongId}`, 'DELETE', undefined, 'stock')).status, 404);
      const a1 = sn();
      const a2 = sn();
      await scan(s, a, a1);
      await scan(s, a, a2);
      assert.equal((await step(s, 'found')).status, 201, 'the stock screen records FOUND once every unit is scanned');
      // still open to fix after FOUND
      const b1 = sn();
      assert.equal((await scan(s, b, b1)).status, 201, 'scanning continues after FOUND');
      const incomplete = await toSearching();
      await step(incomplete, 'search');
      await scan(incomplete, itemOf(incomplete, skuA), sn());
      await step(incomplete, 'found');
      const no = await step(incomplete, 'send');
      assert.equal(no.status, 400, 'not complete');
      assert.match(JSON.stringify(no.data), /สแกน Serial Number แล้ว 1 จาก 2/);
      const sent = await step(s, 'send');
      assert.equal(sent.status, 201, JSON.stringify(sent.data));
      assert.equal(sent.data.state, 'SENT_TO_CASHIER');
      assert.deepEqual(itemOf(sent.data, skuA).serials.map((x) => x.sn), [a1, a2]);
      assert.deepEqual(itemOf(sent.data, skuB).serials.map((x) => x.sn), [b1]);
      assert.equal((await scan(s, b, sn())).status, 400, 'no scanning once the goods left stock');
      const row = await db.fmpOutbox.findFirst({ where: { reference: s.reference } });
      if (row) assert.deepEqual(JSON.parse(row.payload).items.flatMap((i) => i.sn).sort(), [a1, a2, b1].sort(), 'FileMaker gets the scanned serials');
    });

    await t.test('a swapped product loses the serials scanned for the old one; the other product keeps its own (D101)', async () => {
      const s = await toSearching();
      await step(s, 'search');
      await scan(s, itemOf(s, skuA), sn());
      await scan(s, itemOf(s, skuB), sn());
      const changed = await app(`/sessions/${s.id}/change-item`, 'POST', { oldItemId: itemOf(s, skuB).id, newSkuId: skuC.id, reason: 'ลูกค้าเปลี่ยนใจ' }, 'staff');
      assert.equal(changed.status, 201, JSON.stringify(changed.data));
      assert.deepEqual(itemOf(changed.data, skuC).serials, [], 'the unit of the old SKU is not the new product');
      assert.equal(itemOf(changed.data, skuA).serials.length, 1);
    });

    await t.test('every unit needs its serial; "scan later" is gone; sent straight from SEARCHING, FOUND is the last scan (D111)', async () => {
      const s = await toSearching();
      await step(s, 'search');
      await scan(s, itemOf(s, skuA), sn());
      assert.equal((await step(s, 'send')).status, 400, 'an incomplete set is refused');
      const later = await step(s, 'send', { serialsLater: true });
      assert.equal(later.status, 400, 'an old screen asking to send with serials missing is refused');
      assert.match(later.data.message, /ครบทุกเครื่อง/);
      assert.equal((await step(s, 'search', { serialsLater: true })).status, 400);
      assert.equal((await db.customerSession.findUnique({ where: { id: s.id } })).state, 'SEARCHING', 'nothing moved');
      // complete serials: one tap sends from SEARCHING; FOUND is recorded at the moment the last unit was scanned
      await scan(s, itemOf(s, skuA), sn());
      await scan(s, itemOf(s, skuB), sn());
      const last = await db.sessionItemSerial.aggregate({ where: { item: { sessionId: s.id } }, _max: { createdAt: true } });
      const sent = await step(s, 'send');
      assert.equal(sent.status, 201, JSON.stringify(sent.data));
      assert.equal(sent.data.state, 'SENT_TO_CASHIER');
      const row = await db.customerSession.findUnique({ where: { id: s.id } });
      assert.equal(row.stockFoundAt.toISOString(), last._max.createdAt.toISOString(), 'found = the last scan, not the hand-over');
      const events = await db.sessionEvent.findMany({
        where: { sessionId: s.id, eventType: { in: ['STOCK_FOUND', 'STOCK_SENT_TO_CASHIER'] } },
        orderBy: { createdAt: 'asc' },
      });
      assert.deepEqual(events.map((e) => e.eventType), ['STOCK_FOUND', 'STOCK_SENT_TO_CASHIER']);
      assert.equal(typeof events[0].metadata.deducted, 'number', 'the shelf deduction is on the FOUND event');
      assert.equal(events[1].metadata, null);
      const door = await fetch(`${base}/api/integrations/pos/orders?branch=${encodeURIComponent(sent.data.branch.code)}`, { headers: { Authorization: `Bearer ${POS_KEY}` } }).then((r) => r.json());
      const items = door.orders.find((o) => o.reference === s.reference).items;
      assert.deepEqual(items.map((i) => i.snMissing), [0, 0]);
    });

    await t.test('the POS closes the sale with its real time: bill and payment in one call or two, repeats are fine (D101)', async () => {
      const pos = (body) => fetch(`${base}/api/integrations/pos/bills`, { method: 'POST', headers: { Authorization: `Bearer ${POS_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(async (r) => ({ status: r.status, data: await r.json().catch(() => null) }));
      const atCashier = async () => {
        const s = await toSearching();
        await step(s, 'search');
        await step(s, 'found');
        await step(s, 'send');
        return (await app(`/sessions/${s.id}`, 'GET', undefined, 'staff')).data;
      };
      // times after the walk-in (an earlier bill is not plausible) and not far ahead
      const opened = new Date(Date.now() + 2_000).toISOString();
      const paid = new Date(Date.now() + 3_000).toISOString();

      const one = await atCashier();
      const r1 = await pos({ reference: one.reference, billNo: 'FM-1', openedAt: opened, completedAt: paid });
      assert.equal(r1.status, 201, JSON.stringify(r1.data));
      assert.equal(r1.data.state, 'COMPLETED');
      const done = await db.sessionEvent.findFirst({ where: { sessionId: one.id, eventType: 'COMPLETED' } });
      assert.equal(done.createdAt.toISOString(), paid, 'completed at the POS time');
      assert.equal(done.actorStaffId, 'U-POS');
      assert.equal((await pos({ reference: one.reference, billNo: 'FM-1', openedAt: opened, completedAt: paid })).status, 201, 'a repeat changes nothing');
      assert.equal(await db.sessionEvent.count({ where: { sessionId: one.id, eventType: 'COMPLETED' } }), 1);

      const two = await atCashier();
      assert.equal((await pos({ reference: two.reference, billNo: 'FM-2', openedAt: opened })).data.state, 'BILL_OPENED');
      assert.equal((await pos({ reference: two.reference, billNo: 'FM-2', openedAt: opened, completedAt: paid })).data.state, 'COMPLETED', 'payment reported later');
      assert.equal((await pos({ reference: two.reference, billNo: 'OTHER', openedAt: opened, completedAt: paid })).status, 409, 'another bill number');

      const three = await atCashier();
      assert.equal((await pos({ reference: three.reference, billNo: 'FM-3', openedAt: opened, completedAt: new Date(new Date(opened).getTime() - 1_000).toISOString() })).status, 400, 'paid before the bill opened');
      assert.equal((await pos({ reference: three.reference, billNo: 'FM-3', openedAt: opened, completedAt: new Date(Date.now() + 3_600_000).toISOString() })).status, 400, 'in the future');
      assert.equal((await pos({ reference: three.reference, billNo: 'FM-3', openedAt: opened, completedAt: 'yesterday' })).status, 400);
      assert.equal((await app(`/sessions/${three.id}`, 'GET', undefined, 'staff')).data.state, 'SENT_TO_CASHIER', 'a refused report changes nothing');
    });

    await t.test('an iPhone needs a real IMEI, a Mac a serial starting with a letter (D124, D125)', async () => {
      // an iPhone next to the Mac of this file (seedCatalog's SKU codes are taken)
      const made = await db.product.create({
        data: { category: 'iPhone', name: `${prefix} Phone 2`, models: { create: { name: `${prefix} Model 2`, skus: { create: [{ sku: `${prefix}-P1`, name: `${prefix} P1 128GB` }] } } } },
        include: { models: { include: { skus: true } } },
      });
      const phone = made.models[0].skus[0];
      await db.branchInventory.create({ data: { branchId: world.branches.a.id, skuId: phone.id, stock: 20, active: true } });
      const created = await app('/sessions', 'POST', { phone: `09999009${String(phoneNo++).slice(-2)}` }, 'staff');
      const id = created.data.id;
      await app(`/sessions/${id}/selection`, 'PUT', { items: [{ skuId: phone.id, quantity: 1 }, { skuId: skuA.id, quantity: 1 }], accessories: [], payments: ['Cash'], ontop: [], points: [], receiptType: 'SIMPLIFIED' }, 'staff');
      await app(`/sessions/${id}/confirm`, 'POST', undefined, 'staff');
      const s = (await app(`/sessions/${id}`, 'GET', undefined, 'staff')).data;
      await step(s, 'search');
      const iphone = itemOf(s, phone);
      const mac = itemOf(s, skuA);
      const refused = async (item, value, why) => {
        const res = await scan(s, item, value);
        assert.equal(res.status, 400, value);
        assert.match(res.data.message, why, value);
      };
      await refused(iphone, sn(), /ใช้ IMEI/); // a serial with letters on an iPhone
      await refused(iphone, '35571369420008', /MEID/); // 2026-11-10: the 14-digit number FileMaker could not find
      await refused(iphone, '355713696420007', /เลขตรวจ/); // one digit wrong
      await refused(iphone, '195951413723', /ไม่ใช่ IMEI/); // the UPC
      await refused(mac, '355713696420008', /Serial No\. ขึ้นต้นด้วยตัวอักษร/);
      await refused(mac, 'S12', /8-20 ตัว/);
      const imei = madeUpImei();
      assert.equal((await scan(s, iphone, imei)).status, 201, 'a real IMEI');
      assert.equal((await scan(s, mac, sn())).status, 201, 'a Mac serial');
    });
  } finally {
    await cleanup(ctx, world);
  }
});
