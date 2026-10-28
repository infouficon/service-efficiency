import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cleanup, seedWorld, startApi } from './support.mjs';

const sheet = await import('../dist/accounts/staff-sheet.js');

test('staff spreadsheet helpers read cells the way people type them (D86)', () => {
  assert.equal(sheet.cellText('  x  '), 'x');
  assert.equal(sheet.cellText(''), undefined);
  assert.equal(sheet.cellText(null), undefined);
  assert.equal(sheet.cellText(812345678), '812345678');
  assert.deepEqual(sheet.parseRolesCell('staff, cashier;MANAGER'), ['STAFF', 'CASHIER', 'MANAGER']);
  assert.deepEqual(sheet.parseRolesCell('STAFF,STAFF'), ['STAFF']);
  assert.equal(sheet.parseRolesCell('STAFF,BOSS'), null);
  assert.equal(sheet.parseRolesCell(''), undefined);
  assert.equal(sheet.parseActiveCell(true), true);
  assert.equal(sheet.parseActiveCell('FALSE'), false);
  assert.equal(sheet.parseActiveCell('ปิดใช้งาน'), false);
  assert.equal(sheet.parseActiveCell('ใช้งาน'), true);
  assert.equal(sheet.parseActiveCell(''), undefined);
  assert.equal(sheet.parseActiveCell('maybe'), null);
  assert.deepEqual(sheet.parsePhoneCell(''), { kind: 'keep' });
  assert.deepEqual(sheet.parsePhoneCell('-'), { kind: 'clear' });
  assert.deepEqual(sheet.parsePhoneCell('081-234-5678'), { kind: 'set', phone: '0812345678' });
  assert.deepEqual(sheet.parsePhoneCell('+66 81 234 5678'), { kind: 'set', phone: '0812345678' });
  assert.deepEqual(sheet.parsePhoneCell(812345678), { kind: 'set', phone: '0812345678' }, 'Excel dropped the leading zero');
  assert.deepEqual(sheet.parsePhoneCell('021234567'), { kind: 'bad' });
  assert.deepEqual(sheet.parsePhoneCell('abc'), { kind: 'bad' });
  assert.equal(sheet.bangkokText(new Date('2026-10-29T07:05:09Z')), '2026-10-29 14:05:09');
  assert.equal(sheet.bangkokText(null), '');
  const keys = sheet.STAFF_SHEET_COLUMNS.map((c) => c.key);
  assert.equal(new Set(keys).size, keys.length, 'column keys are unique');
  assert.ok(sheet.STAFF_SHEET_COLUMNS.filter((c) => c.importable).map((c) => c.key).includes('phone'));
});

test('staff export and import: everything stored, all or nothing, same rules as the staff form (D86)', async (t) => {
  const ctx = await startApi(t);
  if (!ctx) return;
  const { db, request } = ctx;
  let world;
  try {
    world = await seedWorld(ctx);
    const { cookies, prefix, branches, staffIds } = world;
    const id = (n) => `${prefix}-${n}`;
    const erpNo = 600_000_000 + Math.floor(Math.random() * 90_000_000);
    await db.staff.create({
      data: {
        staffId: id('erp'),
        passwordHash: 'x',
        firstName: 'อีอาร์พี',
        lastName: 'ทดสอบ',
        mustChangePassword: false,
        erpStaffId: erpNo,
        erpSyncedAt: new Date(),
        phone: '0812345678',
        branchId: branches.a.id,
        roles: { create: { roleCode: 'STAFF' } },
      },
    });
    const exportRows = async () => (await request('/staff/export', 'GET', undefined, cookies.admin)).data.rows;
    const mine = async () => (await exportRows()).filter((r) => r.staffId.startsWith(prefix));
    const post = (rows, dryRun = false, who = 'admin') =>
      request('/staff/import', 'POST', { rows, dryRun }, cookies[who]);
    const row = async (n) => (await mine()).find((r) => r.staffId === id(n));
    const dbStaff = (n) => db.staff.findUnique({ where: { staffId: id(n) }, include: { roles: true } });

    await t.test('ADMIN only', async () => {
      assert.equal((await request('/staff/export')).status, 401);
      for (const who of ['staff', 'stock', 'cashier', 'manager']) {
        assert.equal((await request('/staff/export', 'GET', undefined, cookies[who])).status, 403, who);
        assert.equal((await post([{ staffId: 'x' }], true, who)).status, 403, who);
      }
    });

    await t.test('the export carries every field we store, and never a password hash', async () => {
      const res = await request('/staff/export', 'GET', undefined, cookies.admin);
      assert.equal(res.status, 200);
      assert.deepEqual(res.data.columns.map((c) => c.key), sheet.STAFF_SHEET_COLUMNS.map((c) => c.key));
      assert.match(res.data.generatedAt, /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/);
      const text = JSON.stringify(res.data);
      assert.ok(!/passwordHash|scrypt:|otp:only/.test(text));
      const erp = (await mine()).find((r) => r.staffId === id('erp'));
      assert.equal(erp.source, 'ERP');
      assert.equal(erp.phone, '0812345678');
      assert.equal(erp.phoneSource, 'ERP (tel)');
      assert.equal(erp.erpStaffId, erpNo);
      assert.equal(erp.branchCode, branches.a.code);
      assert.equal(erp.roles, 'STAFF');
      assert.equal(erp.active, true);
      assert.match(erp.erpSyncedAt, /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/);
      assert.match(erp.createdAt, /^\d{4}-\d\d-\d\d /);
      assert.match(erp.updatedAt, /^\d{4}-\d\d-\d\d /);
      const admin = (await mine()).find((r) => r.staffId === staffIds.admin);
      assert.equal(admin.source, 'สร้างเอง');
      assert.equal(admin.branchCode, '');
      assert.match(admin.lastLoginAt, /^\d{4}-\d\d-\d\d /, 'the sign-in of the test login was recorded');
      assert.ok(admin.activeSessions >= 1);
      assert.equal(admin.phone, '');
      assert.equal(admin.failedAttempts, 0);
    });

    await t.test('the export read back as it is changes nothing (also with the information-only columns)', async () => {
      const rows = await mine();
      const res = await post(rows);
      assert.equal(res.status, 201, JSON.stringify(res.data));
      assert.equal(res.data.applied, true);
      assert.deepEqual(res.data.summary, { created: 0, updated: 0, unchanged: rows.length, errors: 0 });
    });

    await t.test('a dry run reports what would change and writes nothing', async () => {
      const manager = await row('manager');
      const res = await post([{ ...manager, lastName: 'เปลี่ยนแล้ว', phone: '081-999-0000' }], true);
      assert.equal(res.status, 201);
      assert.equal(res.data.dryRun, true);
      assert.equal(res.data.applied, false);
      assert.deepEqual(res.data.rows[0], { row: 2, staffId: staffIds.manager, action: 'update', changes: ['lastName', 'phone'] });
      const stored = await db.staff.findUnique({ where: { staffId: staffIds.manager } });
      assert.notEqual(stored.lastName, 'เปลี่ยนแล้ว');
      assert.equal(stored.phone, null);
    });

    await t.test('a real run updates (phone normalised, updatedAt moves) and an empty cell leaves the field alone', async () => {
      const manager = await row('manager');
      const created = (await db.staff.findUnique({ where: { staffId: staffIds.manager } })).updatedAt;
      await new Promise((r) => setTimeout(r, 20));
      const res = await post([{ staffId: staffIds.manager, lastName: 'เปลี่ยนแล้ว', phone: '081-999-0000', firstName: '', roles: '', active: '' }]);
      assert.equal(res.data.applied, true, JSON.stringify(res.data));
      assert.equal(res.data.summary.updated, 1);
      const stored = await db.staff.findUnique({ where: { staffId: staffIds.manager }, include: { roles: true } });
      assert.equal(stored.lastName, 'เปลี่ยนแล้ว');
      assert.equal(stored.phone, '0819990000');
      assert.equal(stored.firstName, manager.firstName, 'empty cell = unchanged');
      assert.deepEqual(stored.roles.map((r) => r.roleCode), ['MANAGER']);
      assert.ok(stored.updatedAt > created, 'updatedAt moved');
      // "-" clears; a number cell without its leading zero is put right
      const clear = await post([{ staffId: staffIds.manager, phone: '-' }]);
      assert.equal(clear.data.summary.updated, 1);
      assert.equal((await db.staff.findUnique({ where: { staffId: staffIds.manager } })).phone, null);
      const fixed = await post([{ staffId: staffIds.manager, phone: 819990001 }]);
      assert.equal(fixed.data.applied, true);
      assert.equal((await db.staff.findUnique({ where: { staffId: staffIds.manager } })).phone, '0819990001');
    });

    await t.test('new accounts: roles and branch rules apply, no known password, and the file is all or nothing', async () => {
      const res = await post([
        { staffId: id('new1'), firstName: 'ใหม่', lastName: 'หนึ่ง', roles: 'staff', branchCode: branches.a.code, phone: '0811110001' },
        { staffId: id('new2'), roles: 'ADMIN', active: 'FALSE' },
      ]);
      assert.equal(res.data.applied, true, JSON.stringify(res.data));
      assert.equal(res.data.summary.created, 2);
      const one = await dbStaff('new1');
      assert.equal(one.branchId, branches.a.id);
      assert.equal(one.phone, '0811110001');
      assert.equal(one.mustChangePassword, false);
      assert.equal(one.active, true);
      assert.ok(one.passwordHash.startsWith('scrypt:'), 'a random password nobody knows, not empty');
      const two = await dbStaff('new2');
      assert.equal(two.branchId, null);
      assert.equal(two.active, false);
      // a bad row anywhere: nothing is written
      const bad = await post([
        { staffId: id('new3'), roles: 'STAFF', branchCode: branches.a.code },
        { staffId: id('new4'), roles: 'BOSS' },
      ]);
      assert.equal(bad.data.applied, false);
      assert.equal(bad.data.summary.errors, 1);
      assert.equal(bad.data.rows[1].action, 'error');
      assert.match(bad.data.rows[1].message, /roles/);
      assert.equal(await dbStaff('new3'), null, 'the good row of a bad file is not written either');
    });

    await t.test('row errors name the column; duplicates, unknown branches and missing keys are refused', async () => {
      const res = await post([
        { staffId: id('e1'), roles: 'STAFF' },
        { staffId: id('e2'), roles: 'STAFF', branchCode: 'NO-SUCH' },
        { staffId: id('e3'), roles: 'STAFF', branchCode: branches.a.code, phone: '123' },
        { staffId: id('e4'), roles: 'STAFF', branchCode: branches.a.code, active: 'maybe' },
        { staffId: id('e5') },
        { firstName: 'ไม่มีรหัส', roles: 'STAFF' },
        { staffId: id('e6'), roles: 'STAFF', branchCode: branches.a.code },
        { staffId: id('e6'), roles: 'STAFF', branchCode: branches.a.code },
        { staffId: id('e7'), roles: 'MANAGER,ADMIN', branchCode: branches.a.code },
      ], true);
      const msg = res.data.rows.map((r) => r.message ?? '');
      assert.match(msg[0], /ADMIN ล้วนไม่มี Branch|Branch/, 'a staff role needs a branch');
      assert.match(msg[1], /branchCode/);
      assert.match(msg[2], /phone/);
      assert.match(msg[3], /active/);
      assert.match(msg[4], /roles/);
      assert.match(msg[5], /staffId/);
      assert.equal(res.data.rows[6].action, 'create');
      assert.match(msg[7], /ซ้ำ/);
      assert.equal(res.data.rows[8].action, 'create', 'ADMIN together with another role is allowed, with a branch (same rule as the form)');
      assert.equal(res.data.rows.length, 9);
      assert.equal(res.data.summary.errors, 7);
      // blank lines are skipped, not errors
      const blank = await post([{}, { staffId: '' , roles: ''}, { staffId: id('erp') }], true);
      assert.equal(blank.data.rows.length, 1);
      assert.equal(blank.data.rows[0].action, 'unchanged');
    });

    await t.test('ERP accounts keep their ERP-owned fields, including the phone (D54, D85)', async () => {
      for (const [change, expect] of [
        [{ lastName: 'แก้ใน SES' }, /ERP/],
        [{ phone: '0899999999' }, /ERP/],
        [{ branchCode: branches.b.code }, /ERP/],
        [{ active: 'FALSE' }, /ERP/],
        [{ roles: 'CASHIER' }, /ERP/],
      ]) {
        const res = await post([{ staffId: id('erp'), ...change }], true);
        assert.equal(res.data.rows[0].action, 'error', JSON.stringify(change));
        assert.match(res.data.rows[0].message, expect);
      }
      // the same value as stored is fine; an ERP account can be made MANAGER too (hand-managed role)
      const same = await post([{ staffId: id('erp'), lastName: 'ทดสอบ', phone: '081-234-5678', roles: 'STAFF' }], true);
      assert.equal(same.data.rows[0].action, 'unchanged');
      const mgr = await post([{ staffId: id('erp'), roles: 'STAFF,MANAGER' }]);
      assert.equal(mgr.data.applied, true, JSON.stringify(mgr.data));
      assert.deepEqual((await dbStaff('erp')).roles.map((r) => r.roleCode).sort(), ['MANAGER', 'STAFF']);
    });

    await t.test('deactivating signs the person out; the last ADMIN cannot be removed', async () => {
      assert.equal((await request('/auth/me', 'GET', undefined, cookies.staffB)).status, 200);
      const res = await post([{ staffId: staffIds.staffB, active: 'FALSE' }]);
      assert.equal(res.data.applied, true, JSON.stringify(res.data));
      assert.equal((await request('/auth/me', 'GET', undefined, cookies.staffB)).status, 401);
      const admins = await db.staff.count({ where: { active: true, roles: { some: { roleCode: 'ADMIN' } } } });
      if (admins === 1) {
        const last = await post([{ staffId: staffIds.admin, active: 'FALSE' }], true);
        assert.equal(last.data.rows[0].action, 'error');
        assert.match(last.data.rows[0].message, /ADMIN/);
      }
    });

    await t.test('size: more than 2000 rows is refused; 1500 rows fit the request limit', async () => {
      const many = (n) => Array.from({ length: n }, (_, i) => ({ staffId: `${prefix}-bulk-${i}`, firstName: 'ก'.repeat(40), roles: 'STAFF' }));
      assert.equal((await post(many(2001), true)).status, 400);
      const big = await post(many(1500), true);
      assert.equal(big.status, 201, `${big.status} ${JSON.stringify(big.data).slice(0, 120)}`);
      assert.equal(big.data.summary.errors, 1500, 'every row lacks a branch, and the answer still comes back');
      assert.equal((await request('/staff/import', 'POST', { rows: 'nope' }, cookies.admin)).status, 400);
      assert.equal((await request('/staff/import', 'POST', { rows: [], extra: 1 }, cookies.admin)).status, 400);
    });
  } finally {
    if (world) {
      const extra = await db.staff.findMany({ where: { staffId: { startsWith: `${world.prefix}-` } }, select: { staffId: true } });
      const ids = extra.map((s) => s.staffId);
      await db.loginSession.deleteMany({ where: { staffId: { in: ids } } });
      await db.staffRole.deleteMany({ where: { staffId: { in: ids } } });
      await db.staff.deleteMany({ where: { staffId: { in: ids.filter((s) => !Object.values(world.staffIds).includes(s)) } } });
    }
    await cleanup(ctx, world);
  }
});
