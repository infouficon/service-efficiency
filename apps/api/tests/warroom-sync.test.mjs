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

test('ERP category text maps to the Apple categories; accessories win; other brands get a category of their own', () => {
  const name = (v) => wr.mapCategory(v)?.name;
  assert.equal(name('iPhone'), 'iPhone');
  assert.equal(name('iPad'), 'iPad');
  assert.equal(name('MacBook Pro'), 'Mac');
  assert.equal(name('iMac'), 'Mac');
  assert.equal(name('Apple Watch'), 'Watch');
  assert.equal(name('Accessories'), 'Accessories');
  assert.equal(name('AirPods'), 'Accessories');
  assert.equal(name('iPhone Case'), 'Accessories');
  assert.equal(name('Apple Watch Band'), 'Accessories');
  assert.equal(name('Apple Accy'), 'Accessories', 'warroom abbreviates "Accessories"');
  assert.deepEqual(wr.mapCategory('Apple Accy'), {
    name: 'Accessories',
    isAccessory: true,
  });
  // other brands are never folded into an Apple category, even when a keyword would match
  assert.deepEqual(wr.mapCategory('HUAWEI Phone'), {
    name: 'HUAWEI Phone',
    isAccessory: false,
  });
  assert.deepEqual(wr.mapCategory('HUAWEI Accy'), {
    name: 'HUAWEI Accy',
    isAccessory: true,
  });
  assert.deepEqual(wr.mapCategory('Third Party Accy'), {
    name: 'Third Party Accy',
    isAccessory: true,
  });
  assert.deepEqual(wr.mapCategory('HUAWEI Watch'), {
    name: 'HUAWEI Watch',
    isAccessory: false,
  });
  assert.deepEqual(wr.mapCategory('  Something New  '), {
    name: 'Something New',
    isAccessory: false,
  });
  assert.equal(wr.mapCategory(''), null);
  assert.equal(wr.mapCategory('   '), null);
  assert.equal(wr.mapCategory(null), null);
});

test('capacity is taken out of model names so one model has several capacities; only the part\'s own capacity goes (D78)', () => {
  assert.equal(wr.withoutCapacity('iPhone 18 Pro Max 1TB', '1TB'), 'iPhone 18 Pro Max');
  assert.equal(wr.withoutCapacity('iPhone 15 128GB', '128GB'), 'iPhone 15');
  assert.equal(wr.withoutCapacity('iPhone 15 128 GB', '128GB'), 'iPhone 15');
  assert.equal(wr.withoutCapacity('iPad Air 11" (M2) - 256GB', '256GB'), 'iPad Air 11" (M2)');
  assert.equal(
    wr.withoutCapacity('MacBook Air 13" 16GB 512GB', '512GB'),
    'MacBook Air 13" 16GB',
    'the memory stays',
  );
  assert.equal(wr.withoutCapacity('iPhone 15', '128GB'), 'iPhone 15');
  assert.equal(wr.withoutCapacity('iPhone 15 1280GB', '128GB'), 'iPhone 15 1280GB', 'no partial numbers');
  assert.equal(wr.withoutCapacity('iPhone 15 128GB', null), 'iPhone 15 128GB');
  assert.equal(wr.withoutCapacity('128GB', '128GB'), '128GB', 'never an empty name');
  assert.equal(wr.withoutCapacity(null, '128GB'), null);
});

test('catalog: capacities share one model; batteries become the Battery category even under a device category (D78)', () => {
  const row = (partNo, o = {}) => ({
    branchCode: 'B',
    partNo,
    upc: 'u',
    productName: `Apple ${partNo} thing`,
    cat: 'iPhone',
    subcat: 'iPhone 18 Pro Max 1TB',
    subsubcat: null,
    capacity: '1TB',
    color: 'Blue',
    ready: 1,
    transfer: 0,
    snapshotAt: new Date(),
    ...o,
  });
  const { items, categories } = wr.buildCatalog([
    row('A/A'),
    row('B/A', { subcat: 'iPhone 18 Pro Max 512GB', capacity: '512GB' }),
    row('C/A', { subcat: 'Battery - iPhone 13', capacity: null, color: null }),
    row('D/A', { cat: 'Accessories', subcat: 'Battery Pack', capacity: null }),
    row('E/A', { cat: 'HUAWEI Phone', subcat: 'Battery - HUAWEI P60', capacity: null }),
    row('F/A', { cat: 'iPhone', subcat: 'iPhone 18', subsubcat: 'iPhone 18 256GB', capacity: '256GB' }),
  ]);
  const by = (p) => items.find((i) => i.partNo === p);
  assert.equal(by('A/A').productName, 'iPhone 18 Pro Max');
  assert.equal(by('B/A').productName, 'iPhone 18 Pro Max');
  assert.equal(by('A/A').modelName, by('B/A').modelName, 'one model, two capacities');
  assert.equal(by('A/A').storage, '1TB');
  assert.equal(by('B/A').storage, '512GB');
  assert.equal(by('F/A').modelName, 'iPhone 18');
  assert.equal(by('C/A').category, 'Battery');
  assert.equal(by('C/A').isAccessory, false);
  assert.equal(by('D/A').category, 'Battery', 'a battery pack is a battery too');
  assert.equal(by('E/A').category, 'HUAWEI Phone', 'another brand keeps its own category');
  assert.ok(categories.some((c) => c.value === 'iPhone' && c.mapped === 'iPhone'));
});

test('Mac names: memory read from "Ram 16", model name without RAM, capacity and layout marker (D79)', () => {
  assert.equal(wr.memoryOf('MacBook Air M5 13.6 Ram 16 512GB'), '16GB');
  assert.equal(wr.memoryOf('MacBook Pro M5 Pro 14.2 Ram 24 1TB'), '24GB');
  assert.equal(wr.memoryOf('x', 'MacBook Neo A18 Pro Ram 8 256GB Eng'), '8GB', 'first text that has one');
  assert.equal(wr.memoryOf('Mac mini 16GB RAM'), '16GB');
  assert.equal(wr.memoryOf('iPhone 18 Pro Max 1TB'), null);
  assert.equal(wr.memoryOf(null, undefined), null);
  const name = (n, cap) => wr.modelNameOf(n, cap);
  assert.equal(name('Macbook Air M5 13.6 Ram 16 512GB', '512GB'), 'Macbook Air M5 13.6');
  assert.equal(name('MACBOOK AIR M5 13.6 Ram 16 512GB Eng', '512GB'), 'MACBOOK AIR M5 13.6');
  assert.equal(name('MacBook Pro M5 Pro 14.2 Ram 24 1TB', '1TB'), 'MacBook Pro M5 Pro 14.2');
  assert.equal(name('MacBook Neo A18 Pro Ram 8 256GB', '256GB'), 'MacBook Neo A18 Pro');
  assert.equal(name('Mac mini M4', null), 'Mac mini M4');
  assert.equal(name('iMac 24 M4 (CTO)', null), 'iMac 24 M4 (CTO)');
  assert.equal(name('Connectivity Cards - MacBook Air (13-inch, 2017)', null), 'Connectivity Cards - MacBook Air (13-inch, 2017)');
});

test('Mac attributes: warroom\'s capacity is the RAM, so the storage is read from the names; the colour loses its capacity prefix (D80)', () => {
  const texts = ['MacBook Pro M5 14.2 Ram 24 1TB', 'MacBook Pro', 'Apple MDE34TH/A MacBook Pro 24GB 1TB SSD Space Black'];
  assert.equal(wr.storageOf(texts, '24GB', '24GB'), '1TB');
  assert.equal(wr.storageOf(['Macbook Air M5 13.6 Ram 16 512GB'], '16GB', '16GB'), '512GB');
  assert.equal(wr.storageOf(['Mac mini M4 Ram 16'], '16GB', '16GB'), null, 'no storage in the names: nothing, not the RAM');
  assert.equal(wr.storageOf(['iPhone 17 256GB'], null, '256GB'), '256GB', 'no memory: the capacity column as it is');
  assert.equal(wr.storageOf(['Mac Ram 16 512GB'], '16GB', '512GB'), '512GB');
  assert.equal(wr.colorOf('1TB SSD - Space Black'), 'Space Black');
  assert.equal(wr.colorOf('512GB SSD - Sky Blue'), 'Sky Blue');
  assert.equal(wr.colorOf('16GB/512GB - Silver'), 'Silver');
  assert.equal(wr.colorOf('Space Black'), 'Space Black');
  assert.equal(wr.colorOf('Deep Blue'), 'Deep Blue');
  assert.equal(wr.colorOf('1TB'), '1TB', 'never empty');
  assert.equal(wr.colorOf(null), null);
  assert.equal(wr.colorOf('  '), null);
  const row = {
    branchCode: 'B', partNo: 'MDE34TH/A', upc: 'u',
    productName: texts[2], cat: 'Mac', subcat: 'MacBook Pro', subsubcat: texts[0],
    capacity: '24GB', color: '1TB SSD - Space Black', ready: 1, transfer: 0, snapshotAt: new Date(),
  };
  const { items } = wr.buildCatalog([row]);
  assert.equal(items[0].memory, '24GB');
  assert.equal(items[0].storage, '1TB');
  assert.equal(items[0].color, 'Space Black');
  assert.equal(items[0].modelName, 'MacBook Pro M5 14.2', 'the 1TB is gone from the model name too');
});

test('catalog: Mac variants share one model, with RAM and capacity of their own; case spellings are one model (D79)', () => {
  const row = (partNo, subsub, cap, color, o = {}) => ({
    branchCode: 'B',
    partNo,
    upc: 'u',
    productName: `Apple ${partNo} ${subsub} ${color}`,
    cat: 'Mac',
    subcat: 'MacBook Air',
    subsubcat: subsub,
    capacity: cap,
    color,
    ready: 1,
    transfer: 0,
    snapshotAt: new Date(),
    ...o,
  });
  const { items } = wr.buildCatalog([
    row('A/A', 'Macbook Air M5 13.6 Ram 16 512GB', '512GB', 'Sky Blue'),
    row('B/A', 'Macbook Air M5 13.6 Ram 16 1TB', '1TB', 'Sky Blue'),
    row('C/A', 'Macbook Air M5 13.6 Ram 24 1TB', '1TB', 'Midnight'),
    row('D/A', 'MACBOOK AIR M5 13.6 Ram 16 512GB Eng', '512GB', 'Sky Blue'),
    row('E/A', 'Macbook Air M5 15.3 Ram 16 512GB', '512GB', 'Silver'),
  ]);
  const by = (p) => items.find((i) => i.partNo === p);
  const models = new Set(items.map((i) => i.modelName));
  assert.deepEqual([...models].sort(), ['Macbook Air M5 13.6', 'Macbook Air M5 15.3']);
  assert.equal(by('A/A').memory, '16GB');
  assert.equal(by('C/A').memory, '24GB');
  assert.equal(by('B/A').storage, '1TB');
  assert.equal(by('D/A').modelName, 'Macbook Air M5 13.6', 'the all-caps spelling joins the mixed-case one');
  assert.equal(by('D/A').memory, '16GB');
  assert.match(by('D/A').skuName, /Eng/, 'the layout marker stays in the SKU name');
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

test('catalog: one item per part, hierarchy from sub-categories, only a part without any category text is skipped', () => {
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
    row('E/A', { cat: '', subcat: '' }),
  ]);
  assert.deepEqual(
    items.map((i) => [i.partNo, i.category, i.productName, i.modelName]),
    [
      ['A/A', 'iPhone', 'iPhone 17 Pro', 'iPhone 17 Pro'],
      ['B/A', 'Accessories', 'Case', 'Case'],
      ['C/A', 'Huawei Phone', 'iPhone 17 Pro', 'iPhone 17 Pro'],
      ['D/A', 'iPad', 'iPad Pro 11', 'iPad Pro 11'],
    ],
  );
  assert.equal(items[0].upc, 'u');
  assert.equal(items[0].skuName, 'thing 256GB Blue');
  assert.equal(items[0].storage, '256GB');
  assert.equal(items[1].color, null);
  assert.equal(skippedNoCategory, 1, 'only a part with no category text at all is skipped');
  assert.deepEqual(
    categories.find((c) => c.value === 'Huawei Phone'),
    { value: 'Huawei Phone', mapped: 'Huawei Phone', isAccessory: false, parts: 1 },
    'another brand keeps its own category and is not rescued by its model-looking sub-category',
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
  // `now` is fixed: the missing-report rule expires after OUT_OF_STOCK_HOURS, so the real clock must not decide this test
  const reportedAt = new Date('2026-10-12T05:30:00Z');
  assert.equal(
    products.availableUnits(
      { ...inv, outOfStockAt: reportedAt },
      new Map(),
      new Date('2026-10-12T06:00:00Z'),
    ),
    0,
  );
  assert.equal(
    products.availableUnits(
      { ...inv, outOfStockAt: reportedAt },
      new Map(),
      new Date('2026-10-12T12:00:00Z'),
    ),
    3,
    'a report older than 6 hours stops blocking the SKU',
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
  const pgUrl = new URL(PG_URL);
  if (
    !['127.0.0.1', 'localhost'].includes(pgUrl.hostname) ||
    pgUrl.pathname !== '/warroom_stub'
  )
    throw new Error(
      'the Postgres stub must be a local database named warroom_stub (the test drops and rewrites mart.stock_mv)',
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
  const HW_CAT = `${prefix} Huawei Phone`; // another brand: its own category, switched off until ADMIN opens it (D72)
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
    await insert(P3, B1, 'ready', 4, { cat: HW_CAT, subcat: null });
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
        'P2 only: P3 waits for its category to be opened, P4 exists only in a branch SES does not have',
      );
      assert.equal(s.catalog.skippedNoCategory, 0);
      assert.equal(s.catalog.waitingForCategory, 1, 'P3: its category is not switched on');
      assert.equal(s.catalog.newCategories, 1);
      assert.deepEqual(s.catalog.unmapped, []);
      assert.deepEqual(
        s.catalog.categories.find((c) => c.value === HW_CAT),
        { value: HW_CAT, mapped: HW_CAT, isAccessory: false, parts: 1, status: 'new' },
      );
      assert.equal(
        s.catalog.categories.find((c) => c.value === 'iPhone').status,
        'active',
      );
      assert.equal(
        await db.category.count({ where: { name: HW_CAT } }),
        0,
        'a dry run does not add the category',
      );
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
          'its category is switched off: no products yet',
        );
        const hw = await db.category.findUnique({ where: { name: HW_CAT } });
        assert.equal(hw.active, false, 'the new category starts switched off');
        assert.equal(hw.erpManaged, true);
        assert.equal(sku2.upc, `upc-${P2}`, 'the UPC is kept next to the part number');
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
              items: { create: { skuId: sku1.id, quantity: 1 } },
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

    await t.test(
      'opening the category creates its products on the next run; closing it hides them from staff (D72)',
      async () => {
        const hw = await db.category.findUnique({ where: { name: HW_CAT } });
        const names = async (path, cookie) =>
          (await request(path, 'GET', undefined, cookie)).data.map((c) => c.name);
        assert.ok(
          !(await names('/categories', staffCookie)).includes(HW_CAT),
          'staff only read the active categories',
        );
        const all = (
          await request('/categories?all=true', 'GET', undefined, adminCookie)
        ).data;
        assert.equal(all.find((c) => c.name === HW_CAT).productCount, 0);
        assert.equal(
          (
            await request(`/categories/${hw.id}`, 'PUT', { active: true }, staffCookie)
          ).status,
          403,
        );
        assert.equal(
          (
            await request(`/categories/${hw.id}`, 'PUT', { active: true }, adminCookie)
          ).status,
          200,
        );
        const res = await run();
        assert.equal(res.data.ok, true, res.data.error);
        assert.equal(res.data.summary.catalog.created, 1);
        assert.equal(res.data.summary.catalog.waitingForCategory, 0);
        const sku3 = await db.productSku.findUnique({
          where: { sku: P3 },
          include: { model: { include: { product: true } } },
        });
        created.skuIds.push(sku3.id);
        assert.equal(sku3.model.product.category, HW_CAT);
        assert.equal(sku3.upc, `upc-${P3}`);
        assert.equal((await staffSku(P3)).stock, 4, 'staff see it while its category is on');
        await request(`/categories/${hw.id}`, 'PUT', { active: false }, adminCookie);
        assert.equal(await staffSku(P3), null, 'switched off again: staff no longer see it');
        const admin = (
          await request('/products?admin=true', 'GET', undefined, adminCookie)
        ).data;
        assert.ok(
          admin.some((p) => p.category === HW_CAT),
          'the back office still sees it',
        );
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
      'a part warroom no longer lists at a reported branch becomes 0; a newer snapshot clears the missing-report override',
      async () => {
        const newer = new Date(Date.now() - 1000);
        await stub.query(
          `DELETE FROM mart.stock_mv WHERE product_model = $1 AND branch_code = $2`,
          [P1, B2],
        );
        // B2 stays in the snapshot (it still has P2), only P1 left it: warroom knows P1 and lists none at B2 -> 0
        await insert(P2, B2, 'ready', 1, {
          snap: newer,
          cat: 'Accessories',
          subcat: 'Case',
          cap: null,
          color: null,
        });
        await stub.query(`UPDATE mart.stock_mv SET snapshot_at = $1`, [newer]);
        await db.branchInventory.update({
          where: { branchId_skuId: { branchId: b1.id, skuId: sku1.id } },
          data: { outOfStockAt: new Date(newer.getTime() - 60_000) },
        });
        const res = await run();
        assert.equal(res.data.ok, true, res.data.error);
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
      'a snapshot that lost half of the stocked SKUs, or that is more than 24 h older than the stored one, is refused unless forced',
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
          new Date(Date.now() - 30 * 3600_000),
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
        const slot = { startsWith: `snap-${snap.toISOString()}` };
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

    const resetStub = async (snap) => {
      await stub.query('DELETE FROM mart.stock_mv');
      for (let i = 0; i < 3; i += 1) await insert(P1, B1, 'ready', 1, { snap });
      await insert(P1, B1, 'transfer', 1, { snap });
      await insert(P1, B2, 'ready', 2, { snap });
      await insert(P2, B1, 'ready', 5, {
        snap,
        cat: 'Accessories',
        subcat: 'Case',
        cap: null,
        color: null,
      });
      await insert(P3, B1, 'ready', 4, {
        snap,
        cat: 'Huawei Phone',
        subcat: null,
      });
      await insert(P4, BHO, 'ready', 9, { snap });
    };

    await t.test(
      'relabelled branch codes or a collapse of the ready units are refused; branches absent from a snapshot are not zeroed',
      async () => {
        await resetStub(new Date());
        assert.equal((await run('?force=true')).data.ok, true);
        await insert(P2, B2, 'ready', 30, {
          snap: new Date(),
          cat: 'Accessories',
          subcat: 'Case',
          cap: null,
          color: null,
        });
        assert.equal((await run('?force=true')).data.ok, true);
        const sku2 = await db.productSku.findUnique({ where: { sku: P2 } });
        assert.equal((await inv(b2.id, sku2.id)).erpReady, 30);
        // warroom renames its branch codes
        await stub.query(
          `UPDATE mart.stock_mv SET branch_code = 'ZZ-' || branch_code`,
        );
        let res = await run();
        assert.equal(res.data.ok, false);
        assert.match(res.data.error, /สาขาที่ SES รู้จัก/);
        res = await run('?force=true');
        assert.equal(res.data.ok, true, res.data.error);
        assert.equal(
          res.data.summary.stock.zeroedRows,
          0,
          'no SES branch was reported, so nothing is zeroed',
        );
        assert.equal(
          (await inv(b2.id, sku2.id)).erpReady,
          30,
          'a branch warroom did not report keeps its last numbers',
        );
        await stub.query(
          `UPDATE mart.stock_mv SET branch_code = substr(branch_code, 4)`,
        );
        // the same branches, but almost nothing ready
        await stub.query(
          `UPDATE mart.stock_mv SET qty = 0.2, snapshot_at = $1`,
          [new Date()],
        );
        res = await run();
        assert.equal(res.data.ok, false);
        assert.match(res.data.error, /พร้อมขายรวมลด/);
      },
    );

    await t.test(
      'a snapshot stamped in the future is refused unless forced',
      async () => {
        await resetStub(new Date(Date.now() + 3600_000));
        const res = await run();
        assert.equal(res.data.ok, false);
        assert.match(res.data.error, /อนาคต/);
        await resetStub(new Date());
        assert.equal((await run('?force=true')).data.ok, true);
      },
    );

    await t.test(
      'a hand-made SKU that warroom knows but does not list at a branch shows 0 there, not its manual stock',
      async () => {
        await resetStub(new Date());
        assert.equal((await run('?force=true')).data.ok, true);
        assert.equal(
          (await staffSku(P1)).stock,
          2,
          'B1 ready 3 minus the session SES promised',
        );
        await stub.query(
          `DELETE FROM mart.stock_mv WHERE product_model = $1 AND branch_code = $2`,
          [P1, B1],
        );
        await stub.query(`UPDATE mart.stock_mv SET snapshot_at = $1`, [
          new Date(),
        ]);
        const res = await run();
        assert.equal(res.data.ok, true, res.data.error);
        const row = await inv(b1.id, sku1.id);
        assert.deepEqual([row.erpReady, row.erpTransfer], [0, 0]);
        assert.equal((await staffSku(P1)).stock, 0);
        await db.branchInventory.update({
          where: { branchId_skuId: { branchId: b1.id, skuId: sku1.id } },
          data: { stock: 7 },
        });
      },
    );

    await t.test(
      'the 24 h reservation window starts at the (old) snapshot, and a missing-report override expires',
      async () => {
        const key = { branchId_skuId: { branchId: b1.id, skuId: sku1.id } };
        const old = new Date(Date.now() - 30 * 3600_000);
        await db.branchInventory.update({
          where: key,
          data: {
            erpReady: 2,
            erpTransfer: 0,
            erpAsOf: old,
            outOfStockAt: null,
          },
        });
        const stale = await db.customerSession.create({
          data: {
            reference: `${prefix}-stale`.slice(0, 32),
            branchId: b1.id,
            staffId,
            state: 'FOUND',
            items: { create: { skuId: sku1.id, quantity: 1 } },
            stockFoundAt: new Date(Date.now() - 26 * 3600_000),
          },
        });
        created.sessionIds.push(stale.id);
        const ids = await db.customerSession.findMany({
          where: {
            reference: { startsWith: prefix },
            state: 'FOUND',
            items: { some: { skuId: sku1.id } },
          },
          select: { id: true },
        });
        const open = ids.length; // the 'held' session of the earlier test plus this one
        assert.equal(
          (await staffSku(P1)).stock,
          Math.max(0, 2 - open),
          'both open sessions hold a unit of the 30 h old snapshot',
        );
        await db.customerSession.update({
          where: { id: stale.id },
          data: { outcome: 'CUSTOMER_CANCELLED' },
        });
        await db.customerSession.updateMany({
          where: { reference: { startsWith: prefix } },
          data: { outcome: 'CUSTOMER_CANCELLED' },
        });
        await db.branchInventory.update({
          where: key,
          data: {
            erpReady: 3,
            erpAsOf: new Date(Date.now() - 10 * 3600_000),
            outOfStockAt: new Date(Date.now() - 7 * 3600_000),
          },
        });
        assert.equal(
          (await staffSku(P1)).stock,
          3,
          'a report older than 6 h no longer blocks the SKU',
        );
        await db.branchInventory.update({
          where: key,
          data: { outOfStockAt: new Date(Date.now() - 3600_000) },
        });
        assert.equal((await staffSku(P1)).stock, 0, 'a fresh report does');
        await db.branchInventory.update({
          where: key,
          data: { outOfStockAt: null },
        });
      },
    );

    await t.test(
      'SKU codes are matched case-insensitively like MySQL does: no duplicate, no lost numbers',
      async () => {
        const ci = `${prefix}-ci/a`;
        const handCi = await db.product.create({
          data: {
            category: 'Accessories',
            name: 'hand ci',
            active: true,
            models: {
              create: {
                name: 'hand ci',
                active: true,
                skus: { create: { sku: ci, name: 'hand ci', active: true } },
              },
            },
          },
          include: { models: { include: { skus: true } } },
        });
        await resetStub(new Date());
        await insert(ci.toUpperCase(), B1, 'ready', 4, {
          snap: new Date(),
          cat: 'Accessories',
          subcat: 'Case',
          cap: null,
          color: null,
        });
        const res = await run('?force=true');
        assert.equal(res.data.ok, true, res.data.error);
        assert.equal(res.data.summary.catalog.collisions, 0);
        assert.equal(await db.productSku.count({ where: { sku: ci } }), 1);
        assert.equal(
          (await inv(b1.id, handCi.models[0].skus[0].id)).erpReady,
          4,
        );
      },
    );

    await t.test(
      'a run that is still going (here or in another container) blocks another one',
      async () => {
        const ghost = await db.erpSyncRun.create({
          data: {
            kind: 'warroom-products',
            slot: `snap-${prefix}-ghost`,
            trigger: 'schedule',
          },
        });
        assert.equal(
          (
            await request(
              '/admin/warroom-sync/run?dryRun=true',
              'POST',
              undefined,
              adminCookie,
            )
          ).status,
          409,
        );
        const before = await db.erpSyncRun.count({
          where: { kind: 'warroom-products' },
        });
        await stub.query(`UPDATE mart.stock_mv SET snapshot_at = $1`, [
          new Date(Date.now() + 1000),
        ]);
        await svc.tick();
        assert.equal(
          await db.erpSyncRun.count({ where: { kind: 'warroom-products' } }),
          before,
          'tick does nothing while another run is open',
        );
        await db.erpSyncRun.delete({ where: { id: ghost.id } });
      },
    );

    await t.test(
      'ERP-made SKUs are re-filed when the rules change: capacities merge into one model, a battery leaves iPhone (D78)',
      async () => {
        process.env.WARROOM_STOCK_MODE = 'on';
        const P5 = part('CAP');
        const P6 = part('BAT');
        const oldCat = `${prefix} Phone`;
        await insert(P5, B1, 'ready', 2, { subcat: `${oldCat} 256GB`, cap: '256GB' });
        await insert(P6, B1, 'ready', 2, { subcat: `Battery - ${prefix} 13`, cap: null, color: null });
        // the old shape the sync used to create: capacity inside the model name, the battery under iPhone
        const old = async (code, name, category) =>
          db.product.create({
            data: {
              category,
              name,
              erpManaged: true,
              models: {
                create: {
                  name,
                  erpManaged: true,
                  skus: { create: { sku: code, name: 'x', erpManaged: true } },
                },
              },
            },
            include: { models: { include: { skus: true } } },
          });
        const oldCap = await old(P5, `${oldCat} 256GB`, 'iPhone');
        const oldBat = await old(P6, `Battery - ${prefix} 13`, 'iPhone');
        created.skuIds.push(oldCap.models[0].skus[0].id, oldBat.models[0].skus[0].id);
        const dry = await run('?dryRun=true');
        assert.equal(dry.data.summary.catalog.moved, 2, 'a dry run only reports it');
        assert.equal(
          (await db.productSku.findUnique({ where: { sku: P5 }, include: { model: true } })).model.name,
          `${oldCat} 256GB`,
        );
        const res = await run();
        assert.equal(res.data.ok, true, res.data.error);
        assert.equal(res.data.summary.catalog.moved, 2);
        const cap = await db.productSku.findUnique({
          where: { sku: P5 },
          include: { model: { include: { product: true } } },
        });
        assert.equal(cap.model.product.name, oldCat, 'capacity is gone from the product name');
        assert.equal(cap.model.name, oldCat);
        assert.equal(cap.model.product.category, 'iPhone');
        assert.equal(await db.product.count({ where: { id: oldCap.id } }), 0, 'the emptied old product is removed');
        const bat = await db.productSku.findUnique({
          where: { sku: P6 },
          include: { model: { include: { product: true } } },
        });
        assert.equal(bat.model.product.category, 'Battery');
        assert.equal(await db.product.count({ where: { id: oldBat.id } }), 0);
        const category = await db.category.findUnique({ where: { name: 'Battery' } });
        assert.equal(category.active, false, 'Battery starts switched off');
        assert.equal(await staffSku(P6), null, 'staff do not see batteries until the category is opened');
        assert.ok(await staffSku(P5), 'the phone is still there for staff');
        const again = await run();
        assert.equal(again.data.summary.catalog.moved, 0, 'a second run has nothing to move');
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
    await db.category.deleteMany({ where: { name: { startsWith: prefix } } });
    await db.category.deleteMany({ where: { name: 'Battery', erpManaged: true } });
    await db.erpSyncRun.deleteMany({ where: { kind: 'warroom-products' } });
    await stub
      .query('DROP TABLE IF EXISTS mart.stock_mv')
      .catch(() => undefined);
    await stub.end().catch(() => undefined);
    await app.close();
  }
});
