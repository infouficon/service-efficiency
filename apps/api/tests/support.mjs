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
        OR: branchIds.map((id) => ({ scope: { startsWith: `queue:${id}:` } })),
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
    await db.setting.deleteMany({ where: { name: 'stockUnlimited' } });
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
