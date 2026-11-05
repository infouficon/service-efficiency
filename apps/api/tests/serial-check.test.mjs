import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { after, test } from 'node:test';
import pg from 'pg';
import { cleanup, seedCatalog, seedWorld, startApi } from './support.mjs';

const PG_URL = process.env.WARROOM_TEST_PG_URL ?? 'postgres://postgres@127.0.0.1:5498/warroom_stub';
process.env.WARROOM_SYNC_MINUTES = '0'; // no background sync against the stub while this test runs
process.env.ERP_SYNC_TIMES = ''; // no scheduled ERP import against the fake below
process.env.SERIAL_CHECK_QUIET = ''; // the warroom windows are tested on their own

// A stand-in for the ERP's OData: it records every request and answers from `fmpRows` (or fails while `fail` is set).
const seen = [];
let fail = false;
let fmpRows = [];
const fake = createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  seen.push({ entity: url.pathname.split('/').pop(), filter: url.searchParams.get('$filter'), select: url.searchParams.get('$select'), top: url.searchParams.get('$top') });
  if (fail) return res.writeHead(500).end('{}');
  res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ value: fmpRows }));
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

test('one scanned serial against the stock: warroom by default, FileMaker live when switched to it (D104)', async (t) => {
  const url = new URL(PG_URL);
  if (!['127.0.0.1', 'localhost'].includes(url.hostname) || url.pathname !== '/warroom_stub')
    throw new Error('the Postgres stub must be a local database named warroom_stub');
  const stub = new pg.Client({ connectionString: PG_URL, connectionTimeoutMillis: 3000 });
  try {
    await stub.connect();
  } catch {
    t.skip('Postgres stub (warroom) not reachable, skipping');
    return;
  }
  const ctx = await startApi(t);
  if (!ctx) {
    await stub.end();
    return;
  }
  const { db, request } = ctx;
  let world;
  try {
    world = await seedWorld(ctx);
    const { cookies, branches, prefix } = world;
    const [sku] = await seedCatalog(ctx, world, 1, 5);
    const ask = (query, who = 'stock') => request(`/stock/serial-check?${new URLSearchParams(query)}`, 'GET', undefined, cookies[who]);
    const tag = prefix.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
    const sn = (n) => `${tag}SN${n}`;
    process.env.WARROOM_DATABASE_URL = PG_URL;
    await stub.query(`CREATE SCHEMA IF NOT EXISTS mart; DROP TABLE IF EXISTS mart.stock_current; DROP TABLE IF EXISTS mart.stock_mv;
      CREATE TABLE mart.stock_mv (snapshot_at timestamptz); CREATE TABLE mart.stock_current (product_sn text, status text, branch_code text, branch_name text, product_model text);`);
    await stub.query(`INSERT INTO mart.stock_mv VALUES ('2026-11-05T08:31:00Z')`);
    const unit = (s, status, branch, model = sku.sku) =>
      stub.query('INSERT INTO mart.stock_current VALUES ($1, $2, $3, $4, $5)', [s, status, branch.code ?? branch, branch.name ?? 'ไกลออกไป', model]);
    await unit(sn(1), 'ready', branches.a);
    await unit(sn(2).toLowerCase(), 'ready', branches.b);
    await unit(sn(3), 'transfer', branches.a);
    await unit(sn(4), 'ready', branches.a, 'OTHER/A');

    await t.test('only STOCK, CASHIER and ADMIN; a serial is required and checked', async () => {
      assert.equal((await ask({ sn: sn(1) }, 'staff')).status, 403);
      assert.equal((await ask({})).status, 400);
      assert.equal((await ask({ sn: 'AB CD' })).status, 400);
      assert.equal((await ask({ sn: sn(1), part: "x' or 1" })).status, 400);
    });

    await t.test('warroom: here, in another branch, not ready, another model, not in stock; with the snapshot time', async () => {
      const here = await ask({ sn: sn(1).toLowerCase(), part: sku.sku });
      assert.equal(here.status, 200, JSON.stringify(here.data));
      assert.deepEqual(here.data, { status: 'ok', source: 'warroom', asOf: '2026-11-05T08:31:00.000Z', sn: sn(1), verdict: 'here' });
      const moved = (await ask({ sn: sn(2), part: sku.sku })).data;
      assert.deepEqual([moved.verdict, moved.branchCode, moved.branchName], ['other-branch', branches.b.code, branches.b.name]);
      assert.deepEqual([(await ask({ sn: sn(3) })).data.verdict, (await ask({ sn: sn(3) })).data.stockStatus], ['not-ready', 'transfer']);
      const wrong = (await ask({ sn: sn(4), part: sku.sku })).data;
      assert.deepEqual([wrong.verdict, wrong.model], ['other-model', 'OTHER/A']);
      assert.equal((await ask({ sn: sn(9) })).data.verdict, 'not-in-stock');
      assert.equal(seen.length, 0, 'FileMaker is never asked in warroom mode');
    });

    await t.test('switched off: it says so', async () => {
      process.env.SERIAL_CHECK = 'off';
      const res = await ask({ sn: sn(1) });
      delete process.env.SERIAL_CHECK;
      assert.equal(res.data.status, 'off');
    });

    await t.test('FileMaker live: one serial, four columns, branch by ERP id, model by the catalog UPC; cached; a failure pauses it', async () => {
      process.env.SERIAL_CHECK = 'fmp';
      const here = 910000 + Math.floor(Math.random() * 80000);
      await db.branch.update({ where: { id: branches.a.id }, data: { erpBranchId: here } });
      await db.branch.update({ where: { id: branches.b.id }, data: { erpBranchId: here + 1 } });
      await db.productSku.update({ where: { id: sku.id }, data: { upc: '190000000001' } });
      fmpRows = [{ product_sn: sn(5), BranchStore_id: here + 1, status: 'ready', product_upc: '190000000001' }];
      const moved = (await ask({ sn: sn(5), part: sku.sku })).data;
      assert.deepEqual([moved.source, moved.verdict, moved.branchCode], ['fmp', 'other-branch', branches.b.code]);
      const call = seen.at(-1);
      assert.deepEqual([call.entity, call.filter, call.select, call.top], ['ProductStore_detail', `product_sn eq '${sn(5)}'`, 'product_sn,BranchStore_id,status,product_upc', '3']);
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
    });
  } finally {
    await stub.query('DROP TABLE IF EXISTS mart.stock_current; DROP TABLE IF EXISTS mart.stock_mv').catch(() => undefined);
    await stub.end();
    await cleanup(ctx, world);
  }
});
