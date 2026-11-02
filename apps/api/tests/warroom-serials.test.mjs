import assert from 'node:assert/strict';
import { test } from 'node:test';
import pg from 'pg';
import { cleanup, seedWorld, startApi } from './support.mjs';

const wr = await import('../dist/warroom/warroom-sync.service.js');
const PG_URL = process.env.WARROOM_TEST_PG_URL ?? 'postgres://postgres@127.0.0.1:5498/warroom_stub';
process.env.WARROOM_SYNC_MINUTES = '0'; // no background sync against the stub while this test runs

test('serial lookup helpers: identifiers are quoted, the column list is fixed (D92)', () => {
  assert.equal(wr.quoteIdent('product_sn'), '"product_sn"');
  assert.equal(wr.quoteIdent('a"b'), '"a""b"');
  assert.deepEqual([...wr.SERIAL_VIEW_COLUMNS], ['product_sn', 'status', 'branch_code', 'product_model', 'product_upc', 'product_name', 'date_transfer']);
});

test('ADMIN looks at what warroom holds per serial number: read-only, limited, tolerant of a different view (D92)', async (t) => {
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
  const { request } = ctx;
  let world;
  try {
    world = await seedWorld(ctx);
    const { cookies } = world;
    const look = (query, who = 'admin') => request(`/admin/warroom-sync/serials${query}`, 'GET', undefined, cookies[who]);
    const q = (branch, part, extra = '') => `?branch=${encodeURIComponent(branch)}&part=${encodeURIComponent(part)}${extra}`;

    await t.test('ADMIN only; the branch and the part are required; not configured is said plainly', async () => {
      delete process.env.WARROOM_DATABASE_URL;
      assert.equal((await request('/admin/warroom-sync/serials?branch=A&part=B')).status, 401);
      for (const who of ['staff', 'stock', 'cashier', 'manager']) assert.equal((await look(q('A', 'B'), who)).status, 403, who);
      for (const bad of ['', '?branch=A', '?part=B', '?branch=%20&part=B', `?branch=${'x'.repeat(65)}&part=B`])
        assert.equal((await look(bad)).status, 400, bad);
      const off = await look(q('A', 'B'));
      assert.equal(off.status, 400);
      assert.match(JSON.stringify(off.data), /WARROOM_DATABASE_URL/);
    });

    process.env.WARROOM_DATABASE_URL = PG_URL;
    const rebuild = async (columns, rows) => {
      await stub.query(`CREATE SCHEMA IF NOT EXISTS mart; DROP TABLE IF EXISTS mart.stock_current; DROP TABLE IF EXISTS mart.stock_mv;
        CREATE TABLE mart.stock_mv (snapshot_at timestamptz);`);
      await stub.query(`INSERT INTO mart.stock_mv VALUES (now() - interval '90 minutes')`);
      await stub.query(`CREATE TABLE mart.stock_current (${columns})`);
      for (const [sql, params] of rows) await stub.query(sql, params);
    };
    const FULL = `product_sn text, status text, branch_code text, product_model text, product_upc text, product_name text, date_transfer text, price_sell numeric`;
    const add = (sn, status, branch, part) => [
      `INSERT INTO mart.stock_current (product_sn, status, branch_code, product_model, product_upc, product_name, date_transfer, price_sell) VALUES ($1,$2,$3,$4,'194253000001','iPhone Duo',NULL,99999)`,
      [sn, status, branch, part],
    ];

    await t.test('counts by status and the first rows of one branch and part, with how old the snapshot is', async () => {
      await rebuild(FULL, [
        add('F9AAA0003', 'ready', 'IS-TM', 'MK2H4ZP/A'),
        add('F9AAA0001', 'ready', 'IS-TM', 'MK2H4ZP/A'),
        add('F9AAA0002', 'ready', 'IS-TM', 'MK2H4ZP/A'),
        add('F9AAA0004', 'transfer', 'IS-TM', 'MK2H4ZP/A'),
        add('SOTHER0001', 'ready', 'IS-TM', 'MGEA4TH/A'),
        add('SOTHER0002', 'ready', 'OTHER', 'MK2H4ZP/A'),
      ]);
      const res = await look(q('IS-TM', 'mk2h4zp/a')); // the part is compared without regard to case
      assert.equal(res.status, 200, JSON.stringify(res.data));
      assert.equal(res.data.view, 'mart.stock_current');
      assert.equal(res.data.total, 4);
      assert.deepEqual(res.data.byStatus, { ready: 3, transfer: 1 });
      assert.deepEqual(res.data.rows.map((r) => r.product_sn), ['F9AAA0001', 'F9AAA0002', 'F9AAA0003', 'F9AAA0004'], 'ordered by status then serial');
      assert.deepEqual(Object.keys(res.data.rows[0]), [...wr.SERIAL_VIEW_COLUMNS], 'a fixed list of columns, in order');
      assert.ok(!JSON.stringify(res.data).includes('99999'), 'the price column is never returned');
      assert.ok(res.data.columns.includes('price_sell'), 'the view\'s column list is shown so the team can compare');
      assert.deepEqual(res.data.missingColumns, []);
      assert.ok(res.data.ageMinutes >= 89 && res.data.ageMinutes <= 92, `snapshot is about 90 minutes old, got ${res.data.ageMinutes}`);
      assert.match(res.data.snapshotAt, /^\d{4}-\d\d-\d\dT/);
    });

    await t.test('at most 20 rows, whatever is asked; a lookup that matches nothing is empty, not an error; injection is only text', async () => {
      const many = Array.from({ length: 30 }, (_, i) => add(`BULK${String(i).padStart(3, '0')}`, 'ready', 'IS-TM', 'BULK/A'));
      await rebuild(FULL, many);
      assert.equal((await look(q('IS-TM', 'BULK/A', '&take=500'))).data.rows.length, 20);
      assert.equal((await look(q('IS-TM', 'BULK/A', '&take=3'))).data.rows.length, 3);
      assert.equal((await look(q('IS-TM', 'BULK/A', '&take=abc'))).data.rows.length, 10, 'junk falls back to 10');
      assert.equal((await look(q('IS-TM', 'BULK/A', '&take=0'))).data.rows.length, 10);
      assert.equal((await look(q('IS-TM', 'BULK/A'))).data.total, 30, 'the count is of all, the rows are the first ones');
      const none = await look(q('IS-TM', 'NOPE/A'));
      assert.equal(none.status, 200);
      assert.deepEqual([none.data.total, none.data.rows], [0, []]);
      const sneaky = await look(q('x', `' OR 1=1; DROP TABLE mart.stock_current; --`));
      assert.equal(sneaky.status, 200);
      assert.equal(sneaky.data.total, 0);
      assert.equal((await stub.query('SELECT count(*)::int AS n FROM mart.stock_current')).rows[0].n, 30, 'nothing was dropped or matched');
    });

    await t.test('a READ ONLY transaction (the one the lookup runs in) refuses writes', async () => {
      const rw = new pg.Client({ connectionString: PG_URL });
      await rw.connect();
      try {
        await rw.query('BEGIN READ ONLY');
        await assert.rejects(rw.query(`INSERT INTO mart.stock_current (product_sn) VALUES ('X')`), /read-only/i);
      } finally {
        await rw.query('ROLLBACK').catch(() => undefined);
        await rw.end();
      }
    });

    await t.test('a view with other columns: what is missing is listed; without the serial column there is nothing to look up', async () => {
      await rebuild(`product_sn text, branch_code text, product_model text`, [[`INSERT INTO mart.stock_current VALUES ('S1','IS-TM','P/A')`, []]]);
      const slim = await look(q('IS-TM', 'P/A'));
      assert.equal(slim.status, 200, JSON.stringify(slim.data));
      assert.deepEqual(slim.data.missingColumns, ['status', 'product_upc', 'product_name', 'date_transfer']);
      assert.deepEqual(slim.data.rows, [{ product_sn: 'S1', branch_code: 'IS-TM', product_model: 'P/A' }]);
      assert.deepEqual(slim.data.byStatus, {});
      assert.equal(slim.data.total, null, 'no status column, no counts');

      await rebuild(`sn text, branch_code text, product_model text`, []);
      const other = await look(q('IS-TM', 'P/A'));
      assert.equal(other.status, 200);
      assert.deepEqual(other.data.columns, ['sn', 'branch_code', 'product_model']);
      assert.deepEqual(other.data.rows, []);
      assert.ok(other.data.missingColumns.includes('product_sn'));

      await stub.query('DROP TABLE mart.stock_current');
      const gone = await look(q('IS-TM', 'P/A'));
      assert.equal(gone.status, 200);
      assert.deepEqual([gone.data.columns, gone.data.rows], [[], []], 'no such view: an empty answer that says so');
    });

    await t.test('a database that cannot be reached is a readable message with no connection string in it', async () => {
      process.env.WARROOM_DATABASE_URL = 'postgres://reader:secretpw@127.0.0.1:1/warroom_stub';
      const res = await look(q('IS-TM', 'P/A'));
      assert.equal(res.status, 400);
      assert.match(res.data.message, /อ่าน warroom ไม่สำเร็จ/);
      assert.ok(!JSON.stringify(res.data).includes('secretpw'), 'no password in the answer');
    });
  } finally {
    delete process.env.WARROOM_DATABASE_URL;
    await stub.query('DROP TABLE IF EXISTS mart.stock_current').catch(() => undefined);
    await stub.end().catch(() => undefined);
    await cleanup(ctx, world);
  }
});
