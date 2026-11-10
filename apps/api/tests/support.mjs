// Shared harness for the real-database workflow tests: boots the Nest app against the isolated
// `service_efficiency_test` database, seeds a branch world with one account per role, and cleans up after itself.
// (The older test files keep their own copies; new workflow tests import this one.)
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.test', override: true });
const database = new URL(process.env.DATABASE_URL ?? 'mysql://invalid/invalid');
if (database.pathname !== '/service_efficiency_test') {
  throw new Error(
    'Integration tests require isolated service_efficiency_test database',
  );
}
const { createApplication } = await import('../dist/bootstrap.js');
const { PrismaService } = await import('../dist/prisma/prisma.service.js');
const { hashPassword } = await import('../dist/accounts/password.js');

export const PASSWORD = 'Support-test-1234';

/**
 * A unique made-up IMEI: 15 digits with a valid check digit (D124). `seedCatalog` makes iPhones, which carry an IMEI (D125).
 */
export function madeUpImei() {
  const body = `35${Array.from({ length: 12 }, () => Math.floor(Math.random() * 10)).join('')}`;
  let sum = 0;
  for (let i = 0; i < body.length; i += 1) {
    let d = Number(body[body.length - 1 - i]);
    if (i % 2 === 0) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return body + String((10 - (sum % 10)) % 10);
}

/**
 * Unique made-up serial numbers for the items of a session: exactly `quantity` per item, of the kind the product carries (D125):
 * an IMEI for an iPhone (the test catalog) or a cellular iPad / Watch, a serial starting with a letter for the others.
 */
export function madeUpSerials(items) {
  return items.map((item) => {
    const product = item.sku?.model?.product;
    const category = (product?.category ?? 'iPhone').toLowerCase();
    const cellular = [product?.name, item.sku?.model?.name, item.sku?.name].some((n) => /cell/i.test(n ?? ''));
    const imei = category === 'iphone' || ((category === 'ipad' || category === 'watch') && cellular) || !['mac', 'ipad', 'watch'].includes(category);
    return {
      itemId: item.id,
      sn: Array.from({ length: item.quantity }, () => (imei ? madeUpImei() : `T${randomUUID().replace(/-/g, '').slice(0, 11).toUpperCase()}`)),
    };
  });
}

/** Starts the API on a random port. Returns null (and skips `t`) when the database server is not reachable. */
export async function startApi(t) {
  let app;
  try {
    app = await createApplication();
    app.useLogger(process.env.TEST_LOG ? ['error'] : false); // TEST_LOG=1 shows server-side errors
    await app.listen(0, '127.0.0.1');
  } catch (err) {
    if (
      err &&
      (err.name === 'PrismaClientInitializationError' ||
        String(err).includes("Can't reach database server"))
    ) {
      t.skip(
        'Database server not reachable, skipping live MySQL integration test',
      );
      return null;
    }
    throw err;
  }
  const base = await app.getUrl();
  const request = async (path, method = 'GET', body, cookie = '') => {
    // D92: a `send` step carries the serial numbers STOCK scanned. Tests that are not about serials get some made up here;
    // a test that sends its own `serials` (even an empty list) gets exactly what it sent, and so does an order on which STOCK
    // already scanned serials one by one (D101: `send` then uses those).
    const stepOf = /^\/sessions\/([^/]+)\/step$/.exec(path);
    if (method === 'POST' && stepOf && body?.action === 'send' && body.serials === undefined) {
      const session = await request(`/sessions/${stepOf[1]}`, 'GET', undefined, cookie);
      if (session.status === 200 && Array.isArray(session.data?.items) && !session.data.items.some((i) => i.serials?.length))
        body = { ...body, serials: madeUpSerials(session.data.items) };
    }
    const response = await fetch(`${base}/api${path}`, {
      method,
      headers: {
        Origin: 'http://localhost:5174',
        'X-Requested-With': 'ServiceEfficiency',
        'Content-Type': 'application/json',
        Cookie: cookie,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return {
      status: response.status,
      data: await response.json().catch(() => null),
      cookie: response.headers.get('set-cookie')?.split(';')[0] ?? '',
    };
  };
  return {
    app,
    db: app.get(PrismaService),
    request,
    get: (token) => app.get(token),
    stop: () => app.close(),
  };
}

/**
 * Two branches (a, b), an ADMIN and, in branch a, one account per workflow role (STAFF, STOCK, CASHIER, MANAGER),
 * plus a STAFF in branch b. Everything is named after a random prefix so `cleanup` removes exactly what it made.
 * `cookies.<name>` are ready-to-send session cookies.
 */
export async function seedWorld(ctx) {
  const { db, request } = ctx;
  const prefix = `t-${randomUUID().slice(0, 8)}`;
  const branches = {};
  for (const key of ['a', 'b']) {
    branches[key] = await db.branch.create({
      data: { code: `${prefix}-${key}`, name: `สาขา ${key}`, phone: '' },
    });
  }
  const accounts = {
    admin: { roles: ['ADMIN'], branch: null },
    staff: { roles: ['STAFF'], branch: 'a' },
    stock: { roles: ['STOCK'], branch: 'a' },
    cashier: { roles: ['CASHIER'], branch: 'a' },
    manager: { roles: ['MANAGER'], branch: 'a' },
    staffB: { roles: ['STAFF'], branch: 'b' },
  };
  const passwordHash = await hashPassword(PASSWORD);
  const cookies = {};
  const staffIds = {};
  for (const [name, { roles, branch }] of Object.entries(accounts)) {
    const staffId = `${prefix}-${name}`;
    staffIds[name] = staffId;
    await db.staff.create({
      data: {
        staffId,
        passwordHash,
        mustChangePassword: false,
        branchId: branch ? branches[branch].id : null,
        roles: { create: roles.map((roleCode) => ({ roleCode })) },
      },
    });
    const login = await request('/auth/login', 'POST', {
      staffId,
      password: PASSWORD,
    });
    // D105: a cashier-only account has nothing in SES any more (the cashiers work in U POS): it cannot sign in
    if (roles.every((role) => role === 'CASHIER')) {
      assert.equal(login.status, 403, `login ${name}`);
      continue;
    }
    assert.equal(login.status, 201, `login ${name}`);
    cookies[name] = login.cookie;
  }
  return { prefix, branches, cookies, staffIds };
}

/**
 * Removes everything `seedWorld` and the tests created (sessions cascade their children and events), then stops the app.
 * The app is stopped even when a delete fails: a running Nest app keeps the test process alive for ever.
 */
export async function cleanup(ctx, world) {
  const { db } = ctx;
  try {
    if (!world) return;
    const branchIds = Object.values(world.branches).map((b) => b.id);
    const staffIds = Object.values(world.staffIds);
    await db.customerSession.deleteMany({
      where: { branchId: { in: branchIds } },
    });
    await db.dailyCounter.deleteMany({
      where: {
        OR: branchIds.map((id) => ({ scope: { startsWith: `queue:${id}` } })),
      },
    });
    // catalog rows a test made (named after the prefix); sessions are gone, so nothing references them any more
    await db.branchInventory.deleteMany({
      where: { sku: { sku: { startsWith: world.prefix } } },
    });
    await db.branchInventory.deleteMany({
      where: { branchId: { in: branchIds } },
    });
    await db.productSku.deleteMany({
      where: { sku: { startsWith: world.prefix } },
    });
    await db.productModel.deleteMany({
      where: { name: { startsWith: world.prefix } },
    });
    await db.product.deleteMany({
      where: { name: { startsWith: world.prefix } },
    });
    await db.category.deleteMany({
      where: { name: { startsWith: world.prefix } },
    });
    await db.setting.deleteMany({ where: { name: 'stockUnlimited' } });
    await db.paymentMethod.deleteMany({
      where: { name: { startsWith: world.prefix } },
    });
    await db.loginSession.deleteMany({ where: { staffId: { in: staffIds } } });
    await db.staffRole.deleteMany({ where: { staffId: { in: staffIds } } });
    await db.staff.deleteMany({ where: { staffId: { in: staffIds } } });
    await db.branch.deleteMany({ where: { id: { in: branchIds } } });
    await db.customerType.deleteMany({
      where: { name: { startsWith: world.prefix } },
    });
    await db.customer.deleteMany({
      where: { phone: { startsWith: '09999' }, sessions: { none: {} } },
    });
  } finally {
    await ctx.stop();
  }
}

/** One product with `count` SKUs (named after the world's prefix) and `stock` units of each at branch a. */
export async function seedCatalog(ctx, world, count = 2, stock = 5) {
  const { db } = ctx;
  const { prefix, branches } = world;
  const product = await db.product.create({
    data: {
      category: 'iPhone',
      name: `${prefix} Phone`,
      models: {
        create: {
          name: `${prefix} Model`,
          skus: {
            create: Array.from({ length: count }, (_, i) => ({
              sku: `${prefix}-S${i + 1}`,
              name: `${prefix} S${i + 1} 128GB`,
              color: 'Black',
              storage: '128GB',
            })),
          },
        },
      },
    },
    include: { models: { include: { skus: true } } },
  });
  const skus = product.models[0].skus.sort((x, y) =>
    x.sku.localeCompare(y.sku),
  );
  for (const sku of skus)
    await db.branchInventory.create({
      data: { branchId: branches.a.id, skuId: sku.id, stock, active: true },
    });
  return skus;
}

/** D125: moves the product of these SKUs to another category (e.g. 'Mac', whose units carry a serial starting with a letter). */
export async function setCategory(ctx, skus, category) {
  const models = await ctx.db.productModel.findMany({ where: { skus: { some: { id: { in: skus.map((x) => x.id) } } } }, select: { productId: true } });
  await ctx.db.product.updateMany({ where: { id: { in: [...new Set(models.map((m) => m.productId))] } }, data: { category } });
}

/**
 * The steps of the happy path in order (D68: starts at product selection), with the role that performs each one. D105: after
 * "send" the till is U POS (it reports the bill and the payment); `complete` here is ADMIN's fallback.
 */
export const PATH = [
  ['confirm', 'staff'],
  ['search', 'stock'],
  ['found', 'stock'],
  ['send', 'stock'],
  ['complete', 'admin'],
];
