import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PASSWORD, cleanup, seedWorld, startApi } from './support.mjs';

const { rolesForPosition } = await import('../dist/erp/erp-sync.service.js');

test('the ERP import never gives CASHIER: a cashier position works the floor and the stock room like everyone (D105, D106)', () => {
  assert.deepEqual(rolesForPosition('Cashier'), ['STAFF', 'STOCK']);
  assert.deepEqual(rolesForPosition('Sale Consultant'), ['STAFF', 'STOCK']);
  assert.deepEqual(rolesForPosition('Stock'), ['STAFF', 'STOCK']);
  assert.deepEqual(rolesForPosition('Technician'), []);
});

test('the cashiers work in U POS: a cashier-only account cannot use SES, the role is never shown or given (D105)', async (t) => {
  const ctx = await startApi(t);
  if (!ctx) return;
  const { db, request } = ctx;
  let world;
  try {
    world = await seedWorld(ctx); // its cashier-only account is refused at sign-in (asserted in seedWorld)
    const { cookies, branches, prefix, staffIds } = world;
    const login = (staffId) => request('/auth/login', 'POST', { staffId, password: 'Test-password-123' });

    await t.test('sign-in says why; a wrong password still says nothing about the account', async () => {
      assert.equal((await request('/auth/login', 'POST', { staffId: staffIds.cashier, password: 'wrong-password' })).status, 401);
      const right = await request('/auth/login', 'POST', { staffId: staffIds.cashier, password: PASSWORD });
      assert.equal(right.status, 403);
      assert.match(right.data.message, /U POS/);
    });

    await t.test('an account with CASHIER and STAFF keeps STAFF; CASHIER is not shown', async () => {
      await db.staffRole.create({ data: { staffId: staffIds.staff, roleCode: 'CASHIER' } });
      const me = await request('/auth/me', 'GET', undefined, cookies.staff);
      assert.equal(me.status, 200, JSON.stringify(me.data));
      assert.deepEqual(me.data.roles ?? me.data.user?.roles, ['STAFF']);
      await db.staffRole.delete({ where: { staffId_roleCode: { staffId: staffIds.staff, roleCode: 'CASHIER' } } });
    });

    await t.test('a signed-in account that becomes cashier-only loses access at its next request', async () => {
      const staffId = `${prefix}-was-stock`;
      const { hashPassword } = await import('../dist/accounts/password.js');
      await db.staff.create({
        data: { staffId, passwordHash: await hashPassword('Test-password-123'), mustChangePassword: false, branchId: branches.a.id, roles: { create: [{ roleCode: 'STOCK' }] } },
      });
      const session = await login(staffId);
      assert.equal(session.status, 201, JSON.stringify(session.data));
      await db.staffRole.deleteMany({ where: { staffId } });
      await db.staffRole.create({ data: { staffId, roleCode: 'CASHIER' } });
      const next = await request('/sessions', 'GET', undefined, session.cookie);
      assert.equal(next.status, 401);
      await db.loginSession.deleteMany({ where: { staffId } });
      await db.staffRole.deleteMany({ where: { staffId } });
      await db.staff.delete({ where: { staffId } });
    });

    await t.test('ADMIN cannot give CASHIER any more', async () => {
      const res = await request('/staff', 'POST', { staffId: `${prefix}-new`, password: 'Test-password-123', roles: ['CASHIER'], branchId: branches.a.id }, cookies.admin);
      assert.equal(res.status, 400, JSON.stringify(res.data));
    });
  } finally {
    await cleanup(ctx, world);
  }
});
