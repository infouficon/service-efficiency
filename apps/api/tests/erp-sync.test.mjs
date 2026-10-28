import assert from 'node:assert/strict';
import http from 'node:http';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.test', override: true });

const erp = await import('../dist/erp/erp-sync.service.js');

// ---------------------------------------------------------------------------
// Pure rules (no database)
// ---------------------------------------------------------------------------
test('position text maps to SES roles; ADMIN/MANAGER are never granted', () => {
  assert.deepEqual(erp.rolesForPosition('Sale Representative'), ['STAFF']);
  assert.deepEqual(
    erp.rolesForPosition('Sales Representative (Contract 6 months)'),
    ['STAFF'],
  );
  assert.deepEqual(erp.rolesForPosition('Sale Supervisor'), ['STAFF']);
  assert.deepEqual(erp.rolesForPosition('Store Manager'), ['STAFF']);
  assert.deepEqual(erp.rolesForPosition('Cashier'), ['CASHIER']);
  assert.deepEqual(erp.rolesForPosition('In Store Stock'), ['STOCK']);
  assert.deepEqual(erp.rolesForPosition('Cashier / Sale'), [
    'STAFF',
    'CASHIER',
  ]);
  assert.deepEqual(erp.rolesForPosition('Technician'), []);
  assert.deepEqual(erp.rolesForPosition(''), []);
  assert.deepEqual(erp.rolesForPosition(null), []);
});

test('branch scope: only iStudio and U-Store, duplicates and broken rows are reported', () => {
  const row = (id, code, group, status = 'active') => ({
    branch_id: id,
    branch_code: code,
    branch_name: `${code} name`,
    branch_tel: '02',
    branch_group: group,
    status,
  });
  const { scope, notes } = erp.parseBranches([
    row(1, 'A1', 'iStudio'),
    row(2, 'B1', 'U-Store', 'close'),
    row(3, 'H1', 'HO'),
    row(4, 'DUP', 'iStudio'),
    row(5, 'DUP', 'U-Store'),
    { branch_id: 6, branch_code: '', branch_group: 'iStudio' },
  ]);
  assert.deepEqual(
    scope.map((b) => [b.erpBranchId, b.code, b.active]),
    [
      [1, 'A1', true],
      [2, 'B1', false],
    ],
  );
  assert.equal(notes.length, 3);
});

test('staff eligibility: active, in an imported branch, has password and a mapped position', () => {
  const branches = [
    { erpBranchId: 1, code: 'A1', name: 'A1', phone: '', active: true },
    { erpBranchId: 2, code: 'B1', name: 'B1', phone: '', active: false },
  ];
  const row = (id, o = {}) => ({
    staff_id: id,
    'user name': String(id),
    'user password': `pw${id}`,
    status: 'active',
    branch_id: 1,
    position: 'Sale Representative',
    name_first_th: 'ก',
    name_last_th: 'ข',
    ...o,
  });
  const out = erp.parsePeople(
    [
      row(10),
      row(11, { status: 'Active', position: 'Cashier', 'user name': '' }),
      row(12, { branch_id: 2 }),
      row(13, { 'user password': '  ' }),
      row(14, { position: 'Housekeeper' }),
      row(15, { status: 'resign' }),
      row(16, { branch_id: 99 }),
      row(17, { 'user name': '999' }),
      row(18),
      row(18),
      row(5_000_000_000),
    ],
    branches,
  );
  assert.deepEqual(
    out.people.map((p) => [p.staffId, p.roles]),
    [
      ['10', ['STAFF']],
      ['11', ['CASHIER']],
      ['17', ['STAFF']],
    ],
  );
  assert.equal(out.outOfScope, 1);
  assert.equal(out.warnings.length, 1);
  assert.equal(out.warnings[0].staffId, '17');
  assert.deepEqual(out.skipped.map((s) => s.staffId).sort(), [
    '12',
    '13',
    '14',
    '18',
    '18',
    '5000000000',
  ]);
  assert.ok(
    out.people.every(
      (p) => typeof p.password === 'string' && p.password.length > 0,
    ),
  );
});

test('SMS OTP mode: the ERP password is not required, the tel becomes the phone, a missing one is a warning (D85)', () => {
  const branches = [{ erpBranchId: 1, code: 'A1', name: 'A1', phone: '', active: true }];
  const row = (id, o = {}) => ({
    staff_id: id,
    'user name': String(id),
    status: 'active',
    branch_id: 1,
    position: 'Sale Representative',
    name_first_th: 'ก',
    name_last_th: 'ข',
    tel: '081-234-5678',
    ...o,
  });
  const out = erp.parsePeople(
    [
      row(1),
      row(2, { tel: '+66 89 123 4567' }),
      row(3, { tel: '' }),
      row(4, { tel: '021234567' }),
      row(5, { tel: null }),
      row(6, { 'user password': 'x'.repeat(200) }),
    ],
    branches,
    new Set(),
    false,
  );
  assert.deepEqual(
    out.people.map((p) => [p.staffId, p.phone, p.password]),
    [
      ['1', '0812345678', ''],
      ['2', '0891234567', ''],
      ['3', null, ''],
      ['4', null, ''],
      ['5', null, ''],
      ['6', '0812345678', ''],
    ],
    'everybody is imported, with or without a password; only a Thai mobile number counts',
  );
  assert.deepEqual(out.warnings.map((w) => w.staffId), ['3', '4', '5']);
  assert.deepEqual(out.skipped, []);
  // password mode still needs the password and still reads the tel
  const old = erp.parsePeople([row(7, { 'user password': 'pw' }), row(8)], branches);
  assert.deepEqual(old.people.map((p) => [p.staffId, p.phone]), [['7', '0812345678']]);
  assert.deepEqual(old.skipped.map((x) => x.staffId), ['8']);
});

test('schedule: due slot inside the catch-up window, next run, Bangkok time', () => {
  const times = erp.parseTimes('10:00');
  assert.deepEqual(times, [600]);
  assert.equal(
    erp.dueSlot(new Date('2026-10-12T03:00:00Z'), times, 60),
    '2026-10-12T10:00',
  );
  assert.equal(
    erp.dueSlot(new Date('2026-10-12T03:59:00Z'), times, 60),
    '2026-10-12T10:00',
  );
  assert.equal(erp.dueSlot(new Date('2026-10-12T04:00:00Z'), times, 60), null);
  assert.equal(erp.dueSlot(new Date('2026-10-12T02:59:00Z'), times, 60), null);
  assert.equal(
    erp.nextRunAt(new Date('2026-10-12T01:00:00Z'), times),
    '2026-10-12T10:00:00+07:00',
  );
  assert.equal(
    erp.nextRunAt(new Date('2026-10-12T03:05:00Z'), times),
    '2026-10-13T10:00:00+07:00',
  );
  assert.equal(erp.nextRunAt(new Date(), []), null);
  assert.deepEqual(erp.parseTimes(''), []);
});

test('OData body with raw control characters still parses', () => {
  const body = '{"value":[{"a":"x\u0000y"}]}';
  assert.equal(erp.parseOData(body).value[0].a, 'x\u0000y');
});

// ---------------------------------------------------------------------------
// Real MySQL + a fake ERP over HTTP
// ---------------------------------------------------------------------------
const erpState = {
  branches: [],
  staff: [],
  failWith: null,
  delayMs: 0,
  requests: [],
};
const expectedAuth = `Basic ${Buffer.from('erp-user:erp-pass').toString('base64')}`;
const fake = http.createServer((req, res) => {
  erpState.requests.push({ url: req.url, auth: req.headers.authorization });
  if (req.headers.authorization !== expectedAuth) {
    res.statusCode = 401;
    return res.end('{}');
  }
  if (erpState.failWith) {
    res.statusCode = erpState.failWith;
    return res.end('down');
  }
  const path = new URL(req.url, 'http://erp').pathname;
  res.setHeader('content-type', 'application/json');
  const reply = () => {
    if (path.endsWith('/branch'))
      return res.end(JSON.stringify({ value: erpState.branches }));
    if (path.endsWith('/staff'))
      return res.end(JSON.stringify({ value: erpState.staff }));
    res.statusCode = 404;
    return res.end('{}');
  };
  return erpState.delayMs ? setTimeout(reply, erpState.delayMs) : reply();
});
await new Promise((resolve) => fake.listen(0, '127.0.0.1', resolve));
process.env.ERP_ODATA_BASE_URL = `http://127.0.0.1:${fake.address().port}/fmi/odata/v4/UFService`;
process.env.ERP_ODATA_USER = 'erp-user';
process.env.ERP_ODATA_PASS = 'erp-pass';
process.env.ERP_SYNC_TIMES = ''; // no timer in tests; runs are triggered by hand

const database = new URL(process.env.DATABASE_URL ?? 'mysql://invalid/invalid');
const { createApplication } = await import('../dist/bootstrap.js');
const { PrismaService } = await import('../dist/prisma/prisma.service.js');
const { hashPassword } = await import('../dist/accounts/password.js');

test('ERP import: branches, staff, passwords, leavers and guards against a real database', async (t) => {
  if (database.pathname !== '/service_efficiency_test')
    throw new Error(
      'Integration tests require isolated service_efficiency_test database',
    );
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
      t.skip(
        'Database server not reachable, skipping live MySQL integration test',
      );
      fake.close();
      return;
    }
    throw err;
  }
  const base = await app.getUrl();
  const db = app.get(PrismaService);
  const svc = app.get(erp.ErpSyncService);
  const prefix = `erp-${randomUUID().slice(0, 8)}`;
  const staffBase = 900_000_000 + Math.floor(Math.random() * 90_000_000);
  const branchBase = 800_000_000 + Math.floor(Math.random() * 90_000_000);
  const n = (k) => staffBase + k;
  const sid = (k) => String(n(k));
  const adminId = `${prefix}-admin`;
  const outsiderId = `${prefix}-outsider`;
  const manualId = `${prefix}-manual`;
  const codeA = `${prefix}-A`;
  const codeB = `${prefix}-B`;
  const codeC = `${prefix}-C`;
  const [bidA, bidB, bidC] = [branchBase + 1, branchBase + 2, branchBase + 3];
  const adminPassword = 'Admin-erp-test-1';

  const eb = (id, code, status = 'active', group = 'iStudio') => ({
    branch_id: id,
    branch_code: code,
    branch_name: `${code} สาขา`,
    branch_tel: '0212345678',
    branch_group: group,
    status,
  });
  const es = (k, o = {}) => ({
    staff_id: n(k),
    'user name': sid(k),
    'user password': `erp-pw-${k}-x`,
    tel: `08${String(20000000 + k).slice(-8)}`,
    status: 'active',
    branch_id: bidA,
    position: 'Sale Representative',
    name_first_th: `ชื่อ${k}`,
    name_last_th: `สกุล${k}`,
    ...o,
  });
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
    const response = await fetch(`${base}/api${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return {
      status: response.status,
      data: await response.json().catch(() => null),
      cookie: response.headers.get('set-cookie')?.split(';')[0] ?? '',
    };
  };
  const login = (staffId, password) =>
    request('/auth/login', 'POST', { staffId, password });
  const run = async (query = '', cookie = adminCookie) =>
    request(
      `/admin/erp-sync/run${query ? `${query}&` : '?'}wait=true`,
      'POST',
      undefined,
      cookie,
    );
  const staffRow = (k) =>
    db.staff.findUnique({
      where: { staffId: sid(k) },
      include: { roles: true, branch: true },
    });
  let adminCookie = '';
  const staffIds = () => Array.from({ length: 60 }, (_, k) => sid(k));

  try {
    await db.staff.create({
      data: {
        staffId: adminId,
        passwordHash: await hashPassword(adminPassword),
        mustChangePassword: false,
        roles: { create: { roleCode: 'ADMIN' } },
      },
    });
    const outsiderBranch = await db.branch.create({
      data: {
        code: `${prefix}-O`,
        name: 'outsider branch',
        phone: '',
        active: true,
      },
    });
    await db.staff.create({
      data: {
        staffId: outsiderId,
        passwordHash: await hashPassword(adminPassword),
        mustChangePassword: false,
        branchId: outsiderBranch.id,
        roles: { create: { roleCode: 'STAFF' } },
      },
    });
    adminCookie = (await login(adminId, adminPassword)).cookie;
    assert.ok(adminCookie);

    await t.test(
      'only an ADMIN can see or start the import, and the origin guard applies',
      async () => {
        const outsiderCookie = (await login(outsiderId, adminPassword)).cookie;
        assert.equal(
          (
            await request(
              '/admin/erp-sync/status',
              'GET',
              undefined,
              outsiderCookie,
            )
          ).status,
          403,
        );
        assert.equal((await run('', outsiderCookie)).status, 403);
        assert.equal((await request('/admin/erp-sync/status')).status, 401);
        assert.equal(
          (
            await request(
              '/admin/erp-sync/run',
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
              '/admin/erp-sync/run',
              'POST',
              undefined,
              adminCookie,
              'https://evil.example',
            )
          ).status,
          403,
        );
        const status = await request(
          '/admin/erp-sync/status',
          'GET',
          undefined,
          adminCookie,
        );
        assert.equal(status.status, 200);
        assert.equal(status.data.configured, true);
        assert.deepEqual(status.data.schedule, []);
        assert.equal(status.data.running, false);
      },
    );

    erpState.branches = [
      eb(bidA, codeA),
      eb(bidB, codeB, 'close', 'U-Store'),
      eb(branchBase + 9, `${prefix}-HO`, 'active', 'HO'),
    ];
    erpState.staff = [
      es(1),
      es(2, { position: 'Cashier' }),
      es(3, { position: 'In Store Stock', 'user name': '' }),
      es(4, { position: 'Technician' }),
      es(5, { 'user password': '' }),
    ];

    await t.test('dry run reports the plan and writes nothing', async () => {
      const res = await run('?dryRun=true');
      assert.equal(res.status, 201, JSON.stringify(res.data));
      assert.equal(res.data.ok, true, res.data.error);
      assert.equal(res.data.dryRun, true);
      assert.equal(res.data.summary.staff.created, 3);
      assert.equal(res.data.summary.branches.created, 1);
      assert.deepEqual(
        res.data.summary.staff.skipped.map((s) => s.staffId).sort(),
        [sid(4), sid(5)].sort(),
      );
      assert.equal(
        await db.staff.count({
          where: { erpStaffId: { gte: staffBase, lt: staffBase + 100 } },
        }),
        0,
      );
      assert.equal(
        await db.branch.count({ where: { erpBranchId: { in: [bidA, bidB] } } }),
        0,
      );
      const req = erpState.requests.at(-1);
      assert.ok(
        req.url.includes('%22user%20name%22') && req.url.includes('$top=5000'),
        req.url,
      );
      assert.ok(
        !erpState.requests.some((r) => r.url.includes('$filter')),
        'no server-side $filter',
      );
    });

    await t.test(
      'first run creates the branch and the accounts; ERP passwords work as logins',
      async () => {
        const res = await run();
        assert.equal(res.data.ok, true, res.data.error);
        assert.equal(res.data.summary.staff.created, 3);
        const a = await db.branch.findFirst({ where: { erpBranchId: bidA } });
        assert.equal(a.code, codeA);
        assert.equal(a.active, true);
        assert.equal(
          await db.branch.count({ where: { erpBranchId: bidB } }),
          0,
          'closed ERP branch that SES never had is not created',
        );
        const one = await staffRow(1);
        assert.equal(one.erpStaffId, n(1));
        assert.equal(one.branchId, a.id);
        assert.equal(one.mustChangePassword, false);
        assert.ok(
          one.passwordHash.startsWith('scrypt:'),
          'password is stored hashed',
        );
        assert.ok(!one.passwordHash.includes('erp-pw-1'));
        assert.deepEqual(
          (await staffRow(2)).roles.map((r) => r.roleCode),
          ['CASHIER'],
        );
        assert.deepEqual(
          (await staffRow(3)).roles.map((r) => r.roleCode),
          ['STOCK'],
        );
        assert.equal(await staffRow(4), null);
        const ok = await login(sid(1), 'erp-pw-1-x');
        assert.equal(ok.status, 201);
        assert.equal(ok.data.erpManaged, true);
        assert.equal((await login(sid(1), 'wrong')).status, 401);
        const list = await request('/staff', 'GET', undefined, adminCookie);
        assert.equal(
          list.data.find((s) => s.staffId === sid(1)).erpManaged,
          true,
        );
        assert.equal(
          list.data.find((s) => s.staffId === adminId).erpManaged,
          false,
        );
      },
    );

    await t.test(
      'a branch kept in sync with the ERP cannot be edited by hand',
      async () => {
        const a = await db.branch.findFirst({ where: { erpBranchId: bidA } });
        const res = await request(
          `/branches/${a.id}`,
          'PUT',
          { code: a.code, name: 'renamed by hand', phone: '', active: true },
          adminCookie,
        );
        assert.equal(res.status, 409);
        assert.equal(
          (await db.branch.findUnique({ where: { id: a.id } })).name,
          a.name,
        );
      },
    );

    await t.test('second run changes nothing', async () => {
      const res = await run();
      assert.equal(res.data.ok, true, res.data.error);
      assert.equal(res.data.summary.staff.created, 0);
      assert.equal(res.data.summary.staff.updated, 0);
      assert.equal(res.data.summary.staff.passwordChanged, 0);
      assert.equal(res.data.summary.staff.unchanged, 3);
      assert.equal(res.data.summary.branches.unchanged, 1);
    });

    await t.test(
      'a password changed in the ERP replaces the old one and ends old sessions',
      async () => {
        const before = await login(sid(1), 'erp-pw-1-x');
        erpState.staff[0]['user password'] = 'erp-new-1';
        const res = await run();
        assert.equal(res.data.summary.staff.passwordChanged, 1);
        assert.equal((await login(sid(1), 'erp-pw-1-x')).status, 401);
        assert.equal((await login(sid(1), 'erp-new-1')).status, 201);
        assert.equal(
          (await request('/auth/me', 'GET', undefined, before.cookie)).status,
          401,
        );
      },
    );

    await t.test(
      'synced accounts cannot change or reset passwords or edit ERP-owned fields; ADMIN/MANAGER stay manual',
      async () => {
        const cookie = (await login(sid(1), 'erp-new-1')).cookie;
        const change = await request(
          '/auth/password',
          'POST',
          { currentPassword: 'erp-new-1', newPassword: 'another-pass-1' },
          cookie,
        );
        assert.equal(change.status, 403);
        assert.equal(
          (
            await request(
              `/staff/${sid(1)}/reset-password`,
              'POST',
              { password: 'Reset-pass-123' },
              adminCookie,
            )
          ).status,
          409,
        );
        const a = await db.branch.findFirst({ where: { erpBranchId: bidA } });
        const same = {
          firstName: 'ชื่อ1',
          lastName: 'สกุล1',
          roles: ['STAFF'],
          branchId: a.id,
          active: true,
        };
        assert.equal(
          (
            await request(
              `/staff/${sid(1)}`,
              'PUT',
              { ...same, firstName: 'Other' },
              adminCookie,
            )
          ).status,
          409,
        );
        assert.equal(
          (
            await request(
              `/staff/${sid(1)}`,
              'PUT',
              { ...same, active: false },
              adminCookie,
            )
          ).status,
          409,
        );
        assert.equal(
          (
            await request(
              `/staff/${sid(1)}`,
              'PUT',
              { ...same, roles: ['CASHIER'] },
              adminCookie,
            )
          ).status,
          409,
        );
        assert.equal(
          (
            await request(
              `/staff/${sid(1)}`,
              'PUT',
              { ...same, roles: ['STAFF', 'MANAGER'] },
              adminCookie,
            )
          ).status,
          200,
        );
        const res = await run();
        assert.equal(res.data.ok, true, res.data.error);
        assert.deepEqual(
          (await staffRow(1)).roles.map((r) => r.roleCode).sort(),
          ['MANAGER', 'STAFF'],
        );
      },
    );

    await t.test(
      'an unusable ERP row (no password, unmapped position) keeps the account instead of locking the person out',
      async () => {
        const row = erpState.staff[1];
        const saved = {
          password: row['user password'],
          position: row.position,
        };
        row['user password'] = '';
        let res = await run();
        assert.equal(res.data.ok, true, res.data.error);
        assert.ok(
          res.data.summary.staff.skipped.some((x) => x.staffId === sid(2)),
        );
        assert.equal(res.data.summary.staff.deactivated, 0);
        assert.equal((await staffRow(2)).active, true);
        assert.equal(
          (await login(sid(2), 'erp-pw-2-x')).status,
          201,
          'old password still works',
        );
        row['user password'] = saved.password;
        row.position = 'Technician';
        res = await run();
        assert.equal(res.data.summary.staff.deactivated, 0);
        assert.equal((await staffRow(2)).active, true);
        row.position = saved.position;
        erpState.staff.push({ ...row });
        res = await run();
        assert.equal(
          res.data.summary.staff.deactivated,
          0,
          'duplicate staff_id rows never deactivate',
        );
        assert.equal((await staffRow(2)).active, true);
        erpState.staff.pop();
      },
    );

    await t.test(
      'flags must be exactly true or false; ADMIN cannot be granted to a synced account',
      async () => {
        assert.equal(
          (
            await request(
              '/admin/erp-sync/run?dryRun=1',
              'POST',
              undefined,
              adminCookie,
            )
          ).status,
          400,
        );
        assert.equal(
          (
            await request(
              '/admin/erp-sync/run?dryRun=TRUE',
              'POST',
              undefined,
              adminCookie,
            )
          ).status,
          400,
        );
        assert.equal(
          (
            await request(
              '/admin/erp-sync/run?dryRun=true&dryRun=true',
              'POST',
              undefined,
              adminCookie,
            )
          ).status,
          400,
        );
        const a = await db.branch.findFirst({ where: { erpBranchId: bidA } });
        const same = {
          firstName: 'ชื่อ2',
          lastName: 'สกุล2',
          roles: ['CASHIER'],
          branchId: a.id,
          active: true,
        };
        assert.equal(
          (
            await request(
              `/staff/${sid(2)}`,
              'PUT',
              { ...same, roles: ['STAFF', 'ADMIN'], branchId: a.id },
              adminCookie,
            )
          ).status,
          409,
        );
      },
    );

    await t.test('a position change swaps the ERP-managed roles', async () => {
      erpState.staff[1].position = 'Sale Representative';
      const res = await run();
      assert.equal(res.data.summary.staff.updated, 1);
      assert.deepEqual(
        (await staffRow(2)).roles.map((r) => r.roleCode),
        ['STAFF'],
      );
    });

    await t.test(
      'an account created by hand with the same id is skipped and left alone',
      async () => {
        const manual = await db.staff.create({
          data: {
            staffId: sid(9),
            passwordHash: await hashPassword('Manual-pass-1'),
            mustChangePassword: false,
            branchId: (
              await db.branch.findFirst({ where: { erpBranchId: bidA } })
            ).id,
            roles: { create: { roleCode: 'STAFF' } },
          },
        });
        erpState.staff.push(es(9, { 'user password': 'erp-pw-9' }));
        const res = await run();
        assert.ok(
          res.data.summary.staff.skipped.some((s) => s.staffId === sid(9)),
          JSON.stringify(res.data.summary.staff.skipped),
        );
        const after = await staffRow(9);
        assert.equal(after.erpStaffId, null);
        assert.equal(after.passwordHash, manual.passwordHash);
        assert.equal((await login(sid(9), 'Manual-pass-1')).status, 201);
        assert.equal((await login(sid(9), 'erp-pw-9')).status, 401);
        erpState.staff.pop();
      },
    );

    await t.test(
      'a person who leaves the ERP active list is deactivated and logged out',
      async () => {
        const session = await login(sid(3), 'erp-pw-3-x');
        assert.equal(session.status, 201);
        erpState.staff[2].status = 'resign';
        const res = await run();
        assert.equal(res.data.summary.staff.deactivated, 1);
        assert.equal((await staffRow(3)).active, false);
        assert.equal((await login(sid(3), 'erp-pw-3-x')).status, 401);
        assert.equal(
          (await request('/auth/me', 'GET', undefined, session.cookie)).status,
          401,
        );
        erpState.staff[2].status = 'active';
        const back = await run();
        assert.equal(back.data.summary.staff.reactivated, 1);
        assert.equal((await staffRow(3)).active, true);
      },
    );

    await t.test(
      'a same-code branch made by hand is adopted; a branch closed in the ERP is deactivated after its staff',
      async () => {
        const handMade = await db.branch.create({
          data: { code: codeC, name: 'hand made', phone: '', active: true },
        });
        erpState.branches.push(eb(bidC, codeC, 'active', 'U-Store'));
        erpState.staff.push(es(6, { branch_id: bidC }));
        let res = await run();
        assert.equal(
          res.data.summary.branches.adopted,
          1,
          JSON.stringify(res.data.summary.branches),
        );
        const adopted = await db.branch.findUnique({
          where: { id: handMade.id },
        });
        assert.equal(adopted.erpBranchId, bidC);
        assert.equal(adopted.name, `${codeC} สาขา`);
        assert.equal((await staffRow(6)).branchId, handMade.id);
        erpState.branches.at(-1).status = 'close';
        res = await run();
        assert.equal(res.data.ok, true, res.data.error);
        assert.equal(res.data.summary.branches.deactivated, 1);
        assert.equal((await staffRow(6)).active, false);
        assert.equal(
          (await db.branch.findUnique({ where: { id: handMade.id } })).active,
          false,
        );
        erpState.staff.pop();
      },
    );

    await t.test(
      'when the ERP is down nothing changes and the failure is recorded',
      async () => {
        const before = await db.staff.count({
          where: { erpStaffId: { not: null }, active: true },
        });
        erpState.failWith = 503;
        const res = await run();
        erpState.failWith = null;
        assert.equal(res.data.ok, false);
        assert.match(res.data.error, /ERP/);
        assert.equal(
          await db.staff.count({
            where: { erpStaffId: { not: null }, active: true },
          }),
          before,
        );
        assert.equal((await login(sid(2), 'erp-pw-2-x')).status, 201);
        const status = await request(
          '/admin/erp-sync/status',
          'GET',
          undefined,
          adminCookie,
        );
        assert.equal(status.data.lastRuns[0].ok, false);
        erpState.failWith = null;
      },
    );

    await t.test(
      'an ERP that rejects the credentials is reported without leaking them',
      async () => {
        erpState.failWith = 401;
        const res = await run();
        erpState.failWith = null;
        assert.equal(res.data.ok, false);
        assert.match(res.data.error, /ปฏิเสธ/);
        assert.ok(!JSON.stringify(res.data).includes('erp-pass'));
      },
    );

    await t.test('mass deactivation is refused unless forced', async () => {
      for (let k = 20; k < 30; k += 1) erpState.staff.push(es(k));
      assert.equal((await run()).data.ok, true);
      const savedStaff = erpState.staff;
      erpState.staff = [];
      let res = await run('?force=true');
      assert.equal(
        res.data.ok,
        false,
        'an empty staff list is refused even with force',
      );
      assert.match(res.data.error, /ว่าง/);
      erpState.staff = savedStaff.slice(0, 1);
      res = await run();
      assert.equal(res.data.ok, false);
      assert.match(res.data.error, /ยกเลิกการซิงก์/);
      assert.equal((await staffRow(20)).active, true);
      res = await run('?force=true');
      assert.equal(res.data.ok, true, res.data.error);
      assert.ok(res.data.summary.staff.deactivated >= 10);
      assert.equal((await staffRow(20)).active, false);
      erpState.staff = savedStaff;
    });

    await t.test(
      'a run started without wait returns at once, blocks a second one and finishes in the background',
      async () => {
        erpState.delayMs = 700;
        const started = await request(
          '/admin/erp-sync/run?dryRun=true',
          'POST',
          undefined,
          adminCookie,
        );
        assert.equal(started.status, 201);
        assert.equal(started.data.ok, null);
        assert.equal(started.data.finishedAt, null);
        assert.equal(
          (
            await request(
              '/admin/erp-sync/run?dryRun=true',
              'POST',
              undefined,
              adminCookie,
            )
          ).status,
          409,
        );
        assert.equal(
          (
            await request(
              '/admin/erp-sync/status',
              'GET',
              undefined,
              adminCookie,
            )
          ).data.running,
          true,
        );
        let done;
        for (let i = 0; i < 40 && !done; i += 1) {
          await new Promise((resolve) => setTimeout(resolve, 250));
          const status = (
            await request(
              '/admin/erp-sync/status',
              'GET',
              undefined,
              adminCookie,
            )
          ).data;
          done = status.running
            ? null
            : status.lastRuns.find(
                (r) => r.id === started.data.id && r.ok !== null,
              );
        }
        erpState.delayMs = 0;
        assert.ok(done, 'run finished');
        assert.equal(done.ok, true, done.error);
        assert.equal(done.dryRun, true);
      },
    );

    await t.test(
      'a scheduled slot is claimed once; a failed slot can be retried later',
      async () => {
        const slot = `2099-01-01T10:00-${prefix}`.slice(0, 40);
        const first = await svc.claim(slot, 'schedule', false, null);
        assert.ok(first);
        assert.equal(await svc.claim(slot, 'schedule', false, null), null);
        await db.erpSyncRun.update({
          where: { id: first.id },
          data: { ok: false, finishedAt: new Date(Date.now() - 11 * 60_000) },
        });
        const retry = await svc.claim(slot, 'schedule', false, null);
        assert.equal(retry.id, first.id);
        assert.equal(
          (await db.erpSyncRun.findUnique({ where: { id: first.id } }))
            .attempts,
          2,
        );
        assert.equal(await svc.claim(slot, 'schedule', false, null), null);
        await db.erpSyncRun.deleteMany({ where: { slot } });
      },
    );

    await t.test(
      'with SMS OTP on (ThaiBulkSMS configured) the import stops reading ERP passwords and ERP accounts keep only the OTP marker (D85)',
      async () => {
        const phoneOf = async (k) => (await staffRow(k))?.phone;
        // the phone from the ERP tel was stored by the earlier (password-mode) runs
        assert.equal(await phoneOf(1), `08${String(20000001).slice(-8)}`);
        erpState.requests.length = 0;
        process.env.THAIBULKSMS_API_KEY = 'k';
        process.env.THAIBULKSMS_API_SECRET = 's';
        try {
          erpState.staff.push(es(50, { 'user password': '', tel: '' }));
          const res = await run();
          assert.equal(res.data.ok, true, res.data.error);
          const staffCall = erpState.requests.find((r) => r.url.includes('/staff'));
          assert.ok(staffCall, 'the staff table was read');
          assert.ok(!/user%20password/i.test(staffCall.url), 'no password field is requested');
          assert.match(staffCall.url, /[,=]tel[,&]/, 'the tel is');
          const one = await staffRow(1);
          assert.equal(one.passwordHash, 'otp:only', 'the stored ERP password copy is gone');
          const fifty = await staffRow(50);
          assert.ok(fifty, 'a person without any ERP password still gets an account');
          assert.equal(fifty.phone, null);
          assert.ok(
            res.data.summary.staff.warnings.some((w) => w.staffId === sid(50)),
            'and a warning that OTP login cannot reach them',
          );
          assert.equal((await login(sid(1), 'erp-new-1')).status, 401, 'password login is closed for ERP accounts');
          // a second run changes nothing
          const again = await run();
          assert.equal(again.data.summary.staff.passwordChanged, 0);
        } finally {
          delete process.env.THAIBULKSMS_API_KEY;
          delete process.env.THAIBULKSMS_API_SECRET;
        }
        // back to password mode: the next import re-creates the password copies, so nobody stays locked out
        const back = await run();
        assert.equal(back.data.ok, true, back.data.error);
        assert.notEqual((await staffRow(1)).passwordHash, 'otp:only');
        assert.equal((await login(sid(1), 'erp-new-1')).status, 201);
      },
    );
  } finally {
    const ids = [...staffIds(), adminId, outsiderId, manualId];
    await db.loginSession.deleteMany({ where: { staffId: { in: ids } } });
    await db.staffRole.deleteMany({ where: { staffId: { in: ids } } });
    await db.staff.deleteMany({ where: { staffId: { in: ids } } });
    await db.branch.deleteMany({
      where: {
        OR: [
          { erpBranchId: { in: [bidA, bidB, bidC] } },
          { code: { startsWith: prefix } },
        ],
      },
    });
    await db.erpSyncRun.deleteMany({ where: { actorStaffId: adminId } });
    await app.close();
    fake.close();
  }
});
