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
  assert.deepEqual([...wr.SERIAL_VIEW_COLUMNS], ['product_sn', 'status', 'status_sub', 'stock_type', 'branch_code', 'branch_name', 'product_model', 'product_upc', 'product_name', 'qty', 'transfer_date', 'age_in_branch']);
  assert.equal(wr.likePattern('IS-TM'), '%IS-TM%');
  assert.equal(wr.likePattern('50%_off\\x'), '%50\\%\\_off\\\\x%', 'wildcards typed by a person are escaped');
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
      for (const who of ['staff', 'stock', 'manager']) assert.equal((await look(q('A', 'B'), who)).status, 403, who);
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
    // the real view's columns (as warroom answered on 2026-11-02), with the price and cost the lookup must never show
    const FULL = `stock_type text, snapshot_at timestamptz, no_inv text, product_sn text, product_upc text, product_name text, product_model text, product_cat text, qty int,
      cost_before_vat numeric, price_sell numeric, age_in_stock int, age_in_branch int, status text, status_sub text, branch_code text, branch_name text, supplier_name text, transfer_date text`;
    const add = (sn, status, branch, part) => [
      `INSERT INTO mart.stock_current (stock_type, product_sn, product_upc, product_name, product_model, qty, cost_before_vat, price_sell, age_in_branch, status, status_sub, branch_code, branch_name, supplier_name)
       VALUES ($2,$1,'194253000001','iPhone Duo',$4,1,77777,99999,12,$2,'sub',$3,'สาขา ' || $3,'SUPPLIER-X')`,
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
      for (const secret of ['99999', '77777', 'SUPPLIER-X']) assert.ok(!JSON.stringify(res.data).includes(secret), `price, cost and supplier are never returned (${secret})`);
      assert.equal(res.data.rows[0].branch_name, 'สาขา IS-TM');
      assert.equal(res.data.hints, null, 'hints only when nothing matched');
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
      assert.equal(none.data.hints.branchTotal, 30, 'the branch exists and holds 30 serials');
      assert.deepEqual(none.data.hints.partInOtherBranches, []);
      const sneaky = await look(q('x', `' OR 1=1; DROP TABLE mart.stock_current; --`));
      assert.equal(sneaky.status, 200);
      assert.equal(sneaky.data.total, 0);
      assert.equal((await stub.query('SELECT count(*)::int AS n FROM mart.stock_current')).rows[0].n, 30, 'nothing was dropped or matched');
    });

    await t.test('when nothing matches, the answer says what the view does hold: the part in other branches, branches that look like the one typed (D93)', async () => {
      await rebuild(FULL, [
        add('AAA1', 'ready', 'IS-TM-21', 'MK2H4ZP/A'),
        add('AAA2', 'ready', 'IS-TM-21', 'MK2H4ZP/A'),
        add('AAA3', 'ready', 'IS-CTW', 'MK2H4ZP/A'),
        add('AAA4', 'ready', 'IS-CTW', 'OTHER/A'),
      ]);
      const res = await look(q('IS-TM', 'MK2H4ZP/A'));
      assert.equal(res.status, 200, JSON.stringify(res.data));
      assert.equal(res.data.total, 0);
      assert.deepEqual(res.data.hints, {
        branchTotal: 0,
        partInOtherBranches: [
          { branchCode: 'IS-TM-21', branchName: 'สาขา IS-TM-21', count: 2 },
          { branchCode: 'IS-CTW', branchName: 'สาขา IS-CTW', count: 1 },
        ],
        branchesLike: [{ branchCode: 'IS-TM-21', branchName: 'สาขา IS-TM-21' }],
      });
      // the name of the branch matches too, and a typed % is not a wildcard
      const byName = await look(q('สาขา IS-C', 'NOPE/A'));
      assert.deepEqual(byName.data.hints.branchesLike, [{ branchCode: 'IS-CTW', branchName: 'สาขา IS-CTW' }]);
      assert.deepEqual((await look(q('%', 'NOPE/A'))).data.hints.branchesLike, [], 'a lone % finds nothing');
    });

    await t.test('list=branches and list=parts show what warroom really holds, from both views side by side; counts only (D93)', async () => {
      await rebuild(FULL, [
        add('L1', 'ready', 'ISTUDIO-T21', 'MK2H4ZP/A'),
        add('L2', 'ready', 'ISTUDIO-T21', 'MK2H4ZP/A'),
        add('L3', 'ready', 'ISTUDIO-T21', 'MGEA4TH/A'),
        add('L4', 'ready', 'IS-CTW', 'MGEA4TH/A'),
      ]);
      // the aggregated view the sync reads spells one branch differently
      await stub.query(`ALTER TABLE mart.stock_mv ADD COLUMN branch_code text, ADD COLUMN product_model text, ADD COLUMN qty numeric, ADD COLUMN stock_type text`);
      await stub.query(`DELETE FROM mart.stock_mv`);
      await stub.query(`INSERT INTO mart.stock_mv (snapshot_at, branch_code, product_model, qty, stock_type) VALUES (now(), 'IS-TM', 'MK2H4ZP/A', 2, 'ready'), (now(), 'IS-TM', 'MGEA4TH/A', 1, 'ready'), (now(), 'IS-CTW', 'MGEA4TH/A', 1, 'ready')`);
      const branches = await look('?list=branches');
      assert.equal(branches.status, 200, JSON.stringify(branches.data));
      assert.deepEqual(
        branches.data.rows.map((r) => [r.branchCode, r.branchName, r.serialsInStockCurrent, r.qtyInStockMv]).sort((a, b) => a[0].localeCompare(b[0])),
        [
          ['IS-CTW', 'สาขา IS-CTW', 1, 1],
          ['IS-TM', null, 0, 3],
          ['ISTUDIO-T21', 'สาขา ISTUDIO-T21', 3, 0],
        ],
        'IS-TM exists only in the aggregated view, ISTUDIO-T21 only in the per-serial one: that is the finding',
      );
      const parts = await look('?list=parts&branch=ISTUDIO-T21');
      assert.deepEqual(parts.data.rows.map((r) => [r.partNo, r.serialsInStockCurrent, r.qtyInStockMv]), [['MK2H4ZP/A', 2, 0], ['MGEA4TH/A', 1, 0]]);
      assert.equal(parts.data.branch, 'ISTUDIO-T21');
      assert.deepEqual((await look('?list=parts&branch=IS-TM')).data.rows.map((r) => [r.partNo, r.serialsInStockCurrent, r.qtyInStockMv]), [['MK2H4ZP/A', 0, 2], ['MGEA4TH/A', 0, 1]]);
      assert.equal((await look('?list=parts')).status, 400, 'parts need a branch');
      assert.equal((await look('?list=everything')).status, 400);
      for (const secret of ['99999', '77777', 'SUPPLIER-X', 'L1']) assert.ok(!JSON.stringify(branches.data).includes(secret) && !JSON.stringify(parts.data).includes(secret), `no prices, costs, suppliers or serials in the lists (${secret})`);
      for (const who of ['staff', 'manager']) assert.equal((await look('?list=branches', who)).status, 403, who);
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
      assert.deepEqual(slim.data.missingColumns, ['status', 'status_sub', 'stock_type', 'branch_name', 'product_upc', 'product_name', 'qty', 'transfer_date', 'age_in_branch']);
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
