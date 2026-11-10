import assert from 'node:assert/strict';
import http from 'node:http';
import { test } from 'node:test';
import { cleanup, PASSWORD, seedWorld, startApi } from './support.mjs';

const { hashPassword } = await import('../dist/accounts/password.js');

// Stand-ins for the LINE Messaging API and UFHR's FileMaker Data API (database UFHR, layout api_staff, D118).
const line = { calls: [] };
const fm = { calls: [], rows: [], down: false, sessions: new Set() };
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
  line.calls.push(JSON.parse(raw || '{}'));
  res.end(JSON.stringify({ sentMessages: [{ id: '1' }] }));
});
const fmAnswer = (res, status, code, response = {}) => {
  res.statusCode = status;
  res.end(JSON.stringify({ response, messages: [{ code: String(code), message: code === 0 ? 'OK' : 'x' }] }));
};
const fmServer = await listen((req, raw, res) => {
  const url = new URL(req.url, 'http://x');
  fm.calls.push({ method: req.method, path: url.pathname, auth: req.headers.authorization, body: raw ? JSON.parse(raw) : null });
  if (fm.down) return fmAnswer(res, 500, 952, {});
  const base = '/fmi/data/vLatest/databases/UFHR';
  if (req.method === 'POST' && url.pathname === `${base}/sessions`) {
    if (req.headers.authorization !== `Basic ${Buffer.from('staff_api:fm-pass').toString('base64')}`) return fmAnswer(res, 401, 212);
    const token = `tok-${fm.calls.length}`;
    fm.sessions.add(token);
    return fmAnswer(res, 200, 0, { token });
  }
  if (req.method === 'DELETE' && url.pathname.startsWith(`${base}/sessions/`)) {
    fm.sessions.delete(decodeURIComponent(url.pathname.split('/').pop()));
    return fmAnswer(res, 200, 0);
  }
  if (!fm.sessions.has(String(req.headers.authorization).replace('Bearer ', ''))) return fmAnswer(res, 401, 952);
  const asData = (rows) => ({ data: rows.map((fieldData) => ({ fieldData })), dataInfo: { foundCount: rows.length } });
  if (req.method === 'POST' && url.pathname === `${base}/layouts/api_staff/_find`) {
    const wanted = JSON.parse(raw).query.map((q) => q.staff_id.replace('==', ''));
    const found = fm.rows.filter((r) => wanted.includes(String(r.staff_id)));
    return found.length ? fmAnswer(res, 200, 0, asData(found)) : fmAnswer(res, 500, 401);
  }
  if (req.method === 'GET' && url.pathname === `${base}/layouts/api_staff/records`) return fmAnswer(res, 200, 0, asData(fm.rows));
  return fmAnswer(res, 404, 105);
});
const port = (s) => s.address().port;
const ENV = {
  LINE_CHANNEL_ACCESS_TOKEN: 'line-token',
  LINE_API_URL: `http://127.0.0.1:${port(lineServer)}`,
  LINE_TIMEOUT_MS: '1000',
  UFHR_FM_HOST: `http://127.0.0.1:${port(fmServer)}`,
  UFHR_FM_USER: 'staff_api',
  UFHR_FM_PASSWORD: 'fm-pass',
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
const uid = (n) => `U${String(n).padStart(32, '0')}`;

test("LINE userIds from UFHR's FileMaker layout api_staff (D118)", async (t) => {
  const ctx = await startApi(t);
  if (!ctx) {
    [lineServer, fmServer].forEach((s) => s.close());
    return;
  }
  const { db, request } = ctx;
  let world;
  const mine = [];
  try {
    Object.assign(process.env, ENV);
    world = await seedWorld(ctx);
    const { prefix, cookies, branches } = world;
    const erpBase = 900_000_000 + Math.floor(Math.random() * 90_000_000);
    const people = {};
    const mk = async (name, n, data = {}) => {
      const staffId = `${prefix}-${name}`;
      mine.push(staffId);
      people[name] = { staffId, erp: erpBase + n };
      await db.staff.create({
        data: { staffId, passwordHash: await hashPassword(PASSWORD), mustChangePassword: false, erpStaffId: erpBase + n, branchId: branches.a.id, roles: { create: { roleCode: 'STAFF' } }, ...data },
      });
    };
    await mk('linked', 1); // nothing stored in SES, UFHR has the LINE
    await mk('left', 2, { lineUserId: uid(92) }); // an old ERP copy; UFHR says the person is no longer Active
    await mk('unknown', 3, { lineUserId: uid(93) }); // an old ERP copy; UFHR does not know the person
    fm.rows = [
      { staff_id: people.linked.erp, line_uid: uid(1), status: 'Active', name_full_th: 'ก' },
      { staff_id: people.left.erp, line_uid: uid(2), status: 'Resign', name_full_th: 'ข' },
    ];
    const ask = (who) => request('/auth/otp/request', 'POST', { staffId: people[who].staffId });
    const rowOf = (who, status) =>
      until(async () => {
        const r = await db.loginOtp.findFirst({ where: { staffId: people[who].staffId }, orderBy: { createdAt: 'desc' } });
        return r && r.smsStatus === status ? r : null;
      });

    await t.test('the code goes to the LINE UFHR holds, found by staff id with the read-only account; the session is given back', async () => {
      assert.equal((await ask('linked')).status, 201);
      assert.ok(await until(() => line.calls.length === 1));
      assert.equal(line.calls[0].to, uid(1));
      assert.ok(await rowOf('linked', 'sent'));
      const find = fm.calls.find((c) => c.path.endsWith('/_find'));
      assert.deepEqual(find.body.query, [{ staff_id: `==${people.linked.erp}` }]);
      assert.ok(fm.calls.some((c) => c.method === 'DELETE'), 'logout');
      assert.equal(fm.sessions.size, 0, 'no session left open');
    });

    await t.test("UFHR's answer is final: not Active there, or not there at all, means no code even with an old ERP copy", async () => {
      line.calls.length = 0;
      await ask('left');
      assert.match((await rowOf('left', 'failed')).smsError, /UFHR ไม่มี LINE/);
      await ask('unknown');
      assert.match((await rowOf('unknown', 'failed')).smsError, /UFHR ไม่มี LINE/);
      assert.equal(line.calls.length, 0);
      assert.equal(fm.sessions.size, 0);
    });

    await t.test('UFHR down: the ERP copy is used, and the ADMIN test says where the userId came from', async () => {
      fm.down = true;
      await db.loginOtp.deleteMany({ where: { staffId: { in: mine } } });
      await ask('unknown');
      assert.ok(await until(() => line.calls.length === 1));
      assert.equal(line.calls[0].to, uid(93));
      fm.down = false;
      const test = await request('/admin/otp/test-line', 'POST', { staffId: people.linked.staffId }, cookies.admin);
      assert.deepEqual(test.data, { ok: true, source: 'ufhr' });
      const status = await request('/admin/otp', 'GET', undefined, cookies.admin);
      assert.equal(status.data.line.ufhrConfigured, true);
      assert.ok(!JSON.stringify(status.data).includes('fm-pass'));
    });
  } finally {
    for (const k of Object.keys(ENV)) delete process.env[k];
    await db.loginOtp.deleteMany({ where: { staffId: { in: mine } } }).catch(() => undefined);
    await db.loginSession.deleteMany({ where: { staffId: { in: mine } } }).catch(() => undefined);
    await db.staffRole.deleteMany({ where: { staffId: { in: mine } } }).catch(() => undefined);
    await db.staff.deleteMany({ where: { staffId: { in: mine } } }).catch(() => undefined);
    [lineServer, fmServer].forEach((s) => {
      s.closeAllConnections?.();
      s.close();
    });
    await cleanup(ctx, world);
  }
});
