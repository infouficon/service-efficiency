import assert from 'node:assert/strict';
import { test } from 'node:test';
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
const { hashPassword, tokenHash, IDLE_MS } =
  await import('../dist/accounts/password.js');

test('real MySQL account, authorization and session lifecycle', async (t) => {
  let app;
  try {
    app = await createApplication();
    app.useLogger(false);
    await app.listen(0, '127.0.0.1');
  } catch (err) {
    if (err && (err.name === 'PrismaClientInitializationError' || String(err).includes("Can't reach database server"))) {
      t.skip('Database server not reachable, skipping live MySQL integration test');
      return;
    }
    throw err;
  }
  const base = await app.getUrl();
  const db = app.get(PrismaService);
  const prefix = `test-${randomUUID().slice(0, 8)}`;
  const id = (name) => `${prefix}-${name}`;
  const original = 'Test-initial-1234';
  const changed = 'Test-changed-1234';
  const branches = {};
  const branch = (name, active = true) => ({
    code: id(name),
    name,
    phone: '',
    active,
  });
  const account = (name, roles, branchId = null, active = true) => ({
    staffId: id(name),
    password: original,
    roles,
    branchId,
    active,
  });
  const update = (roles, branchId = null, active = true) => ({
    roles,
    branchId,
    active,
  });
  const request = async (
    path,
    method = 'GET',
    body,
    cookie = '',
    origin = 'http://localhost:5174',
  ) => {
    const response = await fetch(`${base}/api${path}`, {
      method,
      headers: {
        Origin: origin,
        'X-Requested-With': 'ServiceEfficiency',
        'Content-Type': 'application/json',
        Cookie: cookie,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return {
      status: response.status,
      data: await response.json(),
      cookie: response.headers.get('set-cookie')?.split(';')[0] ?? '',
      rawCookie: response.headers.get('set-cookie'),
    };
  };
  const login = (name, password = original) =>
    request('/auth/login', 'POST', { staffId: id(name), password });
  const setupLogin = async (name) => {
    const first = await login(name);
    assert.equal(first.status, 201);
    assert.equal(first.data.mustChangePassword, true);
    assert.equal(
      (
        await request(
          '/auth/password',
          'POST',
          { currentPassword: original, newPassword: changed },
          first.cookie,
        )
      ).status,
      201,
    );
    return (await login(name, changed)).cookie;
  };
  let admin;
  let manager;
  let staff;
  try {
    await db.staff.create({
      data: {
        staffId: id('admin'),
        passwordHash: await hashPassword(original),
        roles: { create: { roleCode: 'ADMIN' } },
      },
    });
    await t.test(
      'origin protection, forced password change, secure cookie attributes',
      async () => {
        assert.equal(
          (
            await request(
              '/auth/login',
              'POST',
              { staffId: id('admin'), password: original },
              '',
              'https://untrusted.invalid',
            )
          ).status,
          403,
        );
        const first = await login('admin');
        assert.equal(first.data.branchId, null);
        assert.match(first.rawCookie, /HttpOnly/);
        assert.match(first.rawCookie, /SameSite=Lax/i);
        assert.equal(
          (await request('/staff', 'GET', undefined, first.cookie)).status,
          403,
        );
        assert.equal(
          (
            await request(
              '/auth/password',
              'POST',
              { currentPassword: original, newPassword: 'short' },
              first.cookie,
            )
          ).status,
          400,
        );
        admin = await setupLogin('admin');
        assert.equal(
          (await request('/auth/me', 'GET', undefined, first.cookie)).status,
          401,
        );
        assert.equal((await login('admin')).status, 401);
      },
    );
    await t.test(
      'branch and role invariants; strict DTOs; no password leakage',
      async () => {
        for (const name of ['a', 'b']) {
          const created = await request(
            '/branches',
            'POST',
            branch(name),
            admin,
          );
          assert.equal(created.status, 201);
          branches[name] = created.data.id;
        }
        assert.equal(
          (await request('/staff', 'POST', account('bad', ['STAFF']), admin))
            .status,
          400,
        );
        assert.equal(
          (
            await request(
              '/staff',
              'POST',
              account('bad', ['ADMIN'], branches.a),
              admin,
            )
          ).status,
          400,
        );
        assert.equal(
          (
            await request(
              '/staff',
              'POST',
              account('bad', ['STAFF', 'STAFF'], branches.a),
              admin,
            )
          ).status,
          400,
        );
        assert.equal(
          (
            await request(
              '/staff',
              'POST',
              { ...account('bad', ['ADMIN']), unexpected: true },
              admin,
            )
          ).status,
          400,
        );
        for (const [name, roles, b] of [
          ['manager', ['MANAGER'], 'a'],
          ['staff', ['STAFF'], 'a'],
          ['other', ['CASHIER'], 'b'],
        ]) {
          assert.equal(
            (
              await request(
                '/staff',
                'POST',
                account(name, roles, branches[b]),
                admin,
              )
            ).status,
            201,
          );
        }
        assert.equal(
          (
            await request(
              '/staff',
              'POST',
              account('staff', ['STAFF'], branches.a),
              admin,
            )
          ).status,
          409,
        );
        const list = await request('/staff', 'GET', undefined, admin);
        assert.equal(list.status, 200);
        assert.ok(
          list.data.every(
            (row) => !('passwordHash' in row) && !('lockedUntil' in row),
          ),
        );
        manager = await setupLogin('manager');
        staff = await setupLogin('staff');
      },
    );
    await t.test(
      'manager own-branch scope; no higher grants; ordinary staff denied management',
      async () => {
        const list = await request('/staff', 'GET', undefined, manager);
        assert.ok(list.data.every((row) => row.branchId === branches.a));
        assert.equal(
          (await request('/staff', 'GET', undefined, staff)).status,
          403,
        );
        assert.equal(
          (
            await request(
              '/staff',
              'POST',
              account('local', ['STAFF', 'STOCK', 'CASHIER'], branches.a),
              manager,
            )
          ).status,
          201,
        );
        assert.equal(
          (
            await request(
              '/staff',
              'POST',
              account('higher', ['MANAGER'], branches.a),
              manager,
            )
          ).status,
          403,
        );
        assert.equal(
          (
            await request(
              `/staff/${id('other')}`,
              'PUT',
              update(['CASHIER'], branches.b),
              manager,
            )
          ).status,
          403,
        );
        assert.equal(
          (
            await request(
              `/staff/${id('staff')}`,
              'PUT',
              update(['STAFF'], branches.b),
              manager,
            )
          ).status,
          403,
        );
        assert.equal(
          (
            await request(
              `/staff/${id('manager')}`,
              'PUT',
              update(['STAFF'], branches.a),
              manager,
            )
          ).status,
          403,
        );
        assert.equal(
          (await request('/branches', 'POST', branch('forbidden'), manager))
            .status,
          403,
        );
        assert.equal(
          (
            await request(
              `/staff/${id('staff')}/reset-password`,
              'POST',
              { password: original },
              manager,
            )
          ).status,
          403,
        );
        assert.equal(
          (
            await request(
              `/branches/${branches.a}`,
              'PUT',
              branch('a', false),
              admin,
            )
          ).status,
          409,
        );
        assert.equal(
          (
            await request(
              `/staff/${id('staff')}`,
              'PUT',
              update(['STAFF', 'STOCK'], branches.b),
              admin,
            )
          ).status,
          200,
        );
        const me = await request('/auth/me', 'GET', undefined, staff);
        assert.equal(me.data.branchId, branches.b);
        assert.deepEqual(me.data.roles.sort(), ['STAFF', 'STOCK']);
      },
    );
    await t.test(
      'multiple devices; logout current device; server idle expiry',
      async () => {
        const second = (await login('staff', changed)).cookie;
        assert.equal(
          (await request('/auth/logout', 'POST', undefined, second)).status,
          201,
        );
        assert.equal(
          (await request('/auth/me', 'GET', undefined, second)).status,
          401,
        );
        assert.equal(
          (await request('/auth/me', 'GET', undefined, staff)).status,
          200,
        );
        const third = (await login('staff', changed)).cookie;
        await db.loginSession.update({
          where: { tokenHash: tokenHash(third.split('=')[1]) },
          data: { lastSeenAt: new Date(Date.now() - IDLE_MS - 1) },
        });
        assert.equal(
          (await request('/auth/me', 'GET', undefined, third)).status,
          401,
        );
        assert.equal(
          (await request('/auth/me', 'GET', undefined, staff)).status,
          200,
        );
      },
    );
    await t.test(
      'five failures lock one account for fifteen minutes',
      async () => {
        for (let n = 0; n < 5; n++)
          assert.equal((await login('other', 'wrong-password')).status, 401);
        const locked = await db.staff.findUniqueOrThrow({
          where: { staffId: id('other') },
        });
        assert.ok(locked.lockedUntil.getTime() - Date.now() > 14 * 60_000);
        assert.equal((await login('other')).status, 401);
        assert.equal((await login('staff', changed)).status, 201);
        await db.staff.update({
          where: { staffId: id('other') },
          data: { lockedUntil: new Date(Date.now() - 1) },
        });
        assert.equal((await login('other')).status, 201);
      },
    );
    await t.test(
      'reset and deactivation revoke every session; reset requires change',
      async () => {
        assert.equal(
          (
            await request(
              `/staff/${id('staff')}/reset-password`,
              'POST',
              { password: '123' },
              admin,
            )
          ).status,
          400,
        );
        assert.equal(
          (
            await request(
              `/staff/${id('staff')}/reset-password`,
              'POST',
              { password: original },
              admin,
            )
          ).status,
          201,
        );
        assert.equal(
          (await request('/auth/me', 'GET', undefined, staff)).status,
          401,
        );
        const reset = await login('staff');
        assert.equal(reset.data.mustChangePassword, true);
        assert.equal((await login('staff', changed)).status, 401);
        const second = (await login('staff')).cookie;
        assert.equal(
          (
            await request(
              `/staff/${id('staff')}`,
              'PUT',
              update(['STAFF'], branches.b, false),
              admin,
            )
          ).status,
          200,
        );
        for (const cookie of [reset.cookie, second])
          assert.equal(
            (await request('/auth/me', 'GET', undefined, cookie)).status,
            401,
          );
        assert.equal((await login('staff')).status, 401);
      },
    );
    await t.test(
      'last active ADMIN protected under simultaneous changes',
      async () => {
        assert.equal(
          (
            await request(
              `/staff/${id('admin')}`,
              'PUT',
              update(['ADMIN'], null, false),
              admin,
            )
          ).status,
          409,
        );
        assert.equal(
          (
            await request(
              `/staff/${id('admin')}`,
              'PUT',
              update(['STAFF'], branches.a),
              admin,
            )
          ).status,
          409,
        );
        assert.equal(
          (await request('/staff', 'POST', account('admin2', ['ADMIN']), admin))
            .status,
          201,
        );
        const admin2 = await setupLogin('admin2');
        const responses = await Promise.all([
          request(
            `/staff/${id('admin')}`,
            'PUT',
            update(['ADMIN'], null, false),
            admin,
          ),
          request(
            `/staff/${id('admin2')}`,
            'PUT',
            update(['ADMIN'], null, false),
            admin2,
          ),
        ]);
        assert.deepEqual(responses.map((r) => r.status).sort(), [200, 409]);
        assert.equal(
          await db.staff.count({
            where: {
              active: true,
              staffId: { startsWith: prefix },
              roles: { some: { roleCode: 'ADMIN' } },
            },
          }),
          1,
        );
      },
    );
  } finally {
    await db.loginSession.deleteMany({
      where: { staffId: { startsWith: prefix } },
    });
    await db.staffRole.deleteMany({
      where: { staffId: { startsWith: prefix } },
    });
    await db.staff.deleteMany({ where: { staffId: { startsWith: prefix } } });
    await db.branch.deleteMany({ where: { code: { startsWith: prefix } } });
    await app.close();
  }
});
