import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { after, test } from 'node:test';
import { cleanup, seedCatalog, seedWorld, startApi } from './support.mjs';

// A stand-in for the ERP's OData: it records every request and answers from `rows` (or fails while `fail` is set).
const seen = [];
let fail = false;
const rows = { ProductStore: [], ProductStore_detail: [] };
const fake = createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  const entity = url.pathname.split('/').pop();
  seen.push({ entity, filter: url.searchParams.get('$filter'), select: url.searchParams.get('$select'), auth: req.headers.authorization });
  if (fail) {
    res.writeHead(500).end('{}');
    return;
  }
  res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ value: rows[entity] ?? [] }));
});
await new Promise((resolve) => fake.listen(0, '127.0.0.1', resolve));
after(() => new Promise((resolve) => fake.close(resolve)));
process.env.ERP_ODATA_BASE_URL = `http://127.0.0.1:${fake.address().port}/fmi/odata/v4/ERP`;
process.env.ERP_ODATA_USER = 'reader';
process.env.ERP_ODATA_PASS = 'test-only';
process.env.ERP_SYNC_TIMES = ''; // no scheduled import against the fake
process.env.FMP_UNIT_CHECK_QUIET = ''; // the warroom windows are tested on their own below

const { quietWindow } = await import('../dist/erp/fmp-units.service.js');

test('the ERP is left alone around warroom pulls: 5 minutes before to 30 after, Bangkok time (D104)', () => {
  const slots = '12:15,15:15,18:15,21:15,23:45';
  const at = (bangkok) => new Date(`2026-11-05T${bangkok}:00+07:00`);
  assert.equal(quietWindow(at('15:09'), slots), null);
  assert.equal(quietWindow(at('15:10'), slots), '15:15');
  assert.equal(quietWindow(at('15:45'), slots), '15:15');
  assert.equal(quietWindow(at('15:46'), slots), null);
  assert.equal(quietWindow(new Date('2026-11-06T00:14:00+07:00'), slots), '23:45', 'across midnight');
  assert.equal(quietWindow(new Date('2026-11-06T00:16:00+07:00'), slots), null);
  assert.equal(quietWindow(at('15:15'), ''), null, 'no slots, no quiet time');
});

test('STOCK sees what FileMaker holds as ready for a model: here, elsewhere, and a verdict on the scanned serial (D104)', async (t) => {
  const ctx = await startApi(t);
  if (!ctx) return;
  const { db, request } = ctx;
  let world;
  try {
    world = await seedWorld(ctx);
    const { cookies, branches } = world;
    const [withUpc, withoutUpc] = await seedCatalog(ctx, world, 2, 5);
    const here = 900000 + Math.floor(Math.random() * 90000);
    await db.branch.update({ where: { id: branches.a.id }, data: { erpBranchId: here } });
    await db.branch.update({ where: { id: branches.b.id }, data: { erpBranchId: here + 1 } });
    await db.productSku.update({ where: { id: withUpc.id }, data: { upc: '190000000001' } });
    const ask = (query, who = 'stock') => request(`/stock/fmp-units?${new URLSearchParams(query)}`, 'GET', undefined, cookies[who]);
    rows.ProductStore_detail = [
      { product_sn: 'C02HERE01', BranchStore_id: here, status: 'ready' },
      { product_sn: 'c02here02', BranchStore_id: here, status: 'ready' },
      { product_sn: 'C02MOVED1', BranchStore_id: here + 1, status: 'ready' },
      { product_sn: 'C02FAR001', BranchStore_id: 7, status: 'ready' },
    ];

    await t.test('only STOCK, CASHIER and ADMIN; a part is required and checked', async () => {
      assert.equal((await ask({ part: withUpc.sku }, 'staff')).status, 403);
      assert.equal((await ask({})).status, 400);
      assert.equal((await ask({ part: "x' or 1 eq 1" })).status, 400);
    });

    await t.test('the units ready here and elsewhere, by the catalog UPC; three columns, filtered on UPC + ready, never on the serial', async () => {
      const res = await ask({ part: withUpc.sku, sn: 'c02moved1' });
      assert.equal(res.status, 200, JSON.stringify(res.data));
      assert.equal(res.data.status, 'ok');
      assert.deepEqual(res.data.here, ['C02HERE01', 'C02HERE02'], 'in capitals');
      assert.deepEqual(res.data.sn, { sn: 'C02MOVED1', verdict: 'other-branch', branchCode: branches.b.code, branchName: branches.b.name });
      assert.deepEqual(
        res.data.elsewhere.sort((x, y) => (x.erpBranchId ?? 0) - (y.erpBranchId ?? 0)),
        [{ erpBranchId: 7, branchCode: null, count: 1 }, { erpBranchId: here + 1, branchCode: branches.b.code, count: 1 }],
      );
      const call = seen.at(-1);
      assert.equal(call.entity, 'ProductStore_detail');
      assert.equal(call.filter, "product_upc eq '190000000001' and status eq 'ready'");
      assert.equal(call.select, 'product_sn,BranchStore_id,status');
      assert.equal(call.auth, `Basic ${Buffer.from('reader:test-only').toString('base64')}`);
      assert.ok(!seen.some((s) => s.entity === 'ProductStore'), 'the catalog had the UPC');
    });

    await t.test('a minute of reuse: the next scans of the same model do not ask the ERP again', async () => {
      const before = seen.length;
      assert.equal((await ask({ part: withUpc.sku, sn: 'C02HERE01' })).data.sn.verdict, 'here');
      assert.equal((await ask({ part: withUpc.sku, sn: 'NOPE' })).data.sn.verdict, 'not-ready');
      assert.equal(seen.length, before);
    });

    await t.test('no UPC in the catalog: FileMaker\'s ProductStore gives it (once)', async () => {
      rows.ProductStore = [{ Product_upc: '190000000002' }];
      const res = await ask({ part: withoutUpc.sku });
      assert.equal(res.data.status, 'ok');
      assert.equal(res.data.upc, '190000000002');
      const lookups = seen.filter((s) => s.entity === 'ProductStore');
      assert.equal(lookups.length, 1);
      assert.equal(lookups[0].filter, `product_model eq '${withoutUpc.sku}'`);
      assert.equal(lookups[0].select, 'Product_upc');
    });

    await t.test('switched off: it says so and asks nothing', async () => {
      process.env.FMP_UNIT_CHECK = 'off';
      const before = seen.length;
      const res = await ask({ part: 'MK2L4ZP/A' });
      delete process.env.FMP_UNIT_CHECK;
      assert.equal(res.data.status, 'off');
      assert.equal(seen.length, before);
    });

    await t.test('one failure pauses every check (no retry, no load on a struggling ERP); it answers 200 "unavailable"', async () => {
      fail = true;
      const before = seen.length;
      const first = await ask({ part: `${withUpc.sku.slice(0, -1)}Z` });
      assert.equal(first.status, 200);
      assert.equal(first.data.status, 'unavailable');
      assert.equal(seen.length - before, 1, 'asked once, no retry');
      fail = false;
      const next = await ask({ part: withoutUpc.sku, sn: 'X' });
      assert.equal(next.data.status, 'ok', 'already cached models still answer');
      const other = await ask({ part: 'MK2L4ZP/A' });
      assert.equal(other.data.status, 'unavailable');
      assert.match(other.data.reason, /พักการตรวจ 10 นาที/);
      assert.equal(seen.length - before, 1, 'nothing sent while paused');
    });
  } finally {
    await cleanup(ctx, world);
  }
});
