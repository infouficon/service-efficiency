import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import dotenv from 'dotenv';
import pg from 'pg';

dotenv.config({ path: '.env.test', override: true });

const wr = await import('../dist/warroom/warroom-sync.service.js');
const products = await import('../dist/products/products.service.js');

// ---------------------------------------------------------------------------
// Pure rules (no database)
// ---------------------------------------------------------------------------
test('mode: off only without a url, shadow by default, junk falls back to shadow', () => {
  assert.equal(wr.parseMode(undefined), 'shadow');
  assert.equal(wr.parseMode(' ON '), 'on');
  assert.equal(wr.parseMode('off'), 'off');
  assert.equal(wr.parseMode('banana'), 'shadow');
  const cfg = (o) => ({ get: (k) => o[k] });
  assert.equal(wr.warroomMode(cfg({ WARROOM_STOCK_MODE: 'on' })), 'off');
  assert.equal(
    wr.warroomMode(
      cfg({ WARROOM_DATABASE_URL: 'postgres://x/y', WARROOM_STOCK_MODE: 'on' }),
    ),
    'on',
  );
  assert.equal(
    wr.warroomMode(cfg({ WARROOM_DATABASE_URL: 'postgres://x/y' })),
    'shadow',
  );
});

test('ERP category text maps to SES categories; accessories win; unknown is not guessed', () => {
  assert.equal(wr.mapCategory('iPhone'), 'iPhone');
  assert.equal(wr.mapCategory('iPad'), 'iPad');
  assert.equal(wr.mapCategory('MacBook Pro'), 'Mac');
  assert.equal(wr.mapCategory('iMac'), 'Mac');
  assert.equal(wr.mapCategory('Apple Watch'), 'Watch');
  assert.equal(wr.mapCategory('Accessories'), 'Accessories');
  assert.equal(wr.mapCategory('AirPods'), 'Accessories');
  assert.equal(wr.mapCategory('iPhone Case'), 'Accessories');
  assert.equal(wr.mapCategory('Apple Watch Band'), 'Accessories');
  assert.equal(wr.mapCategory('Huawei Phone'), null);
  assert.equal(wr.mapCategory(''), null);
  assert.equal(wr.mapCategory(null), null);
});

test('short name drops the "Apple <part>" prefix', () => {
  assert.equal(
    wr.shortName('Apple MG8G4ZP/A iPhone 17 Pro 256GB Deep Blue', 'MG8G4ZP/A'),
    'iPhone 17 Pro 256GB Deep Blue',
  );
  assert.equal(
    wr.shortName('Apple XYZ/A Magic Mouse', 'OTHER/A'),
    'Magic Mouse',
  );
  assert.equal(wr.shortName(null, 'P/A'), 'P/A');
});

test('catalog: one item per part, hierarchy from sub-categories, unmapped parts only counted', () => {
  const row = (partNo, o = {}) => ({
    branchCode: 'B',
    partNo,
    upc: 'u',
    productName: `Apple ${partNo} thing 256GB Blue`,
    cat: 'iPhone',
    subcat: 'iPhone 17 Pro',
    subsubcat: null,
    capacity: '256GB',
    color: 'Blue',
    ready: 1,
    transfer: 0,
    snapshotAt: new Date(),
    ...o,
  });
  const { items, categories, skippedNoCategory } = wr.buildCatalog([
    row('A/A'),
    row('A/A', { branchCode: 'C' }),
    row('B/A', { cat: 'Accessories', subcat: 'Case', color: '' }),
    row('C/A', { cat: 'Huawei Phone', subcat: 'iPhone 17 Pro' }),
    row('D/A', { cat: '', subcat: 'iPad Pro 11' }),
  ]);
  assert.deepEqual(
    items.map((i) => [i.partNo, i.category, i.productName, i.modelName]),
    [
      ['A/A', 'iPhone', 'iPhone 17 Pro', 'iPhone 17 Pro'],
      ['B/A', 'Accessories', 'Case', 'Case'],
      ['D/A', 'iPad', 'iPad Pro 11', 'iPad Pro 11'],
    ],
  );
  assert.equal(items[0].skuName, 'thing 256GB Blue');
  assert.equal(items[0].storage, '256GB');
  assert.equal(items[1].color, null);
  assert.equal(
    skippedNoCategory,
    1,
    'an unrecognised category is not rescued by the sub-category',
  );
  assert.deepEqual(
    categories.find((c) => c.value === 'Huawei Phone'),
    { value: 'Huawei Phone', mapped: null, parts: 1 },
  );
});

test('availability: ERP ready minus promised units; completed before the snapshot does not count; missing report wins', () => {
  const asOf = new Date('2026-10-12T05:00:00Z');
  const inv = {
    branchId: 'b',
    skuId: 's',
    erpReady: 3,
    erpAsOf: asOf,
    outOfStockAt: null,
  };
  const res = (completedAt) => ({ branchId: 'b', skuId: 's', completedAt });
  const map = (list) => new Map([['b\u0000s', list]]);
  assert.equal(products.availableUnits(inv, new Map()), 3);
  assert.equal(products.availableUnits(inv, map([res(null)])), 2);
  assert.equal(
    products.availableUnits(inv, map([res(new Date('2026-10-12T04:00:00Z'))])),
    3,
    'completed before the snapshot: ERP already sold it',
  );
  assert.equal(
    products.availableUnits(inv, map([res(new Date('2026-10-12T06:00:00Z'))])),
    2,
    'completed after the snapshot: ERP still counts it',
  );
  assert.equal(
    products.availableUnits(
      inv,
      map([res(null), res(null), res(null), res(null)]),
    ),
    0,
    'never negative',
  );
  assert.equal(
    products.availableUnits(
      { ...inv, outOfStockAt: new Date('2026-10-12T05:30:00Z') },
      new Map(),
    ),
    0,
  );
  assert.equal(
    products.availableUnits(
      { ...inv, outOfStockAt: new Date('2026-10-12T04:30:00Z') },
      new Map(),
    ),
    3,
    'report older than the snapshot expired',
  );
  assert.equal(
    products.availableUnits({ ...inv, erpReady: null }, new Map()),
    null,
  );
});

test('errors never carry a connection string', () => {
  assert.equal(
    wr.safeMessage(
      new Error('connect failed postgres://npi_reader:secret@host:5432/db now'),
    ),
    'connect failed [url] now',
  );
});

// ---------------------------------------------------------------------------
// Real MySQL for SES + a Postgres stub playing warroom's mart.stock_mv
// ---------------------------------------------------------------------------
const PG_URL =
  process.env.WARROOM_TEST_PG_URL ??
  'postgres://postgres@127.0.0.1:5498/warroom_stub';
const database = new URL(process.env.DATABASE_URL ?? 'mysql://invalid/invalid');
const { createApplication } = await import('../dist/bootstrap.js');
const { PrismaService } = await import('../dist/prisma/prisma.service.js');
const { hashPassword } = await import('../dist/accounts/password.js');

test('warroom sync: shadow then on, availability, guards, against real databases', async (t) => {
  if (database.pathname !== '/service_efficiency_test')
    throw new Error(
      'Integration tests require isolated service_efficiency_test database',
    );
  const stub = new pg.Client({
    connectionString: PG_URL,
    connectionTimeoutMillis: 3000,
  });
  try {
    await stub.connect();
  } catch {
    t.skip('Postgres stub (warroom) not reachable, skipping');
    return;
  }
  // Set AFTER the app module was imported: ConfigService then reads these from process.env at call time.
  process.env.WARROOM_DATABASE_URL = PG_URL;
  process.env.WARROOM_STOCK_MODE = 'shadow';
  process.env.WARROOM_SYNC_MINUTES = '0'; // no timer; runs are started by hand or by calling tick()
  let app;
  try {
    app = await createApplication();
    app.useLogger(false);
    await app.listen(0, '127.0.0.1');
  } catch (err) {
    if (
      err &&
      (err.name === 'PrismaClientInitializationError' ||
        String(err).includes("Can't reach database server"))
    ) {
      t.skip('MySQL not reachable, skipping');
      await stub.end();
      return;
    }
    throw err;
  }
  const base = await app.getUrl();
  const db = app.get(PrismaService);
  const svc = app.get(wr.WarroomSyncService);
  const prefix = `wr${randomUUID().slice(0, 6)}`;
  const part = (k) => `${prefix}-${k}/A`;
  const [P1, P2, P3, P4] = [part('IP'), part('AC'), part('HW'), part('HO')];
  const B1 = `${prefix}-B1`,
    B2 = `${prefix}-B2`,
    BHO = `${prefix}-HO`;
  const adminId = `${prefix}-admin`,
    staffId = `${prefix}-staff`;
  const pw = 'Warroom-test-1';
  const asOf1 = new Date(Date.now() - 3 * 3600_000);
  const request = async (
    path,
    method = 'GET',
    body,
    cookie = '',
    origin = 'http://localhost:5174',
  ) => {
    const headers = {
      'Content-Type': 'application/json',
      Cookie: cookie,
      'X-Requested-With': 'ServiceEfficiency',
    };
    if (origin) headers.Origin = origin;
    const res = await fetch(`${base}/api${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return {
      status: res.status,
      data: await res.json().catch(() => null),
      cookie: res.headers.get('set-cookie')?.split(';')[0] ?? '',
    };
  };
  const login = (id) =>
    request('/auth/login', 'POST', { staffId: id, password: pw });
  let adminCookie = '',
    staffCookie = '';
  const run = (q = '') =>
    request(
      `/admin/warroom-sync/run${q ? `${q}&` : '?'}wait=true`,
      'POST',
      undefined,
      adminCookie,
    );
  const insert = (partNo, branch, type, qty, o = {}) =>
    stub.query(
      `INSERT INTO mart.stock_mv (stock_type, snapshot_at, product_upc, product_name, product_model, product_cat, product_subcat, product_subsubcat, qty, branch_code, capacity, color)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [
        type,
        o.snap ?? asOf1,
        `upc-${partNo}`,
        `Apple ${partNo} test product 256GB Blue`,
        partNo,
        o.cat ?? 'iPhone',
        'subcat' in o ? o.subcat : 'iPhone 17 Pro',
        o.subsub ?? null,
        qty,
        branch,
        o.cap ?? '256GB',
        o.color ?? 'Blue',
      ],
    );
  const staffList = async () =>
    (await request('/products', 'GET', undefined, staffCookie)).data;
  const staffSku = async (code) => {
    const all = await staffList();
    for (const p of all)
      for (const m of p.models)
        for (const s of m.skus) if (s.sku === code) return s;
    return null;
  };
  const inv = (branchId, skuId) =>
    db.branchInventory.findUnique({
      where: { branchId_skuId: { branchId, skuId } },
    });
  const created = { skuIds: [], sessionIds: [] };

  try {
    await stub.query(`CREATE SCHEMA IF NOT EXISTS mart; DROP TABLE IF EXISTS mart.stock_mv;
      CREATE TABLE mart.stock_mv (stock_type text, snapshot_at timestamptz, product_upc text, product_name text, product_model text,
        product_cat text, product_subcat text, product_subsubcat text, qty numeric, branch_code text, capacity text, color text)`);
    await insert(P1, B1, 'ready', 1);
    await insert(P1, B1, 'ready', 1);
    await insert(P1, B1, 'ready', 1);
    await insert(P1, B1, 'transfer', 1);
    await insert(P1, B2, 'ready', 2);
    await insert(P2, B1, 'ready', 5, {
      cat: 'Accessories',
      subcat: 'Case',
      cap: null,
      color: null,
    });
    await insert(P3, B1, 'ready', 4, { cat: 'Huawei Phone', subcat: null });
    await insert(P4, BHO, 'ready', 9);

    const b1 = await db.branch.create({
      data: { code: B1, name: 'wr b1', phone: '', active: true },
    });
    const b2 = await db.branch.create({
      data: { code: B2, name: 'wr b2', phone: '', active: true },
    });
    await db.staff.create({
      data: {
        staffId: adminId,
        passwordHash: await hashPassword(pw),
        mustChangePassword: false,
        roles: { create: { roleCode: 'ADMIN' } },
      },
    });
    await db.staff.create({
      data: {
        staffId,
        passwordHash: await hashPassword(pw),
        mustChangePassword: false,
        branchId: b1.id,
        roles: { create: { roleCode: 'STAFF' } },
      },
    });
    // A hand-made catalog entry for P1 with a manual stock of 7 at B1 (D41)
    const hand = await db.product.create({
      data: {
        category: 'iPhone',
        name: 'iPhone 17 Pro',
        active: true,
        models: {
          create: {
            name: 'iPhone 17 Pro',
            active: true,
            skus: { create: { sku: P1, name: 'hand made', active: true } },
          },
        },
      },
      include: { models: { include: { skus: true } } },
    });
    const sku1 = hand.models[0].skus[0];
    await db.branchInventory.create({
      data: { branchId: b1.id, skuId: sku1.id, stock: 7, active: true },
    });
    adminCookie = (await login(adminId)).cookie;
    staffCookie = (await login(staffId)).cookie;
    assert.ok(adminCookie && staffCookie);

    await t.test(
      'only an ADMIN may look; flags must be exactly true/false; status says shadow',
      async () => {
        assert.equal(
          (
            await request(
              '/admin/warroom-sync/status',
              'GET',
              undefined,
              staffCookie,
            )
          ).status,
          403,
        );
        assert.equal(
          (
            await request(
              '/admin/warroom-sync/run',
              'POST',
              undefined,
              staffCookie,
            )
          ).status,
          403,
        );
        assert.equal(
          (
            await request(
              '/admin/warroom-sync/run',
              'POST',
              undefined,
              adminCookie,
              '',
            )
          ).status,
          403,
        );
        assert.equal(
          (
            await request(
              '/admin/warroom-sync/run?dryRun=1',
              'POST',
              undefined,
              adminCookie,
            )
          ).status,
          400,
        );
        const st = await request(
          '/admin/warroom-sync/status',
          'GET',
          undefined,
          adminCookie,
        );
        assert.equal(st.status, 200);
        assert.equal(st.data.configured, true);
        assert.equal(st.data.mode, 'shadow');
        assert.equal(st.data.intervalMinutes, 0);
      },
    );

    await t.test('dry run reports the plan and writes nothing', async () => {
      const res = await run('?dryRun=true');
      assert.equal(res.status, 201, JSON.stringify(res.data));
      assert.equal(res.data.ok, true, res.data.error);
      const s = res.data.summary;
      assert.equal(s.mode, 'shadow');
      assert.equal(s.asOf, asOf1.toISOString());
      assert.equal(s.parts, 4);
      assert.equal(s.catalog.existing, 1);
      assert.equal(
        s.catalog.wouldCreate,
        1,
        'P2 only: P3 has no category, P4 exists only in a branch SES does not have',
      );
      assert.equal(s.catalog.skippedNoCategory, 1);
      assert.deepEqual(s.catalog.unmapped, [
        { value: 'Huawei Phone', parts: 1 },
      ]);
      assert.deepEqual(s.branches.unknown, [{ code: BHO, rows: 1 }]);
      assert.equal(s.branches.matched, 2);
      assert.equal(s.stock.updatedRows, 2);
      assert.equal(
        (await inv(b1.id, sku1.id)).erpReady,
        null,
        'nothing written',
      );
      assert.equal(await db.productSku.count({ where: { sku: P2 } }), 0);
    });

    await t.test(
      'shadow run: stores ERP numbers for SKUs SES has, creates nothing, staff still see the manual stock',
      async () => {
        const res = await run();
        assert.equal(res.data.ok, true, res.data.error);
        assert.equal(res.data.summary.stock.updatedRows, 2);
        assert.equal(res.data.summary.catalog.created, 0);
        const i1 = await inv(b1.id, sku1.id);
        assert.deepEqual(
          [i1.erpReady, i1.erpTransfer, i1.erpAsOf.toISOString(), i1.stock],
          [3, 1, asOf1.toISOString(), 7],
        );
        const i2 = await inv(b2.id, sku1.id);
        assert.deepEqual([i2.erpReady, i2.erpTransfer], [2, 0]);
        assert.equal(
          await db.productSku.count({ where: { sku: P2 } }),
          0,
          'no catalog in shadow',
        );
        const s = await staffSku(P1);
        assert.equal(s.stock, 7, 'manual stock still shown');
        assert.equal(s.erpCovered, true);
        const admin = await request(
          '/products?admin=true',
          'GET',
          undefined,
          adminCookie,
        );
        const row = admin.data
          .flatMap((p) => p.models.flatMap((m) => m.skus))
          .find((x) => x.sku === P1)
          .inventory.find((x) => x.branchId === b1.id);
        assert.equal(row.available, 3);
        assert.equal(
          (
            await request(
              `/products/branches/${b1.id}/skus/${sku1.id}/stock`,
              'PUT',
              { stock: 9 },
              adminCookie,
            )
          ).status,
          200,
          'manual edit still allowed in shadow',
        );
        await db.branchInventory.update({
          where: { branchId_skuId: { branchId: b1.id, skuId: sku1.id } },
          data: { stock: 7 },
        });
      },
    );

    await t.test(
      'mode on: catalog is created, ERP numbers drive the screen, promised units are subtracted',
      async () => {
        process.env.WARROOM_STOCK_MODE = 'on';
        const dry = await run('?dryRun=true');
        assert.equal(
          dry.data.summary.catalog.wouldCreate,
          1,
          'a dry run in mode on still reports what it would create',
        );
        assert.equal(await db.productSku.count({ where: { sku: P2 } }), 0);
        const res = await run();
        assert.equal(res.data.ok, true, res.data.error);
        assert.equal(res.data.summary.catalog.created, 1);
        const sku2 = await db.productSku.findUnique({
          where: { sku: P2 },
          include: { model: { include: { product: true } } },
        });
        created.skuIds.push(sku2.id);
        assert.equal(sku2.erpManaged, true);
        assert.equal(sku2.model.erpManaged, true);
        assert.equal(sku2.model.product.erpManaged, true);
        assert.equal(sku2.model.product.category, 'Accessories');
        assert.equal(sku2.model.product.name, 'Case');
        assert.equal(sku2.name, 'test product 256GB Blue');
        assert.equal((await inv(b1.id, sku2.id)).erpReady, 5);
        assert.equal(
          await db.productSku.count({ where: { sku: P3 } }),
          0,
          'unmapped category is skipped',
        );
        assert.equal(
          await db.productSku.count({ where: { sku: P4 } }),
          0,
          'unknown branch: no stock rows, so nothing to sell',
        );

        assert.equal(
          (await staffSku(P1)).stock,
          3,
          'ERP ready replaces the manual 7',
        );
        assert.equal((await staffSku(P2)).stock, 5);
        // a customer session that reached FOUND holds one unit
        const mk = (ref, events) =>
          db.customerSession.create({
            data: {
              reference: `${prefix}-${ref}`.slice(0, 32),
              branchId: b1.id,
              staffId,
              state: 'FOUND',
              productId: hand.id,
              modelId: hand.models[0].id,
              skuId: sku1.id,
              stockFoundAt: new Date(),
              events: { create: events },
            },
          });
        const held = await mk('held', [
          { eventType: 'STOCK_FOUND', actorStaffId: staffId },
        ]);
        created.sessionIds.push(held.id);
        assert.equal((await staffSku(P1)).stock, 2);
        const doneBefore = await mk('before', [
          {
            eventType: 'COMPLETED',
            actorStaffId: staffId,
            createdAt: new Date(asOf1.getTime() - 600_000),
          },
        ]);
        created.sessionIds.push(doneBefore.id);
        assert.equal(
          (await staffSku(P1)).stock,
          2,
          'completed before the snapshot: the ERP already sold it',
        );
        const doneAfter = await mk('after', [
          { eventType: 'COMPLETED', actorStaffId: staffId },
        ]);
        created.sessionIds.push(doneAfter.id);
        assert.equal(
          (await staffSku(P1)).stock,
          1,
          'completed after the snapshot: the ERP still counts it',
        );
        await db.customerSession.update({
          where: { id: doneAfter.id },
          data: { outcome: 'CUSTOMER_CANCELLED' },
        });
        assert.equal(
          (await staffSku(P1)).stock,
          2,
          'a cancelled session releases its unit',
        );
        // D41 report newer than the snapshot -> 0
        await db.branchInventory.update({
          where: { branchId_skuId: { branchId: b1.id, skuId: sku1.id } },
          data: { outOfStockAt: new Date() },
        });
        assert.equal((await staffSku(P1)).stock, 0);
        await db.branchInventory.update({
          where: { branchId_skuId: { branchId: b1.id, skuId: sku1.id } },
          data: { outOfStockAt: null },
        });
      },
    );

    await t.test('mode on locks what the ERP owns', async () => {
      const sku2 = await db.productSku.findUnique({
        where: { sku: P2 },
        include: { model: true },
      });
      assert.equal(
        (
          await request(
            `/products/branches/${b1.id}/skus/${sku2.id}/stock`,
            'PUT',
            { stock: 9 },
            adminCookie,
          )
        ).status,
        409,
      );
      assert.equal(
        (
          await request(
            `/products/branches/${b1.id}/skus/${sku1.id}/stock`,
            'PUT',
            { stock: 9 },
            adminCookie,
          )
        ).status,
        409,
      );
      assert.equal(
        (
          await request(
            `/products/skus/${sku2.id}`,
            'PUT',
            { name: 'renamed by hand' },
            adminCookie,
          )
        ).status,
        409,
      );
      assert.equal(
        (
          await request(
            `/products/skus/${sku2.id}`,
            'PUT',
            {
              sku: sku2.sku,
              name: sku2.name,
              color: sku2.color ?? '',
              storage: sku2.storage ?? '',
              active: true,
            },
            adminCookie,
          )
        ).status,
        200,
        'unchanged fields are fine',
      );
      assert.equal(
        (
          await request(
            `/products/models/${sku2.modelId}`,
            'PUT',
            { name: 'renamed' },
            adminCookie,
          )
        ).status,
        409,
      );
      assert.equal(
        (
          await request(
            `/products/${sku2.model.productId}`,
            'PUT',
            { name: 'renamed' },
            adminCookie,
          )
        ).status,
        409,
      );
      assert.equal(
        (
          await request(
            `/products/skus/${sku2.id}`,
            'PUT',
            { active: false },
            adminCookie,
          )
        ).status,
        200,
        'selling can be switched off',
      );
      await db.productSku.update({
        where: { id: sku2.id },
        data: { active: true },
      });
      assert.equal(
        (
          await request(
            `/products/skus/${sku1.id}`,
            'PUT',
            { name: 'hand edit' },
            adminCookie,
          )
        ).status,
        200,
        'hand-made SKUs stay editable',
      );
    });

    await t.test(
      'a part that left the snapshot is zeroed; a newer snapshot clears the missing-report override',
      async () => {
        const newer = new Date(Date.now() - 1000);
        await stub.query(
          `DELETE FROM mart.stock_mv WHERE product_model = $1 AND branch_code = $2`,
          [P1, B2],
        );
        await stub.query(`UPDATE mart.stock_mv SET snapshot_at = $1`, [newer]);
        await db.branchInventory.update({
          where: { branchId_skuId: { branchId: b1.id, skuId: sku1.id } },
          data: { outOfStockAt: new Date(newer.getTime() - 60_000) },
        });
        const res = await run();
        assert.equal(res.data.ok, true, res.data.error);
        assert.equal(res.data.summary.stock.zeroedRows, 1);
        const gone = await inv(b2.id, sku1.id);
        assert.deepEqual(
          [gone.erpReady, gone.erpTransfer, gone.erpAsOf.toISOString()],
          [0, 0, newer.toISOString()],
        );
        // the report (older than the new snapshot) no longer applies; the 'held' session is still promised
        assert.equal((await staffSku(P1)).stock, 2);
      },
    );

    await t.test(
      'a snapshot that lost half of the stocked SKUs, or that is older than the stored one, is refused unless forced',
      async () => {
        for (let k = 0; k < 22; k += 1)
          await insert(part(`bulk${k}`), B1, 'ready', 1, {
            cat: 'Accessories',
            subcat: 'Case',
            snap: new Date(Date.now() - 1000),
          });
        assert.equal((await run()).data.ok, true);
        assert.ok(
          (
            await db.branchInventory.findMany({
              where: { erpReady: { not: null } },
              distinct: ['skuId'],
            })
          ).length >= 24,
        );
        await stub.query(
          `DELETE FROM mart.stock_mv WHERE product_model NOT IN ($1,$2)`,
          [P1, P2],
        );
        await stub.query(`UPDATE mart.stock_mv SET snapshot_at = $1`, [
          new Date(),
        ]);
        let res = await run();
        assert.equal(res.data.ok, false);
        assert.match(
          res.data.error,
          /ยกเลิกเพื่อความปลอดภัย.*part ที่ SES รู้จัก/,
        );
        res = await run('?force=true');
        assert.equal(res.data.ok, true, res.data.error);
        assert.ok(
          res.data.summary.stock.zeroedRows >= 22,
          JSON.stringify(res.data.summary.stock),
        );
        // a snapshot older than the one already stored is refused too
        await stub.query(`UPDATE mart.stock_mv SET snapshot_at = $1`, [
          new Date(Date.now() - 6 * 3600_000),
        ]);
        res = await run();
        assert.equal(res.data.ok, false);
        assert.match(res.data.error, /เก่ากว่าที่ SES เก็บไว้/);
        await stub.query(`UPDATE mart.stock_mv SET snapshot_at = $1`, [
          new Date(),
        ]);
      },
    );

    await t.test(
      'an unreachable warroom fails the run without touching data or leaking the url',
      async () => {
        const previous = process.env.WARROOM_DATABASE_URL;
        process.env.WARROOM_DATABASE_URL =
          'postgres://npi_reader:topsecret@127.0.0.1:1/nope';
        const before = await inv(b1.id, sku1.id);
        const res = await run();
        process.env.WARROOM_DATABASE_URL = previous;
        assert.equal(res.data.ok, false);
        assert.ok(!JSON.stringify(res.data).includes('topsecret'));
        assert.deepEqual((await inv(b1.id, sku1.id)).erpAsOf, before.erpAsOf);
      },
    );

    await t.test(
      'tick() processes a new snapshot once, however often it is asked',
      async () => {
        const snap = new Date(Date.now() + 5000); // newer than anything stored
        await stub.query(`UPDATE mart.stock_mv SET snapshot_at = $1`, [snap]);
        await svc.tick();
        const slot = `snap-${snap.toISOString()}`;
        const runs = () =>
          db.erpSyncRun.findMany({ where: { kind: 'warroom-products', slot } });
        const first = await runs();
        assert.equal(first.length, 1);
        assert.equal(first[0].trigger, 'schedule');
        assert.equal(first[0].ok, true, first[0].error);
        await svc.tick();
        await svc.tick();
        assert.equal((await runs()).length, 1);
        assert.equal(
          (await inv(b1.id, sku1.id)).erpAsOf.toISOString(),
          snap.toISOString(),
        );
      },
    );

    await t.test('mode off refuses manual runs', async () => {
      process.env.WARROOM_STOCK_MODE = 'off';
      assert.equal(
        (
          await request(
            '/admin/warroom-sync/run',
            'POST',
            undefined,
            adminCookie,
          )
        ).status,
        400,
      );
      process.env.WARROOM_STOCK_MODE = 'on';
    });
  } finally {
    const skuCodes = await db.productSku.findMany({
      where: { sku: { startsWith: prefix } },
      select: {
        id: true,
        modelId: true,
        model: { select: { productId: true } },
      },
    });
    const staffIds = [adminId, staffId];
    await db.customerSession.deleteMany({
      where: { reference: { startsWith: prefix } },
    });
    await db.branchInventory.deleteMany({
      where: { skuId: { in: skuCodes.map((s) => s.id) } },
    });
    await db.productSku.deleteMany({
      where: { id: { in: skuCodes.map((s) => s.id) } },
    });
    await db.productModel.deleteMany({
      where: { id: { in: [...new Set(skuCodes.map((s) => s.modelId))] } },
    });
    await db.product.deleteMany({
      where: {
        id: { in: [...new Set(skuCodes.map((s) => s.model.productId))] },
      },
    });
    await db.loginSession.deleteMany({ where: { staffId: { in: staffIds } } });
    await db.staffRole.deleteMany({ where: { staffId: { in: staffIds } } });
    await db.staff.deleteMany({ where: { staffId: { in: staffIds } } });
    await db.branch.deleteMany({ where: { code: { startsWith: prefix } } });
    await db.erpSyncRun.deleteMany({ where: { kind: 'warroom-products' } });
    await stub
      .query('DROP TABLE IF EXISTS mart.stock_mv')
      .catch(() => undefined);
    await stub.end().catch(() => undefined);
    await app.close();
  }
});
