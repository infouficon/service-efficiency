import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cleanup, seedWorld, startApi } from './support.mjs';

const audit = await import('../dist/accounts/staff-audit.js');

const state = (over = {}) => ({ firstName: 'ก', lastName: 'ข', roles: ['STAFF'], branchCode: 'B1', active: true, phone: null, ...over });

test('the audit helpers: only what changed, roles sorted, phone masked, wording by what matters most (D92)', () => {
  assert.equal(audit.maskedPhone('0812345678'), '******5678');
  assert.equal(audit.maskedPhone(null), null);
  assert.equal(audit.maskedPhone(''), null);
  assert.equal(audit.maskedPhone('123'), '***');
  assert.deepEqual(audit.accountChanges(state(), state()), {});
  assert.deepEqual(audit.accountChanges(state({ roles: ['STOCK', 'STAFF'] }), state({ roles: ['STAFF', 'STOCK'] })), {}, 'role order is not a change');
  assert.deepEqual(
    audit.accountChanges(state({ phone: '0812345678' }), state({ roles: ['ADMIN', 'STAFF'], branchCode: null, active: false, phone: '0899999999', firstName: 'ค' })),
    {
      firstName: { from: 'ก', to: 'ค' },
      roles: { from: ['STAFF'], to: ['ADMIN', 'STAFF'] },
      branch: { from: 'B1', to: null },
      active: { from: true, to: false },
      phone: { from: '******5678', to: '******9999' },
    },
  );
  assert.deepEqual(audit.accountStart(state({ phone: '0812345678' })).phone, { from: null, to: '******5678' });
  assert.equal(audit.staffAuditLabel('ACCOUNT_CREATED', {}), 'สร้างบัญชีผู้ใช้');
  assert.equal(audit.staffAuditLabel('ACCOUNT_UPDATED', { roles: { from: ['STAFF'], to: ['ADMIN'] } }), 'ให้สิทธิ์ ADMIN');
  assert.equal(audit.staffAuditLabel('ACCOUNT_UPDATED', { roles: { from: ['ADMIN'], to: ['STAFF'] } }), 'ถอนสิทธิ์ ADMIN');
  assert.equal(audit.staffAuditLabel('ACCOUNT_UPDATED', { active: { from: true, to: false } }), 'ปิดใช้งานบัญชี');
  assert.equal(audit.staffAuditLabel('ACCOUNT_UPDATED', { active: { from: false, to: true } }), 'เปิดใช้งานบัญชีอีกครั้ง');
  assert.equal(audit.staffAuditLabel('ACCOUNT_UPDATED', { branch: { from: 'a', to: 'b' }, phone: { from: null, to: 'x' } }), 'แก้ไขบัญชีผู้ใช้ (สาขา, เบอร์โทร)');
  assert.equal(audit.staffAuditLabel('SOMETHING_ELSE', null), 'SOMETHING_ELSE');
});

test('who created or changed an account is written down, with what changed and never a secret (D92)', async (t) => {
  const ctx = await startApi(t);
  if (!ctx) return;
  const { db, request } = ctx;
  let world;
  const erpNo = 700_000_000 + Math.floor(Math.random() * 90_000_000);
  try {
    world = await seedWorld(ctx);
    const { cookies, prefix, branches, staffIds } = world;
    const id = (n) => `${prefix}-${n}`;
    const SECRET1 = 'Sup3r-secret-pw-1';
    const SECRET2 = 'An0ther-secret-pw-2';
    const SECRET3 = 'Third-secret-pw-3';
    const rows = (where = {}) =>
      db.staffAudit.findMany({
        where: { OR: [{ targetStaffId: { startsWith: prefix } }, { actorStaffId: { startsWith: prefix } }], ...where },
        orderBy: { createdAt: 'asc' },
      });
    const forTarget = (target, action) => rows({ targetStaffId: target, ...(action ? { action } : {}) });
    const app = (path, method, body, who) => request(path, method, body, cookies[who]);
    const newcomer = {
      staffId: id('new'),
      password: SECRET1,
      firstName: 'ใหม่',
      lastName: 'ทดสอบ',
      roles: ['STAFF'],
      branchId: branches.a.id,
      active: true,
      phone: '0812345678',
    };

    await t.test('a new account is written down with who made it, what it started with and the phone masked', async () => {
      const refused = await app('/staff', 'POST', { ...newcomer, staffId: id('nope'), roles: ['ADMIN'], branchId: null }, 'manager');
      assert.equal(refused.status, 403, 'a manager cannot make an ADMIN');
      assert.equal((await forTarget(id('nope'))).length, 0, 'a refused change leaves no row');

      const res = await app('/staff', 'POST', newcomer, 'admin');
      assert.equal(res.status, 201, JSON.stringify(res.data));
      const [row] = await forTarget(id('new'));
      assert.equal(row.actorStaffId, staffIds.admin);
      assert.equal(row.action, 'ACCOUNT_CREATED');
      assert.equal(row.via, 'form');
      assert.deepEqual(row.changes.roles, { from: null, to: ['STAFF'] });
      assert.deepEqual(row.changes.branch, { from: null, to: branches.a.code });
      assert.deepEqual(row.changes.phone, { from: null, to: '******5678' });
      assert.deepEqual(row.changes.active, { from: null, to: true });

      const byManager = await app('/staff', 'POST', { ...newcomer, staffId: id('mgr'), phone: undefined }, 'manager');
      assert.equal(byManager.status, 201, JSON.stringify(byManager.data));
      assert.equal((await forTarget(id('mgr')))[0].actorStaffId, staffIds.manager, 'whoever did it, not only ADMIN');
    });

    await t.test('an update keeps only the fields that changed (phone masked); a save that changes nothing leaves no row', async () => {
      const before = (await forTarget(id('new'))).length;
      const same = await app(`/staff/${id('new')}`, 'PUT', { firstName: 'ใหม่', lastName: 'ทดสอบ', roles: ['STAFF'], branchId: branches.a.id, active: true }, 'admin');
      assert.equal(same.status, 200, JSON.stringify(same.data));
      assert.equal((await forTarget(id('new'))).length, before, 'nothing changed, nothing written');

      const res = await app(`/staff/${id('new')}`, 'PUT', { firstName: 'ใหม่', lastName: 'ทดสอบ', roles: ['STAFF', 'CASHIER'], branchId: branches.a.id, active: true, phone: '0899999999' }, 'admin');
      assert.equal(res.status, 200, JSON.stringify(res.data));
      const row = (await forTarget(id('new'), 'ACCOUNT_UPDATED')).at(-1);
      assert.deepEqual(Object.keys(row.changes).sort(), ['phone', 'roles']);
      assert.deepEqual(row.changes.roles, { from: ['STAFF'], to: ['CASHIER', 'STAFF'] });
      assert.deepEqual(row.changes.phone, { from: '******5678', to: '******9999' });
      assert.equal(row.actorStaffId, staffIds.admin);
    });

    await t.test('granting and taking back ADMIN, and switching an account off, are written down and worded on the audit page', async () => {
      const put = (body) => app(`/staff/${id('new')}`, 'PUT', { firstName: 'ใหม่', lastName: 'ทดสอบ', ...body }, 'admin');
      assert.equal((await put({ roles: ['ADMIN'], branchId: null, active: true })).status, 200);
      assert.equal((await put({ roles: ['STAFF'], branchId: branches.a.id, active: true })).status, 200);
      assert.equal((await put({ roles: ['STAFF'], branchId: branches.a.id, active: false })).status, 200);
      assert.equal((await put({ roles: ['STAFF'], branchId: branches.a.id, active: true })).status, 200);
      const page = await app('/admin/audit-logs?limit=500', 'GET', undefined, 'admin');
      assert.equal(page.status, 200);
      const labels = page.data.filter((i) => i.category === 'ACCOUNT' && i.targetStaffId === id('new')).map((i) => i.actionLabel);
      for (const wanted of ['สร้างบัญชีผู้ใช้', 'ให้สิทธิ์ ADMIN', 'ถอนสิทธิ์ ADMIN', 'ปิดใช้งานบัญชี', 'เปิดใช้งานบัญชีอีกครั้ง', 'แก้ไขบัญชีผู้ใช้ (บทบาท, เบอร์โทร)'])
        assert.ok(labels.includes(wanted), `${wanted} in ${JSON.stringify(labels)}`);
    });

    await t.test('a password reset and a password change are written down without any password', async () => {
      const reset = await app(`/staff/${id('new')}/reset-password`, 'POST', { password: SECRET2 }, 'admin');
      assert.equal(reset.status, 201, JSON.stringify(reset.data));
      const [row] = await forTarget(id('new'), 'ACCOUNT_PASSWORD_RESET');
      assert.equal(row.actorStaffId, staffIds.admin);
      assert.equal(row.changes, null);
      const login = await request('/auth/login', 'POST', { staffId: id('new'), password: SECRET2 });
      assert.equal(login.status, 201, JSON.stringify(login.data));
      const change = await request('/auth/password', 'POST', { currentPassword: SECRET2, newPassword: SECRET3 }, login.cookie);
      assert.equal(change.status, 201, JSON.stringify(change.data));
      const [own] = await forTarget(id('new'), 'ACCOUNT_PASSWORD_CHANGED');
      assert.equal(own.actorStaffId, id('new'));
      assert.equal(own.via, 'self');
      const everything = JSON.stringify(await db.staffAudit.findMany({ where: { OR: [{ targetStaffId: { startsWith: prefix } }, { actorStaffId: { startsWith: prefix } }] } }));
      for (const secret of [SECRET1, SECRET2, SECRET3, '0812345678', '0899999999', 'scrypt'])
        assert.ok(!everything.includes(secret), `the trail never holds ${secret.slice(0, 6)}…`);
    });

    await t.test('exporting the staff list is written down (who took the personal data out), only for ADMIN', async () => {
      for (const who of ['staff', 'manager']) assert.equal((await app('/staff/export', 'GET', undefined, who)).status, 403, who);
      assert.equal((await rows({ action: 'ACCOUNTS_EXPORTED', actorStaffId: staffIds.manager })).length, 0, 'a refused export leaves no row');
      const res = await app('/staff/export', 'GET', undefined, 'admin');
      assert.equal(res.status, 200);
      const row = (await rows({ action: 'ACCOUNTS_EXPORTED' })).at(-1);
      assert.equal(row.actorStaffId, staffIds.admin);
      assert.equal(row.targetStaffId, null);
      assert.equal(row.changes.count, res.data.rows.length);
    });

    await t.test('the spreadsheet import writes one row per account it creates or changes, and a dry run or a failed file writes none', async () => {
      const post = (list, dryRun = false) => app('/staff/import', 'POST', { rows: list, dryRun }, 'admin');
      const fresh = { staffId: id('imp'), firstName: 'นำเข้า', lastName: 'ทดสอบ', branchCode: branches.a.code, roles: 'STAFF', active: true, phone: '081-111-2222' };
      const count = async () => (await rows({ via: 'import' })).length;
      assert.equal((await post([fresh], true)).data.applied, false);
      assert.equal(await count(), 0, 'a dry run writes nothing');
      const failed = await post([fresh, { staffId: id('imp2'), roles: 'NOT-A-ROLE' }]);
      assert.equal(failed.data.applied, false);
      assert.equal(failed.data.summary.errors, 1);
      assert.equal(await count(), 0, 'one bad row rolls the whole file back, rows included');
      assert.equal(await db.staff.count({ where: { staffId: id('imp') } }), 0);

      const done = await post([fresh, { staffId: id('mgr'), lastName: 'แก้ด้วยไฟล์' }]);
      assert.equal(done.data.applied, true, JSON.stringify(done.data));
      const imported = await rows({ via: 'import' });
      assert.deepEqual(imported.map((r) => [r.action, r.targetStaffId]).sort(), [['ACCOUNT_CREATED', id('imp')], ['ACCOUNT_UPDATED', id('mgr')]].sort());
      assert.ok(imported.every((r) => r.actorStaffId === staffIds.admin));
      assert.deepEqual(imported.find((r) => r.action === 'ACCOUNT_UPDATED').changes.lastName, { from: 'ทดสอบ', to: 'แก้ด้วยไฟล์' });
      assert.deepEqual(imported.find((r) => r.action === 'ACCOUNT_CREATED').changes.phone, { from: null, to: '******2222' });
    });

    await t.test('picking an ERP person by hand, changing the pick and removing it are written down', async () => {
      const put = (roles) => app('/admin/erp-sync/extras', 'PUT', { erpStaffId: erpNo, roles, branchId: branches.a.id }, 'admin');
      assert.equal((await put(['STAFF'])).status, 200);
      assert.equal((await put(['STAFF', 'STOCK'])).status, 200);
      assert.equal((await app(`/admin/erp-sync/extras/${erpNo}`, 'DELETE', undefined, 'admin')).status, 200);
      const trail = await db.staffAudit.findMany({ where: { targetStaffId: String(erpNo) }, orderBy: { createdAt: 'asc' } });
      assert.deepEqual(trail.map((r) => r.action), ['ERP_EXTRA_SET', 'ERP_EXTRA_SET', 'ERP_EXTRA_REMOVED']);
      assert.ok(trail.every((r) => r.via === 'erp-extras' && r.actorStaffId === staffIds.admin));
      assert.equal(trail[0].changes.replaced, false);
      assert.equal(trail[1].changes.replaced, true);
      assert.deepEqual(trail[1].changes.roles, { from: ['STAFF'], to: ['STAFF', 'STOCK'] });
      assert.equal(trail[0].changes.branch.to, branches.a.code);
    });

    await t.test('the audit page lists them as "ผู้ใช้" rows, newest first, with the account they are about; ADMIN only (D92)', async () => {
      for (const who of ['staff', 'manager']) assert.equal((await app('/admin/audit-logs', 'GET', undefined, who)).status, 403, who);
      const page = await app('/admin/audit-logs?limit=500', 'GET', undefined, 'admin');
      const items = page.data.filter((i) => i.category === 'ACCOUNT');
      assert.ok(items.length >= 10);
      const times = page.data.map((i) => new Date(i.timestamp).getTime());
      assert.deepEqual(times, [...times].sort((a, b) => b - a), 'one list, newest first');
      const created = items.find((i) => i.action === 'ACCOUNT_CREATED' && i.targetStaffId === id('new'));
      assert.equal(created.actorStaffId, staffIds.admin);
      assert.equal(created.branchName, 'สาขา a', 'the branch of the account it is about');
      assert.equal(created.metadata.via, 'form');
      assert.deepEqual(created.metadata.changes.roles, { from: null, to: ['STAFF'] });
      assert.ok(created.id.startsWith('account-'));
      assert.ok(items.some((i) => i.action === 'ACCOUNTS_EXPORTED' && i.targetStaffId === undefined));
      assert.ok(page.data.some((i) => i.category !== 'ACCOUNT'), 'the other kinds of rows are still there');
    });
  } finally {
    await db.staffAudit.deleteMany({ where: { targetStaffId: String(erpNo) } });
    await db.erpExtraStaff.deleteMany({ where: { erpStaffId: erpNo } });
    if (world) {
      await db.loginSession.deleteMany({ where: { staffId: { startsWith: world.prefix } } });
      await db.staffRole.deleteMany({ where: { staffId: { startsWith: world.prefix } } });
      await db.staff.deleteMany({ where: { staffId: { startsWith: world.prefix } } });
    }
    await cleanup(ctx, world);
  }
});
