import assert from 'node:assert/strict';
import http from 'node:http';
import { createHash, randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { cleanup, PASSWORD, seedWorld, startApi } from './support.mjs';

const { SESSION_MS, hashPassword } = await import('../dist/accounts/password.js');

// A stand-in for the LINE Messaging API: remembers every push and answers like it (200, or 429 when told to refuse).
const line = { calls: [], reply: 'ok' };
const fake = http.createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', () => {
    line.calls.push({ method: req.method, url: req.url, auth: req.headers.authorization, body: JSON.parse(raw || '{}') });
    res.setHeader('content-type', 'application/json');
    if (line.reply === 'rejected') {
      res.statusCode = 429;
      return res.end(JSON.stringify({ message: 'You have reached your monthly limit.' }));
    }
    res.end(JSON.stringify({ sentMessages: [{ id: `m-${line.calls.length}` }] }));
  });
});
await new Promise((resolve) => fake.listen(0, '127.0.0.1', resolve));
const ENV = {
  LINE_CHANNEL_ACCESS_TOKEN: 'test-line-token',
  LINE_API_URL: `http://127.0.0.1:${fake.address().port}`,
};
const setEnv = () => Object.assign(process.env, ENV);
const clearEnv = () => {
  for (const k of [...Object.keys(ENV), 'OTP_GLOBAL_DAILY_LIMIT']) delete process.env[k];
};
const until = async (check, ms = 3000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = await check();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 25));
  }
  return null;
};
const codeOf = (call) => call.body.messages[0].text.match(/\b(\d{6})\b/)[1];
const uid = (n) => `U${String(n).padStart(32, '0')}`;

test('OTP login by LINE: request, verify, limits, 12-hour session, the admin view and no SMS left (D85, D113, D117)', async (t) => {
  const ctx = await startApi(t);
  if (!ctx) {
    fake.close();
    return;
  }
  const { db, request } = ctx;
  let world;
  try {
    world = await seedWorld(ctx);
    const { prefix, cookies, staffIds, branches } = world;
    const base = await ctx.app.getUrl();
    const phoneFor = (n) => `08${String(30000000 + n).slice(-8)}`;
    const mk = (name, data) =>
      db.staff.create({
        data: {
          staffId: `${prefix}-${name}`,
          passwordHash: 'x',
          mustChangePassword: false,
          ...data,
        },
      });
    const erpNo = 700_000_000 + Math.floor(Math.random() * 90_000_000);
    await mk('erp', { erpStaffId: erpNo, lineUserId: uid(1), phone: phoneFor(1), branchId: branches.a.id, roles: { create: { roleCode: 'STAFF' } } });
    // a phone but no LINE: SMS is gone, so there is nothing to send a code to
    await mk('noline', { phone: phoneFor(2), branchId: branches.a.id, roles: { create: { roleCode: 'STAFF' } } });
    await mk('off', { active: false, lineUserId: uid(3), phone: phoneFor(3), branchId: branches.a.id, roles: { create: { roleCode: 'STAFF' } } });
    const id = (n) => `${prefix}-${n}`;
    const requestOtp = (staffId) => request('/auth/otp/request', 'POST', { staffId });
    const verify = (staffId, code) => request('/auth/otp/verify', 'POST', { staffId, code });
    const lastOtp = (staffId) => db.loginOtp.findFirst({ where: { staffId }, orderBy: { createdAt: 'desc' } });
    const age = (staffId, ms) =>
      db.loginOtp.updateMany({ where: { staffId }, data: { createdAt: new Date(Date.now() - ms) } });

    await t.test('off until the LINE token is configured: password login as before', async () => {
      clearEnv();
      assert.deepEqual((await request('/auth/config')).data, { otp: false });
      assert.equal((await requestOtp(id('erp'))).status, 400);
      assert.equal((await verify(id('erp'), '123456')).status, 400);
      assert.equal(line.calls.length, 0);
    });

    setEnv();

    await t.test('on once configured; ERP accounts lose password login, hand-made accounts keep it', async () => {
      assert.deepEqual((await request('/auth/config')).data, { otp: true });
      await db.staff.update({
        where: { staffId: id('erp') },
        data: { passwordHash: await hashPassword(PASSWORD) },
      });
      assert.equal((await request('/auth/login', 'POST', { staffId: id('erp'), password: PASSWORD })).status, 401);
      assert.equal((await request('/auth/login', 'POST', { staffId: staffIds.admin, password: PASSWORD })).status, 201);
    });

    await t.test('request: one LINE message to the right userId, nothing for anyone who cannot get it, the same answer for all', async () => {
      const answers = [];
      for (const staffId of [id('erp'), id('noline'), id('off'), `${prefix}-nobody`])
        answers.push(await requestOtp(staffId));
      assert.ok(answers.every((a) => a.status === 201 && JSON.stringify(a.data) === '{"ok":true}'), JSON.stringify(answers.map((a) => a.data)));
      const call = await until(() => line.calls[0]);
      assert.ok(call, 'a LINE message was sent');
      await new Promise((r) => setTimeout(r, 150));
      assert.equal(line.calls.length, 1, 'only the eligible account got a code (a phone alone is not a way to reach anyone)');
      assert.equal(call.method, 'POST');
      assert.equal(call.url, '/v2/bot/message/push');
      assert.equal(call.auth, 'Bearer test-line-token');
      assert.equal(call.body.to, uid(1));
      assert.match(call.body.messages[0].text, /OTP.*\d{6}/);
      const row = await until(async () => {
        const r = await lastOtp(id('erp'));
        return r?.smsStatus === 'sent' ? r : null;
      });
      assert.ok(row, 'the row records that it was sent');
      assert.equal(row.channel, 'line');
      assert.equal(row.smsError, null);
      assert.equal(row.phoneLast4, '', 'no phone digits are kept');
      assert.equal(row.attempts, 0);
      assert.notEqual(row.codeHash, codeOf(call), 'only a hash is kept');
      assert.ok(!JSON.stringify(row).includes(uid(1)), 'not the LINE userId');
      assert.ok(Math.abs(row.expiresAt.getTime() - row.createdAt.getTime() - 5 * 60_000) < 2000, '5 minutes');
      assert.equal(await db.loginOtp.count({ where: { staffId: { in: [id('noline'), id('off'), `${prefix}-nobody`] } } }), 0);
    });

    await t.test('one code a minute, five an hour, ten a day', async () => {
      const before = line.calls.length;
      await requestOtp(id('erp'));
      await new Promise((r) => setTimeout(r, 150));
      assert.equal(line.calls.length, before, 'a second request within a minute sends nothing');
      await age(id('erp'), 61_000);
      await requestOtp(id('erp'));
      assert.ok(await until(() => line.calls.length === before + 1), 'after a minute a new code goes');
      // fill the hour: 5 codes within the last hour in total
      const have = await db.loginOtp.count({ where: { staffId: id('erp') } });
      for (let i = have; i < 5; i++)
        await db.loginOtp.create({ data: { id: randomUUID(), staffId: id('erp'), codeHash: 'x'.repeat(64), phoneLast4: '0000', createdAt: new Date(Date.now() - 120_000 - i * 1000), expiresAt: new Date() } });
      await db.loginOtp.updateMany({ where: { staffId: id('erp'), createdAt: { gt: new Date(Date.now() - 100_000) } }, data: { createdAt: new Date(Date.now() - 90_000) } });
      const n = line.calls.length;
      await requestOtp(id('erp'));
      await new Promise((r) => setTimeout(r, 150));
      assert.equal(line.calls.length, n, 'the sixth code within the hour is not sent');
      // a code from yesterday-ish does not count against the hour but against the day
      await db.loginOtp.deleteMany({ where: { staffId: id('erp') } });
      for (let i = 0; i < 10; i++)
        await db.loginOtp.create({ data: { id: randomUUID(), staffId: id('erp'), codeHash: 'x'.repeat(64), phoneLast4: '0000', createdAt: new Date(Date.now() - 2 * 3600_000 - i * 1000), expiresAt: new Date() } });
      await requestOtp(id('erp'));
      await new Promise((r) => setTimeout(r, 150));
      assert.equal(line.calls.length, n, 'the eleventh code within the day is not sent');
      await db.loginOtp.deleteMany({ where: { staffId: id('erp') } });
    });

    await t.test('the daily cap for the whole system stops everybody', async () => {
      await db.loginOtp.create({ data: { id: randomUUID(), staffId: id('noline'), codeHash: 'x'.repeat(64), phoneLast4: '0000', expiresAt: new Date() } });
      const used = await db.loginOtp.count({ where: { createdAt: { gte: new Date(Date.now() - 24 * 3600_000) } } });
      process.env.OTP_GLOBAL_DAILY_LIMIT = String(used);
      const n = line.calls.length;
      await requestOtp(id('erp'));
      await new Promise((r) => setTimeout(r, 150));
      assert.equal(line.calls.length, n);
      delete process.env.OTP_GLOBAL_DAILY_LIMIT;
      await db.loginOtp.deleteMany({ where: { staffId: id('noline') } });
    });

    let sessionCookie = '';
    await t.test('verify: wrong codes, burnt code, expired code, then the right code starts a 12-hour session', async () => {
      await db.loginOtp.deleteMany({ where: { staffId: id('erp') } });
      const n = line.calls.length;
      await requestOtp(id('erp'));
      const call = await until(() => (line.calls.length > n ? line.calls.at(-1) : null));
      const code = codeOf(call);
      const wrong = code === '000000' ? '111111' : '000000';
      assert.equal((await verify(id('erp'), wrong)).status, 401);
      assert.equal((await verify(`${prefix}-nobody`, code)).status, 401);
      assert.equal((await verify(id('noline'), code)).status, 401);
      assert.equal((await verify(id('off'), code)).status, 401);
      assert.equal((await lastOtp(id('erp'))).attempts, 1);
      for (let i = 0; i < 4; i++) assert.equal((await verify(id('erp'), wrong)).status, 401);
      assert.equal((await verify(id('erp'), code)).status, 401, 'five wrong tries burn the code, even the right one');
      // a fresh code
      await age(id('erp'), 61_000);
      const m = line.calls.length;
      await requestOtp(id('erp'));
      const call2 = await until(() => (line.calls.length > m ? line.calls.at(-1) : null));
      const code2 = codeOf(call2);
      // expired
      const fresh = await lastOtp(id('erp'));
      await db.loginOtp.update({ where: { id: fresh.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
      assert.equal((await verify(id('erp'), code2)).status, 401, 'expired');
      await db.loginOtp.update({ where: { id: fresh.id }, data: { expiresAt: new Date(Date.now() + 60_000) } });
      // the right one, through a raw request to see the cookie
      const res = await fetch(`${base}/api/auth/otp/verify`, {
        method: 'POST',
        headers: { Origin: 'http://localhost:5174', 'X-Requested-With': 'ServiceEfficiency', 'Content-Type': 'application/json' },
        body: JSON.stringify({ staffId: id('erp'), code: code2 }),
      });
      assert.equal(res.status, 201);
      const user = await res.json();
      assert.equal(user.staffId, id('erp'));
      assert.equal(user.phone, `${phoneFor(1).slice(0, 2)}X-XXX-${phoneFor(1).slice(-4)}`, 'the account shows its number masked');
      assert.equal(user.hasLine, true);
      const setCookie = res.headers.get('set-cookie');
      assert.match(setCookie, /se_session=[a-f0-9]{64}/);
      assert.match(setCookie, new RegExp(`Max-Age=${SESSION_MS / 1000}`), 'the cookie lives 12 hours');
      assert.match(setCookie, /HttpOnly/);
      sessionCookie = setCookie.split(';')[0];
      assert.equal((await request('/auth/me', 'GET', undefined, sessionCookie)).status, 200);
      assert.equal((await verify(id('erp'), code2)).status, 401, 'a code works once');
      const used = await lastOtp(id('erp'));
      assert.ok(used.consumedAt);
    });

    await t.test('a refused LINE push is recorded, not shown to the person asking', async () => {
      line.reply = 'rejected';
      await db.loginOtp.deleteMany({ where: { staffId: id('erp') } });
      const res = await requestOtp(id('erp'));
      assert.equal(res.status, 201);
      const row = await until(async () => {
        const r = await lastOtp(id('erp'));
        return r?.smsStatus === 'failed' ? r : null;
      });
      assert.ok(row, 'the row says failed');
      assert.match(row.smsError, /LINE: LINE ปฏิเสธ \(429/);
      assert.ok(!row.smsError.includes('test-line-token'));
      line.reply = 'ok';
      // nobody to send to: failed with the reason, not an exception
      await db.staff.update({ where: { staffId: id('erp') }, data: { lineUserId: null } });
      await db.loginOtp.deleteMany({ where: { staffId: id('erp') } });
      assert.equal((await requestOtp(id('erp'))).status, 201);
      assert.equal((await db.loginOtp.count({ where: { staffId: id('erp') } })), 0, 'no LINE userId and no UFHR: no code at all');
      await db.staff.update({ where: { staffId: id('erp') }, data: { lineUserId: uid(1) } });
    });

    await t.test('SMS is gone: its webhook and test endpoint no longer exist', async () => {
      assert.equal((await fetch(`${base}/api/webhooks/thaibulksms/webhook-token-0123456789`, { method: 'POST' })).status, 404);
      assert.equal((await request('/admin/otp/test-sms', 'POST', { phone: phoneFor(9) }, cookies.admin)).status, 404);
    });

    await t.test('the 12-hour session counts from the login, not from the last click', async () => {
      const hash = createHash('sha256').update(sessionCookie.split('=')[1]).digest('hex');
      await db.loginSession.update({ where: { tokenHash: hash }, data: { lastSeenAt: new Date(Date.now() - 11 * 3600_000), createdAt: new Date(Date.now() - SESSION_MS + 60_000) } });
      assert.equal((await request('/auth/me', 'GET', undefined, sessionCookie)).status, 200);
      await db.loginSession.update({ where: { tokenHash: hash }, data: { createdAt: new Date(Date.now() - SESSION_MS - 1) } });
      assert.equal((await request('/auth/me', 'GET', undefined, sessionCookie)).status, 401);
    });

    await t.test('ADMIN sees the set-up and the latest codes (never a code, a token or a LINE userId)', async () => {
      for (const who of ['staff', 'stock', 'manager'])
        assert.equal((await request('/admin/otp', 'GET', undefined, cookies[who])).status, 403, who);
      assert.equal((await request('/admin/otp')).status, 401);
      await db.loginOtp.deleteMany({ where: { staffId: id('erp') } });
      await requestOtp(id('erp'));
      assert.ok(await until(async () => (await lastOtp(id('erp')))?.smsStatus === 'sent'), 'a code to list');
      const res = await request('/admin/otp', 'GET', undefined, cookies.admin);
      assert.equal(res.status, 200);
      assert.equal(res.data.otp, true);
      assert.equal(res.data.line.configured, true);
      assert.equal(res.data.line.ufhrConfigured, false);
      assert.ok(res.data.line.erpWithLine >= 1 && res.data.line.erpActive >= res.data.line.erpWithLine);
      assert.ok(res.data.rows.length > 0);
      assert.ok(res.data.rows.every((r) => r.channel && !('phoneLast4' in r)));
      assert.ok(!('sender' in res.data) && !('webhookConfigured' in res.data), 'no SMS set-up is reported');
      const text = JSON.stringify(res.data);
      assert.ok(!text.includes('codeHash') && !text.includes(phoneFor(1)) && !text.includes('test-line-token') && !text.includes(uid(1)));
    });

    await t.test('phones: ADMIN sets one on a hand-made account; an ERP account\'s phone is the ERP\'s', async () => {
      const staff = (await request('/staff', 'GET', undefined, cookies.admin)).data;
      const manager = staff.find((s) => s.staffId === staffIds.manager);
      const put = (staffId, body) => request(`/staff/${staffId}`, 'PUT', body, cookies.admin);
      const base = (s) => ({ firstName: s.firstName, lastName: s.lastName, roles: s.roles, branchId: s.branchId, active: s.active });
      const ok = await put(staffIds.manager, { ...base(manager), phone: phoneFor(5) });
      assert.equal(ok.status, 200, JSON.stringify(ok.data));
      assert.equal(ok.data.phone, `${phoneFor(5).slice(0, 2)}X-XXX-${phoneFor(5).slice(-4)}`);
      assert.equal((await db.staff.findUnique({ where: { staffId: staffIds.manager } })).phone, phoneFor(5));
      assert.equal((await put(staffIds.manager, { ...base(manager), phone: '12345' })).status, 400);
      assert.equal((await put(staffIds.manager, { ...base(manager), phone: null })).status, 200);
      assert.equal((await db.staff.findUnique({ where: { staffId: staffIds.manager } })).phone, null, 'null clears it');
      const erpAcc = (await request('/staff', 'GET', undefined, cookies.admin)).data.find((s) => s.staffId === id('erp'));
      const bad = await put(id('erp'), { ...base(erpAcc), phone: phoneFor(7) });
      assert.equal(bad.status, 409);
      assert.equal((await put(id('erp'), base(erpAcc))).status, 200, 'saving without touching the phone is fine');
    });

    await t.test('the ADMIN of a fresh install (no LINE) still gets in with the password, and OTP works for an admin who has a LINE userId', async () => {
      await db.staff.update({ where: { staffId: staffIds.admin }, data: { lineUserId: uid(8) } });
      await db.loginOtp.deleteMany({ where: { staffId: staffIds.admin } });
      const n = line.calls.length;
      await requestOtp(staffIds.admin);
      const call = await until(() => (line.calls.length > n ? line.calls.at(-1) : null));
      assert.ok(call);
      assert.equal(call.body.to, uid(8));
      const res = await verify(staffIds.admin, codeOf(call));
      assert.equal(res.status, 201, JSON.stringify(res.data));
      assert.deepEqual(res.data.roles, ['ADMIN']);
    });
  } finally {
    clearEnv();
    await db.loginOtp.deleteMany({ where: { staffId: { startsWith: world?.prefix ?? 'zz-none' } } }).catch(() => undefined);
    if (world) {
      const mine = [`${world.prefix}-erp`, `${world.prefix}-noline`, `${world.prefix}-off`];
      await db.loginSession.deleteMany({ where: { staffId: { in: mine } } });
      await db.staffRole.deleteMany({ where: { staffId: { in: mine } } });
      await db.staff.deleteMany({ where: { staffId: { in: mine } } });
    }
    fake.close();
    await cleanup(ctx, world);
  }
});
