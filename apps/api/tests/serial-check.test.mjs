import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { after, test } from 'node:test';
import { cleanup, seedCatalog, seedWorld, setCategory, startApi } from './support.mjs';

process.env.WARROOM_SYNC_MINUTES = '0'; // no background warroom sync while this test runs
process.env.ERP_SYNC_TIMES = ''; // no scheduled ERP import against the fake below
process.env.SERIAL_CHECK_QUIET = ''; // the warroom windows are tested on their own

// A stand-in for the ERP's OData: it records every request and answers from `fmpRows` (or fails while `fail` is set).
const seen = [];
let fail = false;
let fmpRows = [];
const fake = createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  seen.push({ path: url.pathname, entity: url.pathname.split('/').pop(), filter: url.searchParams.get('$filter'), select: url.searchParams.get('$select'), top: url.searchParams.get('$top') });
  if (fail) return res.writeHead(500).end('{}');
  // `fmpRows` is either the rows or a function of the request (one answer for a serial, another for a model's units)
  const rows = typeof fmpRows === 'function' ? fmpRows(url) : fmpRows;
  res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ value: rows }));
});
await new Promise((resolve) => fake.listen(0, '127.0.0.1', resolve));
after(() => new Promise((resolve) => fake.close(resolve)));
process.env.ERP_ODATA_BASE_URL = `http://127.0.0.1:${fake.address().port}/fmi/odata/v4/ERP`;
process.env.ERP_ODATA_USER = 'reader';
process.env.ERP_ODATA_PASS = 'test-only';

const { quietWindow } = await import('../dist/warroom/serial-check.service.js');

test('FileMaker is left alone around warroom pulls: 5 minutes before to 30 after, Bangkok time (D104)', () => {
  const slots = '12:15,15:15,18:15,21:15,23:45';
  const at = (bangkok) => new Date(`2026-11-05T${bangkok}:00+07:00`);
  assert.equal(quietWindow(at('15:09'), slots), null);
  assert.equal(quietWindow(at('15:10'), slots), '15:15');
  assert.equal(quietWindow(at('15:45'), slots), '15:15');
  assert.equal(quietWindow(at('15:46'), slots), null);
  assert.equal(quietWindow(new Date('2026-11-06T00:14:00+07:00'), slots), '23:45', 'across midnight');
  assert.equal(quietWindow(new Date('2026-11-06T00:16:00+07:00'), slots), null);
  assert.equal(quietWindow(at('15:15'), ''), null);
});

test('one scanned serial: off by default (FileMaker checks at send), FileMaker live when switched to it (D104, D111)', async (t) => {
  const ctx = await startApi(t);
  if (!ctx) return;
  const { db, request } = ctx;
  let world;
  try {
    world = await seedWorld(ctx);
    const { cookies, branches, prefix } = world;
    const [sku] = await seedCatalog(ctx, world, 1, 5);
    const ask = (query, who = 'stock') => request(`/stock/serial-check?${new URLSearchParams(query)}`, 'GET', undefined, cookies[who]);
    const tag = prefix.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
    const sn = (n) => `${tag}SN${n}`;

    await t.test('only STOCK, STAFF and ADMIN; a serial is required and checked', async () => {
      assert.equal((await ask({ sn: sn(1) }, 'manager')).status, 403);
      assert.equal((await ask({})).status, 400);
      assert.equal((await ask({ sn: 'AB CD' })).status, 400);
      assert.equal((await ask({ sn: sn(1), part: "x' or 1" })).status, 400);
    });

    await t.test('off unless SERIAL_CHECK=fmp; warroom is no longer a source; FileMaker is not asked', async () => {
      delete process.env.SERIAL_CHECK;
      const res = await ask({ sn: sn(1), part: sku.sku });
      assert.equal(res.status, 200, JSON.stringify(res.data));
      assert.equal(res.data.status, 'off');
      process.env.SERIAL_CHECK = 'warroom';
      assert.equal((await ask({ sn: sn(1) })).data.status, 'off', 'the old default is now off');
      delete process.env.SERIAL_CHECK;
      assert.equal(seen.length, 0);
    });

    await t.test('FileMaker live: one serial, four columns, branch by ERP id, model by the catalog UPC; cached; a failure pauses it', async () => {
      process.env.SERIAL_CHECK = 'fmp';
      const here = 910000 + Math.floor(Math.random() * 80000);
      await db.branch.update({ where: { id: branches.a.id }, data: { erpBranchId: here } });
      await db.branch.update({ where: { id: branches.b.id }, data: { erpBranchId: here + 1 } });
      await db.productSku.update({ where: { id: sku.id }, data: { upc: '190000000001' } });
      fmpRows = [{ product_sn: sn(5), BranchStore_id: here + 1, status: 'ready', product_upc: '190000000001' }];
      const moved = (await ask({ sn: sn(5), part: sku.sku })).data;
      assert.deepEqual([moved.source, moved.target, moved.verdict, moved.branchCode], ['fmp', 'PRODUCTION', 'other-branch', branches.b.code]);
      const call = seen.at(-1);
      assert.deepEqual([call.entity, call.filter, call.select, call.top], ['ProductStore_detail', `product_sn eq '${sn(5)}'`, 'product_sn,BranchStore_id,status,product_upc', '3']);
      // D183: the real FileMaker lists a model's units only with SERIAL_CHECK_UNITS=fmp (product_upc needs its own index)
      assert.equal(moved.branchUnits, undefined, 'no units query on the real FileMaker without its own switch');
      process.env.SERIAL_CHECK_UNITS = 'fmp';
      const listedToo = (await ask({ sn: sn(5), part: sku.sku })).data;
      const units = seen.at(-1);
      assert.deepEqual([units.entity, units.filter, units.select, units.top], ['ProductStore_detail', `product_upc eq '190000000001' and BranchStore_id eq ${here} and status eq 'ready'`, 'product_sn', '201']);
      assert.equal(listedToo.model, sku.sku);
      assert.deepEqual([listedToo.branchUnits.count, listedToo.branchUnits.more, listedToo.branchUnits.units], [0, false, []], 'the scanned unit itself is never offered');
      fmpRows = [{ product_sn: sn(6), BranchStore_id: here, status: 'ready', product_upc: '199999999999' }];
      assert.equal((await ask({ sn: sn(6), part: sku.sku })).data.verdict, 'other-model', 'another barcode than the catalog has');
      const before = seen.length;
      assert.equal((await ask({ sn: sn(5) })).data.verdict, 'other-branch');
      assert.equal(seen.length, before, 'a minute of reuse');
      fail = true;
      assert.equal((await ask({ sn: sn(7) })).data.status, 'unavailable');
      assert.equal(seen.length - before, 1, 'asked once, no retry');
      fail = false;
      const paused = (await ask({ sn: sn(8) })).data;
      assert.equal(paused.status, 'unavailable');
      assert.match(paused.reason, /พักการตรวจ 10 นาที/);
      assert.equal(seen.length - before, 1, 'nothing sent while paused');
      delete process.env.SERIAL_CHECK;
      delete process.env.SERIAL_CHECK_UNITS;
    });

    await t.test('D183: while orders go to the test FileMaker, the check asks it (no SERIAL_CHECK needed) and lists the branch units', async () => {
      delete process.env.SERIAL_CHECK;
      const port = fake.address().port;
      Object.assign(process.env, { FMP_UAT_HOST: `http://127.0.0.1:${port}/`, FMP_UAT_DATABASE: 'UF UAT', FMP_UAT_USER: 'uat-reader', FMP_UAT_PASSWORD: 'test-only' });
      const prior = await db.setting.findUnique({ where: { name: 'fmpPushMode' } });
      await db.setting.upsert({ where: { name: 'fmpPushMode' }, update: { value: 'uat' }, create: { name: 'fmpPushMode', value: 'uat' } });
      try {
        const here = (await db.branch.findUnique({ where: { id: branches.a.id } })).erpBranchId;
        await setCategory(ctx, [sku], 'Mac'); // serials with letters
        // an open order of this branch already holds one of the ready units (D92)
        const app = (path, method, body, who) => request(path, method, body, cookies[who]);
        const created = await app('/sessions', 'POST', { phone: '0999900977' }, 'staff');
        const id = created.data.id;
        await app(`/sessions/${id}/selection`, 'PUT', { items: [{ skuId: sku.id, quantity: 1 }], accessories: [], payments: ['Cash'], ontop: [], points: [], receiptType: 'SIMPLIFIED', discountType: 'GENERAL', customerSource: 'WALK_IN' }, 'staff');
        assert.equal((await app(`/sessions/${id}/confirm`, 'POST', undefined, 'staff')).status, 201);
        await app(`/sessions/${id}/step`, 'POST', { action: 'search' }, 'stock');
        const order = (await app(`/sessions/${id}`, 'GET', undefined, 'stock')).data;
        assert.equal((await app(`/sessions/${id}/serials`, 'POST', { itemId: order.items[0].id, sn: sn(11) }, 'stock')).status, 201);

        fmpRows = (url) =>
          (url.searchParams.get('$filter') ?? '').startsWith('product_sn')
            ? []
            : [{ product_sn: sn(12) }, { product_sn: sn(11) }, { product_sn: sn(10) }];
        const before = seen.length;
        const wrong = (await ask({ sn: sn(9), part: sku.sku })).data;
        assert.deepEqual([wrong.status, wrong.target, wrong.verdict, wrong.model], ['ok', 'UAT', 'not-in-stock', sku.sku], JSON.stringify(wrong));
        assert.ok(seen.slice(before).every((call) => call.path === '/fmi/odata/v4/UF%20UAT/ProductStore_detail'), 'the test FileMaker, not the ERP');
        const queueOf = order.queueNo === null ? order.reference : String(order.queueNo).padStart(3, '0');
        assert.deepEqual([wrong.branchUnits.count, wrong.branchUnits.more, wrong.branchUnits.units], [
          3,
          false,
          [
            { sn: sn(10), taken: null },
            { sn: sn(11), taken: `คิว ${queueOf}` },
            { sn: sn(12), taken: null },
          ],
        ]);
        // the order asking sees its own unit as its own, not as another order's
        const own = (await ask({ sn: sn(9), part: sku.sku, session: id })).data;
        assert.equal(own.branchUnits.units.find((u) => u.sn === sn(11)).taken, 'ออเดอร์นี้');
        assert.equal((await ask({ sn: sn(9), session: 'bad id!' })).status, 400);

        // the same question twice at once goes to FileMaker once
        const once = seen.length;
        const [a, b] = await Promise.all([ask({ sn: sn(14), part: sku.sku }), ask({ sn: sn(14), part: sku.sku })]);
        assert.deepEqual([a.data.verdict, b.data.verdict], ['not-in-stock', 'not-in-stock']);
        assert.equal(seen.slice(once).filter((call) => call.filter === `product_sn eq '${sn(14)}'`).length, 1, 'one request for both');

        // the same list for a serial FileMaker left off a held bill; an ADMIN names the branch, others get their own
        const listed = await request(`/stock/branch-units?${new URLSearchParams({ part: sku.sku })}`, 'GET', undefined, cookies.staff);
        assert.equal(listed.status, 200, JSON.stringify(listed.data));
        assert.deepEqual([listed.data.status, listed.data.target, listed.data.model, listed.data.branchCode, listed.data.count], ['ok', 'UAT', sku.sku, branches.a.code, 3]);
        assert.equal((await request('/stock/branch-units', 'GET', undefined, cookies.staff)).status, 400, 'part is required');
        assert.equal((await request(`/stock/branch-units?part=${encodeURIComponent(sku.sku)}`, 'GET', undefined, cookies.manager)).status, 403);
        assert.ok(here, 'the branch has an ERP id');

        // the real FileMaker again: off without SERIAL_CHECK=fmp, and the test FileMaker is not asked
        await db.setting.update({ where: { name: 'fmpPushMode' }, data: { value: 'production' } });
        const quiet = seen.length;
        const units = (query) => request(`/stock/branch-units?${new URLSearchParams({ part: sku.sku, ...query })}`, 'GET', undefined, cookies.staff);
        assert.equal((await ask({ sn: sn(13), part: sku.sku })).data.status, 'off');
        assert.equal((await units({})).data.status, 'off');
        assert.equal((await units({ target: 'PRODUCTION' })).data.status, 'off');
        assert.equal(seen.length, quiet);
        // a bill that went to the test FileMaker still looks there after ADMIN switched to the real one
        const uatBill = (await units({ target: 'UAT' })).data;
        assert.deepEqual([uatBill.status, uatBill.target, uatBill.count], ['ok', 'UAT', 3]);
        assert.equal((await units({ target: 'TEST' })).status, 400);
      } finally {
        if (prior) await db.setting.update({ where: { name: 'fmpPushMode' }, data: { value: prior.value } });
        else await db.setting.deleteMany({ where: { name: 'fmpPushMode' } });
        for (const key of ['FMP_UAT_HOST', 'FMP_UAT_DATABASE', 'FMP_UAT_USER', 'FMP_UAT_PASSWORD']) delete process.env[key];
        fmpRows = [];
      }
    });
  } finally {
    await cleanup(ctx, world);
  }
});
