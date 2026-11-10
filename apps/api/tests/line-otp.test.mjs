import assert from 'node:assert/strict';
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { cleanup, PASSWORD, seedWorld, startApi } from './support.mjs';

const { hashPassword } = await import('../dist/accounts/password.js');

// Stand-ins for the two outside services: the LINE Messaging API and UFHR's /staff-contacts.
// stall = answer with headers and half a body, then nothing; mismatch = HR answers about somebody else
const line = { calls: [], status: 200, stall: false };
const hr = { calls: [], lineOf: new Map(), status: 200, stall: false, mismatch: false };
const listen = (handler) =>
  new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let raw = '';
      req.on('data', (c) => (raw += c));
      req.on('end', () => {
        res.setHeader('content-type', 'application/json');
        handler(req, raw, res);
      });
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
const lineServer = await listen((req, raw, res) => {
  line.calls.push({ method: req.method, url: req.url, auth: req.headers.authorization, body: JSON.parse(raw || '{}') });
  res.statusCode = line.status;
  if (line.stall) return res.write('{"sentMessages":[');
  res.end(JSON.stringify(line.status === 200 ? { sentMessages: [{ id: '1' }] } : { message: 'You have reached your monthly limit.' }));
});
const hrServer = await listen((req, raw, res) => {
  const url = new URL(req.url, 'http://x');
  hr.calls.push({ path: url.pathname, ids: url.searchParams.get('ids'), auth: req.headers.authorization });
  res.statusCode = hr.status;
  if (hr.stall) return res.write('{"staff":[');
  if (hr.status !== 200) return res.end(JSON.stringify({ error: 'boom' }));
  const staff = url.searchParams
    .get('ids')
    .split(',')
    .filter((id) => hr.lineOf.has(id))
    .map((id) => ({ staffId: Number(id) + (hr.mismatch ? 1 : 0), lineUid: hr.lineOf.get(id), email: null, name: 'x' }));
  res.end(JSON.stringify({ staff }));
});
const port = (s) => s.address().port;
const LINE_ENV = {
  LINE_CHANNEL_ACCESS_TOKEN: 'line-token',
  LINE_API_URL: `http://127.0.0.1:${port(lineServer)}`,
  LINE_TIMEOUT_MS: '300',
};
const HR_ENV = { UFHR_API_BASE: `http://127.0.0.1:${port(hrServer)}/api/external/`, UFHR_API_KEY: 'hr-key' };
const ALL = [...Object.keys(LINE_ENV), ...Object.keys(HR_ENV), 'OTP_GLOBAL_DAILY_LIMIT'];
const clearEnv = () => ALL.forEach((k) => delete process.env[k]);
const until = async (check, ms = 3000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = await check();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 25));
  }
  return null;
};
const uid = (n) => `U${String(n).padStart(32, '0')}`;
const codeIn = (text) => text.match(/\b(\d{6})\b/)[1];

test('LINE OTP login on the UFiconStaff OA: UFHR first, then the ERP copy, and no SMS (D113, D117)', async (t) => {
  const ctx = await startApi(t);
  if (!ctx) {
    [lineServer, hrServer].forEach((s) => {
      s.closeAllConnections?.();
      s.close();
    });
    return;
  }
  const { db, request } = ctx;
  let world;
  const mine = [];
  try {
    clearEnv();
    world = await seedWorld(ctx);
    const { prefix, cookies, branches } = world;
    const erpBase = 800_000_000 + Math.floor(Math.random() * 90_000_000);
    const people = {};
    const mk = async (name, n, data) => {
      const staffId = `${prefix}-${name}`;
      mine.push(staffId);
      people[name] = { staffId, erp: erpBase + n };
      await db.staff.create({
        data: {
          staffId,
          passwordHash: await hashPassword(PASSWORD),
          mustChangePassword: false,
          erpStaffId: erpBase + n,
          branchId: branches.a.id,
          roles: { create: { roleCode: 'STAFF' } },
          ...data,
        },
      });
    };
    await mk('stored', 1, { lineUserId: uid(1), phone: '0830000001' }); // the ERP import gave a LINE userId
    await mk('hronly', 2, {}); // only UFHR knows the LINE; no phone
    await mk('phone', 3, { phone: '0830000003' }); // no LINE anywhere
    await mk('none', 4, {}); // nothing at all
    const ask = (who) => request('/auth/otp/request', 'POST', { staffId: people[who].staffId });
    const rowOf = (who, status = 'sent') =>
      until(async () => {
        const r = await db.loginOtp.findFirst({ where: { staffId: people[who].staffId }, orderBy: { createdAt: 'desc' } });
        return r && r.smsStatus === status ? r : null;
      });
    const reset = () => db.loginOtp.deleteMany({ where: { staffId: { in: mine } } });

    await t.test('LINE alone turns OTP on; the code goes to the stored LINE userId with the channel token', async () => {
      Object.assign(process.env, LINE_ENV);
      assert.deepEqual((await request('/auth/config')).data, { otp: true });
      assert.equal(
        (await request('/auth/login', 'POST', { staffId: people.stored.staffId, password: PASSWORD })).status,
        401,
        'an ERP account no longer signs in with a password',
      );
      for (const who of ['stored', 'hronly', 'phone', 'none']) assert.deepEqual((await ask(who)).data, { ok: true });
      const call = await until(() => line.calls[0]);
      await new Promise((r) => setTimeout(r, 150));
      assert.equal(line.calls.length, 1, 'only the person LINE can reach (no UFHR here; a phone alone gets nothing)');
      assert.equal(call.method, 'POST');
      assert.equal(call.url, '/v2/bot/message/push');
      assert.equal(call.auth, 'Bearer line-token');
      assert.equal(call.body.to, uid(1));
      assert.match(call.body.messages[0].text, /SES: \d{6}/);
      const row = await rowOf('stored');
      assert.equal(row.channel, 'line');
      assert.equal(row.smsError, null);
      assert.equal(row.phoneLast4, '', 'no phone digits are kept');
      assert.equal(await db.loginOtp.count({ where: { staffId: { in: [people.hronly.staffId, people.phone.staffId, people.none.staffId] } } }), 0);
      const signedIn = await request('/auth/otp/verify', 'POST', { staffId: people.stored.staffId, code: codeIn(call.body.messages[0].text) });
      assert.equal(signedIn.status, 201, JSON.stringify(signedIn.data));
      assert.equal(signedIn.data.staffId, people.stored.staffId);
      await reset();
    });

    await t.test('with UFHR set, UFHR is asked first (own key, ERP staff id) and wins over the ERP copy', async () => {
      Object.assign(process.env, HR_ENV);
      hr.lineOf.set(String(people.hronly.erp), uid(2));
      hr.lineOf.set(String(people.stored.erp), uid(11));
      line.calls.length = 0;
      await ask('hronly');
      await ask('stored');
      assert.ok(await until(() => line.calls.length === 2));
      assert.deepEqual(line.calls.map((c) => c.body.to).sort(), [uid(11), uid(2)].sort());
      assert.ok(hr.calls.every((c) => c.auth === 'Bearer hr-key' && c.path === '/api/external/staff-contacts'));
      assert.deepEqual(hr.calls.map((c) => c.ids).sort(), [String(people.hronly.erp), String(people.stored.erp)].sort());
      assert.equal((await rowOf('hronly')).channel, 'line');
      assert.equal((await db.loginOtp.findFirst({ where: { staffId: people.hronly.staffId } })).phoneLast4, '', 'no phone, no digits');
      await reset();
    });

    await t.test('UFHR down or without the person: the ERP copy is used; nobody to send to: failed with the reason', async () => {
      hr.status = 500;
      line.calls.length = 0;
      await ask('stored');
      await ask('hronly');
      assert.ok(await until(() => line.calls.length === 1));
      assert.equal(line.calls[0].body.to, uid(1), 'UFHR answered 500: the stored copy');
      const failed = await rowOf('hronly', 'failed');
      assert.match(failed.smsError, /LINE: UFHR ปฏิเสธ \(500\).*ไม่มีใน ERP/);
      hr.status = 200;
      hr.lineOf.delete(String(people.hronly.erp));
      await reset();
      await ask('hronly');
      assert.match((await rowOf('hronly', 'failed')).smsError, /UFHR ไม่มี LINE ของคนนี้/);
      await reset();
    });

    await t.test('no fallback: a LINE refusal or no LINE for the person is a failed code with the reason, nothing goes to their phone', async () => {
      hr.lineOf.set(String(people.stored.erp), uid(11));
      line.status = 429;
      line.calls.length = 0;
      await ask('stored');
      const refused = await rowOf('stored', 'failed');
      assert.equal(refused.channel, 'line');
      assert.match(refused.smsError, /LINE: LINE ปฏิเสธ \(429 You have reached your monthly limit\.\)/);
      assert.equal(line.calls.length, 1, 'one try, no second channel');
      line.status = 200;
      await reset();

      // HR has no LINE for a person who has a phone: the code fails with HR's answer, and the phone is never used
      await ask('phone');
      const noLine = await rowOf('phone', 'failed');
      assert.match(noLine.smsError, /UFHR ไม่มี LINE ของคนนี้/);
      assert.equal(line.calls.length, 1, 'nothing more went out');
      await reset();
    });

    await t.test("UFHR's answer is final: unlinked there means no LINE code even with an older ERP copy; a mismatched answer counts as unlinked; UFHR down means the ERP copy", async () => {
      await reset();
      hr.lineOf.clear();
      line.calls.length = 0;
      await ask('stored'); // has an ERP copy (uid 1) and a phone; HR says it has no LINE for them
      const unlinked = await rowOf('stored', 'failed');
      assert.equal(line.calls.length, 0, 'HR unlinked the person: the older ERP copy is not used');
      assert.match(unlinked.smsError, /UFHR ไม่มี LINE/);

      await reset();
      hr.lineOf.set(String(people.stored.erp), uid(11));
      hr.mismatch = true; // HR answers, but about another staff id
      await ask('stored');
      await rowOf('stored', 'failed');
      assert.equal(line.calls.length, 0, 'an answer about somebody else is not this person');
      hr.mismatch = false;

      await reset();
      hr.status = 500; // HR cannot answer: only then the ERP copy is used
      await ask('stored');
      assert.ok(await until(() => line.calls.length === 1));
      assert.equal(line.calls[0].body.to, uid(1));
      assert.equal((await rowOf('stored')).channel, 'line');
      hr.status = 200;
      await reset();
    });

    await t.test('a LINE success is recorded as sent; LINE codes count against the system-wide daily cap', async () => {
      await reset();
      hr.lineOf.set(String(people.stored.erp), uid(11));
      line.calls.length = 0;
      await ask('stored');
      assert.ok(await until(() => line.calls.length === 1));
      const row = await rowOf('stored');
      assert.equal(row.channel, 'line');
      assert.equal(row.smsError, null);

      await reset();
      // one code for somebody else, so the cap is at least 1 (0 would mean "unset")
      await db.loginOtp.create({ data: { id: randomUUID(), staffId: people.none.staffId, codeHash: 'x'.repeat(64), phoneLast4: '', expiresAt: new Date() } });
      const used = await db.loginOtp.count({ where: { createdAt: { gte: new Date(Date.now() - 24 * 3600_000) } } });
      process.env.OTP_GLOBAL_DAILY_LIMIT = String(used);
      try {
        await ask('stored');
        await new Promise((r) => setTimeout(r, 200));
        assert.equal(line.calls.length, 1, 'the system-wide cap stops LINE codes too');
        assert.equal(await db.loginOtp.count({ where: { staffId: people.stored.staffId } }), 0);
      } finally {
        delete process.env.OTP_GLOBAL_DAILY_LIMIT;
      }
      await reset();
    });

    await t.test('an answer that stalls after its headers ends at the deadline (the deadline covers the body)', async () => {
      await reset();
      hr.lineOf.set(String(people.stored.erp), uid(11));
      line.calls.length = 0;
      line.stall = true; // LINE: headers, then nothing
      const started = Date.now();
      await ask('stored');
      const row = await rowOf('stored', 'failed');
      assert.ok(row, 'the attempt ends at the deadline and is recorded as failed (it does not hang)');
      assert.ok(Date.now() - started < 3000);
      assert.match(row.smsError, /LINE: LINE ไม่ตอบภายใน 0\.3 วินาที/);
      line.stall = false;

      await reset();
      line.calls.length = 0;
      hr.stall = true; // UFHR: headers, then nothing: the ERP copy is used
      await ask('stored');
      assert.ok(await until(() => line.calls.length === 1, 4000));
      assert.equal(line.calls[0].body.to, uid(1));
      assert.equal((await rowOf('stored')).channel, 'line');
      hr.stall = false;
      await reset();
    });

    await t.test('ADMIN: LINE set-up and counts, the channel per code, and a test LINE message to a staff member', async () => {
      await ask('stored');
      await rowOf('stored');
      for (const who of ['staff', 'stock', 'manager'])
        assert.equal((await request('/admin/otp/test-line', 'POST', { staffId: people.stored.staffId }, cookies[who])).status, 403, who);
      const status = await request('/admin/otp', 'GET', undefined, cookies.admin);
      assert.equal(status.status, 200);
      assert.equal(status.data.otp, true);
      assert.equal(status.data.line.configured, true);
      assert.equal(status.data.line.ufhrConfigured, true);
      assert.ok(status.data.line.erpWithLine >= 1 && status.data.line.erpActive >= 4);
      assert.equal(status.data.rows.find((r) => r.staffId === people.stored.staffId).channel, 'line');
      const text = JSON.stringify(status.data);
      assert.ok(!text.includes('line-token') && !text.includes('hr-key'), 'no token or key');
      for (const k of [1, 2, 4, 11]) assert.ok(!text.includes(uid(k)), `no LINE userId (${k})`);

      line.calls.length = 0;
      const sent = await request('/admin/otp/test-line', 'POST', { staffId: people.stored.staffId }, cookies.admin);
      assert.equal(sent.status, 201, JSON.stringify(sent.data));
      assert.deepEqual(sent.data, { ok: true, source: 'ufhr' });
      assert.equal(line.calls[0].body.to, uid(11));
      hr.lineOf.clear();
      const final = await request('/admin/otp/test-line', 'POST', { staffId: people.stored.staffId }, cookies.admin);
      assert.equal(final.status, 400, "UFHR's answer is final: no LINE there, no test to the ERP copy");
      assert.match(final.data.message, /UFHR ไม่มี LINE/);
      delete process.env.UFHR_API_BASE;
      assert.deepEqual((await request('/admin/otp/test-line', 'POST', { staffId: people.stored.staffId }, cookies.admin)).data, { ok: true, source: 'erp' }, 'without UFHR the ERP copy is used');
      Object.assign(process.env, HR_ENV);
      const missing = await request('/admin/otp/test-line', 'POST', { staffId: people.phone.staffId }, cookies.admin);
      assert.equal(missing.status, 400);
      assert.match(missing.data.message, /UFHR ไม่มี LINE/);
      assert.equal((await request('/admin/otp/test-line', 'POST', { staffId: `${prefix}-nobody` }, cookies.admin)).status, 400);
      line.status = 429;
      assert.equal((await request('/admin/otp/test-line', 'POST', { staffId: people.stored.staffId }, cookies.admin)).status, 400, 'a refusal is shown');
      line.status = 200;
      for (const k of Object.keys(LINE_ENV)) delete process.env[k];
      assert.equal((await request('/admin/otp/test-line', 'POST', { staffId: people.stored.staffId }, cookies.admin)).status, 400, 'LINE not set up');
    });
  } finally {
    clearEnv();
    await db.loginOtp.deleteMany({ where: { staffId: { in: mine } } }).catch(() => undefined);
    await db.loginSession.deleteMany({ where: { staffId: { in: mine } } }).catch(() => undefined);
    await db.staffRole.deleteMany({ where: { staffId: { in: mine } } }).catch(() => undefined);
    await db.staff.deleteMany({ where: { staffId: { in: mine } } }).catch(() => undefined);
    [lineServer, hrServer].forEach((s) => {
      s.closeAllConnections?.();
      s.close();
    });
    await cleanup(ctx, world);
  }
});
