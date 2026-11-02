import assert from 'node:assert/strict';
import http from 'node:http';
import { test } from 'node:test';
import { PATH, cleanup, seedCatalog, seedWorld, startApi } from './support.mjs';

const POS_KEY = 'test-pos-key-0123456789abcdef0123456789abcdef';
process.env.POS_API_KEY = POS_KEY;
process.env.FMP_WORKER_INTERVAL_SECONDS = '0'; // the test calls tick() itself
const USER = 'ses';
const PASSWORD = 'pa,`^;ss!x'; // special characters on purpose; 'ses:' + this is 14 bytes, so its base64 ends with '='
const padded = Buffer.from(`${USER}:${PASSWORD}`).toString('base64');
const stripped = padded.replace(/=+$/, '');

const { FMP_MAX_ATTEMPTS, ackStatusOf, maskPhone, maskedJson, parseFmpTime, scriptVerdict } = await import('../dist/fmp/fmp.service.js');
const CALLBACK_KEY = 'test-fmp-callback-key-0123456789abcdef0123456789';

// A stand-in for the FileMaker Data API (vLatest): sessions (login / logout) and the records of one layout.
const fm = {
  calls: [],
  token: 0,
  valid: new Set(),
  records: 0,
  rejectStripped: false,
  recordStatus: 200,
  expireOnce: false,
  script: { result: 'ok', error: '0' },
  bodies: new Map(), // recordId -> the last ses_body written (create or update)
  gone: new Set(), // recordIds FileMaker no longer has
};
const fake = http.createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', () => {
    const url = new URL(req.url, 'http://fm');
    const body = raw ? JSON.parse(raw) : null;
    const call = { method: req.method, path: url.pathname, auth: req.headers.authorization, body };
    fm.calls.push(call);
    res.setHeader('content-type', 'application/json');
    const send = (status, code, message, response = {}) => {
      res.statusCode = status;
      res.end(JSON.stringify({ response, messages: [{ code, message }] }));
    };
    const base = '/fmi/data/vLatest/databases/UFService';
    if (req.method === 'POST' && url.pathname === `${base}/sessions`) {
      const given = (req.headers.authorization ?? '').replace('Basic ', '');
      if (fm.rejectStripped && given === stripped) return send(401, '212', 'Invalid user account and/or password');
      if (given !== stripped && given !== padded) return send(401, '212', 'Invalid user account and/or password');
      const token = `tok-${(fm.token += 1)}`;
      fm.valid.add(token);
      return send(200, '0', 'OK', { token });
    }
    if (req.method === 'DELETE' && url.pathname.startsWith(`${base}/sessions/`)) {
      fm.valid.delete(url.pathname.split('/').pop());
      return send(200, '0', 'OK');
    }
    if (req.method === 'POST' && url.pathname === `${base}/layouts/ses/records`) {
      const token = (req.headers.authorization ?? '').replace('Bearer ', '');
      if (fm.expireOnce) {
        fm.expireOnce = false;
        fm.valid.delete(token);
      }
      if (!fm.valid.has(token)) return send(401, '952', 'Invalid FileMaker Data API token (*)');
      if (fm.recordStatus !== 200) return send(fm.recordStatus, '-1', 'Unknown error');
      fm.records += 1;
      fm.bodies.set(String(fm.records), body.fieldData?.ses_body);
      const response = { recordId: String(fm.records), modId: '0' };
      if (body.script) Object.assign(response, { scriptResult: fm.script.result, scriptError: fm.script.error });
      return send(200, '0', 'OK', response);
    }
    const update = url.pathname.match(new RegExp(`^${base}/layouts/ses/records/(\\d+)$`));
    if (req.method === 'PATCH' && update) {
      const token = (req.headers.authorization ?? '').replace('Bearer ', '');
      if (!fm.valid.has(token)) return send(401, '952', 'Invalid FileMaker Data API token (*)');
      const id = update[1];
      if (!fm.bodies.has(id) || fm.gone.has(id)) return send(500, '101', 'Record is missing');
      fm.bodies.set(id, body.fieldData?.ses_body);
      const response = { modId: '1' };
      if (body.script) Object.assign(response, { scriptResult: fm.script.result, scriptError: fm.script.error });
      return send(200, '0', 'OK', response);
    }
    return send(404, '102', 'Not found');
  });
});
await new Promise((resolve) => fake.listen(0, '127.0.0.1', resolve));
const ENV = {
  FMP_HOST: `http://127.0.0.1:${fake.address().port}`,
  FMP_DATABASE: 'UFService',
  FMP_USER: USER,
  FMP_PASSWORD: PASSWORD,
};
const setEnv = () => Object.assign(process.env, ENV);
const clearEnv = () => {
  for (const k of [...Object.keys(ENV), 'FMP_SCRIPT', 'FMP_CALLBACK_KEY']) delete process.env[k];
};

test('orders reach FileMaker: queued with the order, sent in one session, retried, resent (D88)', async (t) => {
  const ctx = await startApi(t);
  if (!ctx) {
    fake.close();
    return;
  }
  const { db, request } = ctx;
  let world;
  const testStart = new Date(Date.now() - 1000);
  try {
    assert.ok(padded.endsWith('='), 'the test password gives a padded base64, so the stripped form differs');
    world = await seedWorld(ctx);
    const { cookies, branches } = world;
    const [skuA, skuB] = await seedCatalog(ctx, world, 2, 9);
    const base = await ctx.app.getUrl();
    const app = (path, method, body, who) => request(path, method, body, cookies[who]);
    const fmp = ctx.app.get((await import('../dist/fmp/fmp.service.js')).FmpService);
    let phoneNo = 700;
    const driveTo = async (lastAction) => {
      const created = await app('/sessions', 'POST', { phone: `09999007${String(phoneNo++).slice(-2)}` }, 'staff');
      const id = created.data.id;
      for (const [action, role] of PATH) {
        if (action === 'confirm') {
          await app(`/sessions/${id}/selection`, 'PUT', {
            items: [{ skuId: skuA.id, quantity: 2 }, { skuId: skuB.id, quantity: 1 }],
            accessories: [{ accessoryName: 'Case', quantity: 1 }],
            payments: ['Cash', 'Transfer'],
            ontop: ['AIS'],
            points: ['MCard'],
          }, 'staff');
          await app(`/sessions/${id}/confirm`, 'POST', undefined, 'staff');
        } else {
          const res = await app(`/sessions/${id}/step`, 'POST', { action }, role);
          assert.equal(res.status, 201, `${action}: ${JSON.stringify(res.data)}`);
        }
        if (action === lastAction) break;
      }
      return (await app(`/sessions/${id}`, 'GET', undefined, 'staff')).data;
    };
    const posOrder = async (reference) => {
      const res = await fetch(`${base}/api/integrations/pos/orders?branch=${branches.a.code}`, { headers: { Authorization: `Bearer ${POS_KEY}` } });
      return (await res.json()).orders.find((o) => o.reference === reference);
    };
    const rowOf = (reference, event) => db.fmpOutbox.findFirst({ where: { reference, ...(event ? { event } : {}) }, orderBy: { createdAt: 'desc' } });
    const reset = () => {
      fm.calls.length = 0;
      fm.rejectStripped = false;
      fm.recordStatus = 200;
      fm.expireOnce = false;
      fm.script = { result: 'ok', error: '0' };
      fm.gone.clear();
    };

    await t.test('nothing is queued or sent until FileMaker is configured', async () => {
      clearEnv();
      const s = await driveTo('send');
      assert.equal(await db.fmpOutbox.count({ where: { reference: s.reference } }), 0);
      assert.equal((await app('/admin/fmp', 'GET', undefined, 'admin')).data.configured, false);
      assert.equal((await app('/admin/fmp/resend', 'POST', { reference: s.reference }, 'admin')).status, 400);
      assert.deepEqual(await fmp.tick(), { sent: 0, failed: 0 });
      assert.equal(fm.calls.length, 0);
    });

    setEnv();
    let first;
    await t.test('an order sent to the cashier is queued in the same change, with exactly the data the U POS door serves', async () => {
      first = await driveTo('send');
      assert.equal(first.state, 'SENT_TO_CASHIER');
      const row = await rowOf(first.reference);
      assert.equal(row.event, 'SENT_TO_CASHIER');
      assert.equal(row.status, 'pending');
      assert.equal(row.attempts, 0);
      const payload = JSON.parse(row.payload);
      assert.equal(payload.source, 'SES');
      assert.equal(payload.event, 'SENT_TO_CASHIER');
      assert.equal(payload.outboxId, row.id, 'FileMaker can dedupe by outboxId');
      assert.deepEqual(payload.branch, { code: branches.a.code, name: branches.a.name });
      const { source, event, outboxId, queuedAt, branch, version, test, createdAt, ...order } = payload;
      assert.ok(queuedAt && source && event && outboxId && branch);
      // D92: what the FileMaker `ses` script checks before it opens a bill
      assert.equal(version, 1);
      assert.equal(test, false);
      assert.match(createdAt, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\+07:00$/, 'Thai local time with its offset');
      assert.equal(createdAt.slice(0, 16), new Date(new Date(queuedAt).getTime() + 7 * 3_600_000).toISOString().slice(0, 16), 'the same moment as queuedAt');
      assert.deepEqual(order, JSON.parse(JSON.stringify(await posOrder(first.reference))), 'the same view as the POS door, not a second copy');
      assert.match(order.queue, /^[A-Z]\d{3,4}$/);
      assert.equal(order.items.length, 2);
      assert.equal(order.items[0].quantity, 2);
      assert.deepEqual(order.payments.sort(), ['Cash', 'Transfer']);
      assert.deepEqual([...order.paymentTypes].sort(), ['เงินสด', 'โอนเงิน'], 'D89: the same payments by FMP type');
      assert.ok(!/price|ราคา/i.test(row.payload), 'no prices: SES has none');
      // D92: one serial number per unit, as STOCK scanned them; the script refuses a count that differs from `quantity`
      for (const item of order.items) {
        assert.equal(item.sn.length, item.quantity, `${item.partNo}: one serial per unit`);
        assert.ok(item.sn.every((x) => typeof x === 'string' && x.length > 0));
        assert.ok('upc' in item);
      }
      assert.equal(new Set(order.items.flatMap((i) => i.sn)).size, 3, 'three different units');
      // a step that is not "send" queues nothing more
      assert.equal(await db.fmpOutbox.count({ where: { reference: first.reference } }), 1);
    });

    await t.test('the worker logs in once, creates the record with the order in ses_body, and logs out', async () => {
      const second = await driveTo('send');
      reset();
      const result = await fmp.tick();
      assert.deepEqual(result, { sent: 2, failed: 0 });
      const methods = fm.calls.map((c) => `${c.method} ${c.path.split('/databases/UFService')[1]}`);
      assert.deepEqual(methods, ['POST /sessions', 'POST /layouts/ses/records', 'POST /layouts/ses/records', 'DELETE /sessions/tok-' + fm.token], 'one login, two records, one logout');
      assert.equal(fm.calls[0].auth, `Basic ${stripped}`, 'the Basic header has no trailing = (as the FileMaker side specified)');
      assert.deepEqual(fm.calls[0].body, {});
      assert.equal(fm.calls[1].auth, `Bearer tok-${fm.token}`);
      const sent = fm.calls.filter((c) => c.path.endsWith('/records')).map((c) => c.body);
      const row1 = await rowOf(first.reference);
      const row2 = await rowOf(second.reference);
      assert.deepEqual(sent.map((b) => b.fieldData.ses_body).sort(), [row1.payload, row2.payload].sort());
      assert.ok(sent.every((b) => Object.keys(b).join() === 'fieldData'), 'a plain create: no script');
      assert.equal(row1.status, 'sent');
      assert.ok(row1.fmpRecordId && row1.sentAt);
      assert.equal(row1.attempts, 1);
      assert.equal(fm.valid.size, 0, 'the token was dropped');
      assert.deepEqual(await fmp.tick(), { sent: 0, failed: 0 }, 'nothing is sent twice');
    });

    await t.test('if the stripped Basic header is refused, the standard padded one is tried', async () => {
      const s = await driveTo('send');
      reset();
      fm.rejectStripped = true;
      assert.deepEqual(await fmp.tick(), { sent: 1, failed: 0 });
      const logins = fm.calls.filter((c) => c.path.endsWith('/sessions') && c.method === 'POST').map((c) => c.auth);
      assert.deepEqual(logins, [`Basic ${stripped}`, `Basic ${padded}`]);
      assert.equal((await rowOf(s.reference)).status, 'sent');
    });

    await t.test('a failure is retried with a back-off, logs out anyway, and gives up after the last attempt until an ADMIN retries', async () => {
      const s = await driveTo('send');
      reset();
      fm.recordStatus = 500;
      assert.deepEqual(await fmp.tick(), { sent: 0, failed: 1 });
      assert.equal(fm.calls.at(-1).method, 'DELETE', 'the token is released even when the send failed');
      let row = await rowOf(s.reference);
      assert.equal(row.status, 'pending');
      assert.equal(row.attempts, 1);
      assert.match(row.lastError, /HTTP 500/);
      assert.ok(row.nextAttemptAt.getTime() - Date.now() > 30_000, 'the next attempt waits');
      assert.ok(!row.lastError.includes(PASSWORD) && !row.lastError.includes('127.0.0.1'), 'no secret, no URL in the stored error');
      reset();
      assert.deepEqual(await fmp.tick(), { sent: 0, failed: 0 });
      assert.equal(fm.calls.length, 0, 'not due yet: not even a login');
      // FileMaker is back; the attempt is due
      await db.fmpOutbox.update({ where: { id: row.id }, data: { nextAttemptAt: new Date(Date.now() - 1000) } });
      assert.deepEqual(await fmp.tick(), { sent: 1, failed: 0 });
      row = await rowOf(s.reference);
      assert.equal(row.status, 'sent');
      assert.equal(row.attempts, 2);
      // the last attempt fails: failed, and not tried again by the worker
      const d = await driveTo('send');
      const dead = await rowOf(d.reference);
      await db.fmpOutbox.update({ where: { id: dead.id }, data: { attempts: FMP_MAX_ATTEMPTS - 1 } });
      fm.recordStatus = 500;
      await fmp.tick();
      assert.equal((await rowOf(d.reference)).status, 'failed');
      fm.recordStatus = 200;
      await db.fmpOutbox.update({ where: { id: dead.id }, data: { nextAttemptAt: new Date(Date.now() - 1000) } });
      reset();
      assert.deepEqual(await fmp.tick(), { sent: 0, failed: 0 }, 'a failed message waits for an ADMIN');
      for (const who of ['staff', 'stock', 'cashier', 'manager'])
        assert.equal((await app(`/admin/fmp/outbox/${dead.id}/retry`, 'POST', undefined, who)).status, 403, who);
      assert.equal((await app(`/admin/fmp/outbox/${dead.id}/retry`, 'POST', undefined, 'admin')).status, 201);
      assert.equal((await app('/admin/fmp/outbox/no-such-id/retry', 'POST', undefined, 'admin')).status, 404);
      assert.deepEqual(await fmp.tick(), { sent: 1, failed: 0 });
      const after = await rowOf(d.reference);
      assert.equal(after.status, 'sent');
      assert.equal(after.attempts, 1, 'a retry starts a fresh set of attempts');
    });

    await t.test('a token FileMaker dropped mid-batch is replaced once, with no duplicate record', async () => {
      const s = await driveTo('send');
      reset();
      fm.expireOnce = true;
      const before = fm.records;
      assert.deepEqual(await fmp.tick(), { sent: 1, failed: 0 });
      assert.equal(fm.records, before + 1);
      assert.equal(fm.calls.filter((c) => c.path.endsWith('/sessions') && c.method === 'POST').length, 2, 'logged in again');
      assert.equal((await rowOf(s.reference)).status, 'sent');
    });

    await t.test('with a script configured it is called with the reference; a script error is recorded but the order is not sent again', async () => {
      process.env.FMP_SCRIPT = 'ProcessAAA';
      const s = await driveTo('send');
      reset();
      assert.deepEqual(await fmp.tick(), { sent: 1, failed: 0 });
      const body = fm.calls.find((c) => c.path.endsWith('/records')).body;
      assert.equal(body.script, 'ProcessAAA');
      const row = await rowOf(s.reference);
      assert.equal(body['script.param'], s.reference, 'D91: the parameter is the reference alone, as text, not JSON');
      assert.equal(row.scriptResult, 'ok');
      const e = await driveTo('send');
      reset();
      fm.script = { result: '', error: '3' };
      assert.deepEqual(await fmp.tick(), { sent: 1, failed: 0 });
      const bad = await rowOf(e.reference);
      assert.equal(bad.status, 'sent', 'the record exists, so it is not created twice');
      assert.equal(bad.lastError, 'script error 3');
      delete process.env.FMP_SCRIPT;
    });

    await t.test('a worker that died while sending: the row is given back and sent', async () => {
      const s = await driveTo('send');
      const row = await rowOf(s.reference);
      await db.fmpOutbox.update({ where: { id: row.id }, data: { status: 'sending', lockedAt: new Date(Date.now() - 10 * 60_000) } });
      reset();
      assert.deepEqual(await fmp.tick(), { sent: 1, failed: 0 });
      assert.equal((await rowOf(s.reference)).status, 'sent');
    });

    await t.test('ADMIN can send an existing order again; the status page shows the queue and never a secret', async () => {
      for (const who of ['staff', 'stock', 'cashier', 'manager'])
        assert.equal((await app('/admin/fmp/resend', 'POST', { reference: first.reference }, who)).status, 403, who);
      assert.equal((await app('/admin/fmp/resend', 'POST', { reference: 'SES-00000000-000000' }, 'admin')).status, 404);
      const res = await app('/admin/fmp/resend', 'POST', { reference: first.reference }, 'admin');
      assert.equal(res.status, 201, JSON.stringify(res.data));
      const row = await rowOf(first.reference, 'RESEND');
      assert.equal(row.id, res.data.id);
      assert.equal(JSON.parse(row.payload).event, 'RESEND');
      assert.equal(JSON.parse(row.payload).reference, first.reference);
      reset();
      assert.deepEqual(await fmp.tick(), { sent: 1, failed: 0 });
      const status = await app('/admin/fmp', 'GET', undefined, 'admin');
      assert.equal(status.status, 200);
      assert.equal(status.data.configured, true);
      assert.equal(status.data.layout, 'ses');
      assert.equal(status.data.field, 'ses_body');
      assert.equal(status.data.database, 'UFService');
      assert.ok(status.data.counts.sent >= 5);
      assert.ok(status.data.rows.length > 0);
      const text = JSON.stringify(status.data);
      assert.ok(!text.includes(PASSWORD) && !text.includes(stripped) && !text.includes('"payload"'), 'no password, no credentials, no payload bodies');
      assert.equal(status.data.host, `127.0.0.1:${fake.address().port}`);
      assert.equal((await app('/admin/fmp', 'GET', undefined, 'staff')).status, 403);
      assert.equal((await request('/admin/fmp')).status, 401);
    });

    // ---- D90: the admin log and the callback door ------------------------------------------------------------------------
    const logsOf = (where) => db.fmpLog.findMany({ where, orderBy: { createdAt: 'asc' } });
    const callback = (body, key = CALLBACK_KEY, raw = false) =>
      fetch(`${base}/api/integrations/fmp/callback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(key ? { Authorization: `Bearer ${key}` } : {}) },
        body: raw ? body : JSON.stringify(body),
      }).then(async (res) => ({ status: res.status, data: await res.json().catch(() => null) }));

    await t.test('every call is in the log: one round shares an id, the path has no host, and no secret, token or full phone is stored (D90)', async () => {
      reset();
      const s = await driveTo('send');
      const row = await rowOf(s.reference);
      const session = await db.customerSession.findFirst({ where: { reference: s.reference } });
      assert.deepEqual(await fmp.tick(), { sent: 1, failed: 0 });
      const rows = await logsOf({ OR: [{ reference: s.reference }, { batchId: { not: null }, createdAt: { gte: row.createdAt } }] });
      const queued = rows.find((r) => r.kind === 'queued' && r.reference === s.reference);
      const create = rows.find((r) => r.kind === 'create' && r.reference === s.reference);
      assert.equal(queued.direction, 'SES');
      assert.equal(queued.outboxId, row.id);
      assert.equal(create.direction, 'OUT');
      assert.equal(create.outboxId, row.id);
      assert.equal(create.method, 'POST');
      assert.equal(create.path, '/fmi/data/vLatest/databases/UFService/layouts/ses/records', 'no host in the logged path');
      assert.equal(create.httpStatus, 200);
      assert.equal(create.fmCode, '0');
      assert.equal(create.ok, true);
      assert.ok(create.durationMs >= 0);
      assert.match(create.summary, /recordId \d+/);
      const login = rows.find((r) => r.kind === 'login' && r.batchId === create.batchId);
      const logout = rows.find((r) => r.kind === 'logout' && r.batchId === create.batchId);
      assert.ok(login && logout, 'login and logout belong to the same round as the create');
      assert.equal(login.path, '/fmi/data/vLatest/databases/UFService/sessions');
      assert.equal(logout.method, 'DELETE');
      assert.equal(logout.path, '/fmi/data/vLatest/databases/UFService/sessions/[token]', 'the token that ends a logout path is masked');
      assert.match(login.response, /"token":"\[redacted\]"/);
      // the order as FileMaker got it, with the customer's phone masked
      const sent = JSON.parse(create.request);
      assert.equal(sent.reference, s.reference);
      assert.equal(sent.customerPhone, maskPhone(session.phone));
      assert.notEqual(sent.customerPhone, session.phone);
      const everything = JSON.stringify(await db.fmpLog.findMany({ where: { createdAt: { gte: testStart } } }));
      for (const secret of [PASSWORD, stripped, padded, 'tok-'])
        assert.ok(!everything.includes(secret), `the log never holds ${secret === PASSWORD ? 'the password' : secret}`);
      assert.ok(!everything.includes(session.phone), 'no full customer phone in the log');
      // a log that cannot be written never throws into the order or the send
      await fmp.record({ direction: 'SES', kind: 'x', ok: true, summary: 'x' }, { fmpLog: { create: async () => { throw new Error('boom'); } } });
    });

    await t.test('a refusal is logged with what FileMaker answered and what SES will do; a retry by ADMIN is logged with who (D90)', async () => {
      reset();
      fm.recordStatus = 500;
      const s = await driveTo('send');
      assert.deepEqual(await fmp.tick(), { sent: 0, failed: 1 });
      const rows = await logsOf({ reference: s.reference });
      const create = rows.find((r) => r.kind === 'create');
      assert.equal(create.ok, false);
      assert.equal(create.httpStatus, 500);
      assert.equal(create.fmCode, '-1');
      assert.match(create.response, /Unknown error/, 'FileMaker\'s own answer is kept');
      const again = rows.find((r) => r.kind === 'will-retry');
      assert.equal(again.ok, false);
      assert.match(again.summary, new RegExp(`ครั้งที่ 1/${FMP_MAX_ATTEMPTS}.*ลองใหม่ใน 1 นาที`));
      const row = await rowOf(s.reference);
      const res = await app(`/admin/fmp/outbox/${row.id}/retry`, 'POST', undefined, 'admin');
      assert.equal(res.status, 201, JSON.stringify(res.data));
      const retry = (await logsOf({ reference: s.reference, kind: 'retry' }))[0];
      assert.equal(retry.direction, 'SES');
      assert.match(retry.summary, /^ADMIN \S+ สั่งส่งซ้ำ/);
      reset();
      await fmp.tick();
      assert.equal((await rowOf(s.reference)).status, 'sent');
      // give-up is logged too
      fm.recordStatus = 500;
      const g = await driveTo('send');
      const gRow = await rowOf(g.reference);
      await db.fmpOutbox.update({ where: { id: gRow.id }, data: { attempts: FMP_MAX_ATTEMPTS - 1 } });
      await fmp.tick();
      assert.equal((await logsOf({ reference: g.reference, kind: 'gave-up' })).length, 1);
      reset();
    });

    await t.test('the callback door: off without a key, 401 for a wrong one, loose about the body, strict about the id (D90)', async () => {
      assert.equal((await callback({ reference: first.reference }, null)).status, 404, 'door off while FMP_CALLBACK_KEY is unset');
      assert.match(JSON.stringify((await callback({ reference: first.reference }, CALLBACK_KEY)).data), /FMP_CALLBACK_KEY/);
      process.env.FMP_CALLBACK_KEY = 'too-short';
      assert.equal((await callback({ reference: first.reference }, 'too-short')).status, 404, 'under 32 characters is off too');
      process.env.FMP_CALLBACK_KEY = CALLBACK_KEY;
      assert.equal((await callback({ reference: first.reference }, null)).status, 401);
      assert.equal((await callback({ reference: first.reference }, 'x'.repeat(CALLBACK_KEY.length))).status, 401);
      const before = await db.fmpLog.count({ where: { direction: 'IN' } });
      assert.equal(before, 0, 'a refused caller leaves nothing in the log');

      assert.equal((await callback({})).status, 400);
      assert.equal((await callback('not json at all', CALLBACK_KEY, true)).status, 400, 'not JSON: nothing to read, 400');
      assert.equal((await callback({ outboxId: 'no-such-id', status: 'success' })).status, 404);
      assert.equal((await callback({ reference: 'SES-00000000-000000', status: 'success' })).status, 404);
      const other = await db.fmpOutbox.findFirst({ where: { reference: { not: first.reference } } });
      const mine = await rowOf(first.reference, 'SENT_TO_CASHIER');
      assert.equal((await callback({ outboxId: mine.id, reference: other.reference, status: 'success' })).status, 400, 'an id and a reference of different messages');
      const refused = await db.fmpLog.findMany({ where: { direction: 'IN' } });
      // an empty body, an unknown outboxId, an unknown reference and a mismatch; malformed JSON never reaches the door (the body parser answers 400)
      assert.equal(refused.length, 4, 'the refused reports are logged (the unauthenticated ones are not)');
      assert.ok(refused.every((r) => r.ok === false && r.kind === 'callback' && r.path === '/api/integrations/fmp/callback'));
      assert.equal((await db.fmpOutbox.findUnique({ where: { id: mine.id } })).ackStatus, null, 'a refused report records nothing on the message');
    });

    await t.test('a report is recorded on the message and logged whole, phones masked; the order itself is untouched (D90)', async () => {
      const mine = await rowOf(first.reference, 'SENT_TO_CASHIER');
      const sessionBefore = await db.customerSession.findFirst({ where: { reference: first.reference } });
      const res = await callback({
        outboxId: mine.id,
        status: 'success',
        message: 'บันทึกบิลแล้ว',
        time: '2026-10-30T17:31:31+07:00',
        billNo: 'FM-1',
        customerPhone: '0812345678',
      });
      assert.equal(res.status, 200, JSON.stringify(res.data));
      assert.deepEqual(res.data, { ok: true, outboxId: mine.id, reference: first.reference, status: 'success', time: '2026-10-30T10:31:31.000Z', timeReceived: true });
      const row = await db.fmpOutbox.findUnique({ where: { id: mine.id } });
      assert.equal(row.ackStatus, 'success');
      assert.equal(row.ackMessage, 'บันทึกบิลแล้ว');
      assert.equal(row.ackAt.toISOString(), '2026-10-30T10:31:31.000Z');
      assert.equal(row.ackTimeText, '2026-10-30T17:31:31+07:00');
      assert.ok(row.ackReceivedAt);
      const log = (await logsOf({ reference: first.reference, direction: 'IN' })).at(-1);
      assert.equal(log.ok, true);
      assert.equal(log.httpStatus, 200);
      assert.match(log.summary, /FileMaker รายงาน success: บันทึกบิลแล้ว$/);
      assert.match(log.request, /"billNo":"FM-1"/, 'whatever else FileMaker sends is kept');
      assert.ok(!log.request.includes('0812345678') && log.request.includes('******5678'), 'a phone it sends is masked');
      const sessionAfter = await db.customerSession.findFirst({ where: { reference: first.reference } });
      assert.deepEqual(sessionAfter, sessionBefore, 'the order is not changed by a report');

      // by reference (the latest message), no time sent, status in capitals, before SES marked the message sent
      const s = await driveTo('send');
      const pending = await rowOf(s.reference);
      assert.equal(pending.status, 'pending');
      const early = await callback({ reference: s.reference, status: 'ERROR', message: 'ไม่พบสินค้า' });
      assert.equal(early.status, 200);
      assert.deepEqual(early.data, { ok: true, outboxId: pending.id, reference: s.reference, status: 'error', time: null, timeReceived: false });
      const noTime = await db.fmpOutbox.findUnique({ where: { id: pending.id } });
      assert.deepEqual([noTime.ackStatus, noTime.ackAt, noTime.ackTimeText], ['error', null, null]);
      assert.match((await logsOf({ reference: s.reference, direction: 'IN' })).at(-1).summary, /ไม่ได้ส่งเวลา/);

      // a time SES cannot read stays visible as text; the latest report wins, every one is logged
      const odd = await callback({ reference: s.reference, status: 'success', time: '10/30/2026 17:31:31' });
      assert.equal(odd.data.time, null);
      assert.equal(odd.data.timeReceived, true);
      const oddRow = await db.fmpOutbox.findUnique({ where: { id: pending.id } });
      assert.deepEqual([oddRow.ackStatus, oddRow.ackAt, oddRow.ackTimeText], ['success', null, '10/30/2026 17:31:31']);
      assert.match((await logsOf({ reference: s.reference, direction: 'IN' })).at(-1).summary, /อ่านเวลา "10\/30\/2026 17:31:31" ไม่ได้/);
      assert.equal((await logsOf({ reference: s.reference, direction: 'IN' })).length, 2);
      const bangkok = await callback({ reference: s.reference, status: 'success', time: '2026-10-30 17:31:31' });
      assert.equal(bangkok.data.time, '2026-10-30T10:31:31.000Z', 'no offset: read as Bangkok time');
      await fmp.tick();
      assert.equal((await db.fmpOutbox.findUnique({ where: { id: pending.id } })).ackStatus, 'success', 'sending afterwards does not wipe the report');
    });

    await t.test('how FileMaker words the result and the time is read leniently, and never guessed (D90)', () => {
      for (const ok of [{ status: 'success' }, { status: ' OK ' }, { result: 'Done' }, { status: 'สำเร็จ' }, { success: true }, { status: 'true' }])
        assert.equal(ackStatusOf(ok), 'success', JSON.stringify(ok));
      for (const bad of [{ status: 'error' }, { status: 'FAILED' }, { result: 'ล้มเหลว' }, { success: false }, { status: 'false' }])
        assert.equal(ackStatusOf(bad), 'error', JSON.stringify(bad));
      for (const other of [{}, { status: 'pending' }, { status: 0 }, { status: 1 }, { status: '0' }, { status: '' }, { status: null }])
        assert.equal(ackStatusOf(other), 'reported', `not guessed: ${JSON.stringify(other)}`);
      const iso = (text) => parseFmpTime(text)?.toISOString() ?? null;
      assert.equal(iso('2026-10-30T17:31:31+07:00'), '2026-10-30T10:31:31.000Z');
      assert.equal(iso('2026-10-30T17:31:31+0700'), '2026-10-30T10:31:31.000Z');
      assert.equal(iso('2026-10-30T10:31:31Z'), '2026-10-30T10:31:31.000Z');
      assert.equal(iso('2026-10-30T10:31:31.123Z'), '2026-10-30T10:31:31.123Z');
      assert.equal(iso('2026-10-30 17:31:31'), '2026-10-30T10:31:31.000Z', 'no offset = Bangkok');
      assert.equal(iso('2026-10-30T17:31'), '2026-10-30T10:31:00.000Z');
      assert.equal(iso('1793356291'), '2026-10-30T10:31:31.000Z', 'epoch seconds');
      assert.equal(iso('1793356291000'), '2026-10-30T10:31:31.000Z', 'epoch milliseconds');
      for (const bad of ['10/30/2026 17:31:31', '30/10/2026', 'yesterday', '', '2026-13-45T25:00:00Z', '2026-10-30'])
        assert.equal(iso(bad), null, bad);
      assert.equal(maskPhone('0812345678'), '******5678');
      assert.equal(maskPhone(812345678), '*****5678');
      assert.equal(maskPhone('123'), '***');
      const masked = JSON.parse(maskedJson({ customerPhone: '0812345678', tel: '0899999999', items: [{ mobile: '0811111111', name: 'n' }], note: 'x' }));
      assert.deepEqual(masked, { customerPhone: '******5678', tel: '******9999', items: [{ mobile: '******1111', name: 'n' }], note: 'x' });
      assert.equal(maskedJson('<html>502 Bad Gateway</html>'), '<html>502 Bad Gateway</html>', 'not JSON: kept as FileMaker\'s own words');
      assert.ok(maskedJson('x'.repeat(9000)).length < 8100, 'cut');
    });

    await t.test('the log is for ADMIN: newest first, no bodies in the list, filters and pages, one row opens with its bodies (D90)', async () => {
      const logs = (query = '', who = 'admin') => app(`/admin/fmp/logs${query}`, 'GET', undefined, who);
      for (const who of ['staff', 'stock', 'cashier', 'manager']) assert.equal((await logs('', who)).status, 403, who);
      assert.equal((await request('/admin/fmp/logs')).status, 401);
      const all = await logs('?take=200');
      assert.equal(all.status, 200, JSON.stringify(all.data));
      const times = all.data.rows.map((r) => new Date(r.createdAt).getTime());
      assert.deepEqual(times, [...times].sort((a, b) => b - a), 'newest first');
      assert.ok(all.data.rows.every((r) => !('request' in r) && !('response' in r)), 'the list stays light');
      assert.ok(all.data.rows.length >= 10);

      const one = await logs(`?reference=${first.reference}`);
      assert.ok(one.data.rows.length >= 3 && one.data.rows.every((r) => r.reference === first.reference));
      const part = await logs(`?reference=${first.reference.slice(-8)}`);
      assert.ok(part.data.rows.some((r) => r.reference === first.reference), 'a part of the reference is enough');
      for (const direction of ['OUT', 'IN', 'SES']) {
        const d = await logs(`?direction=${direction}&take=200`);
        assert.ok(d.data.rows.length > 0 && d.data.rows.every((r) => r.direction === direction), direction);
      }
      assert.equal((await logs('?direction=SIDEWAYS')).status, 400);
      const bad = await logs('?problems=true&take=200');
      assert.ok(bad.data.rows.length > 0 && bad.data.rows.every((r) => r.ok === false));

      const page1 = await logs('?take=3');
      assert.equal(page1.data.rows.length, 3);
      assert.ok(page1.data.next);
      const page2 = await logs(`?take=3&after=${page1.data.next}`);
      assert.equal(page2.data.rows.length, 3);
      const ids = [...page1.data.rows, ...page2.data.rows].map((r) => r.id);
      assert.equal(new Set(ids).size, 6, 'the second page continues where the first stopped');
      assert.deepEqual(ids, all.data.rows.slice(0, 6).map((r) => r.id));

      const create = all.data.rows.find((r) => r.kind === 'create' && r.ok);
      const detail = await logs(`/${create.id}`.replace('?', ''));
      assert.equal(detail.status, 200);
      assert.equal(detail.data.id, create.id);
      assert.ok(detail.data.request.includes('"reference"') && detail.data.response.includes('recordId'));
      assert.equal((await app('/admin/fmp/logs/no-such-row', 'GET', undefined, 'admin')).status, 404);
      assert.equal((await app(`/admin/fmp/logs/${create.id}`, 'GET', undefined, 'staff')).status, 403);

      const status = await app('/admin/fmp', 'GET', undefined, 'admin');
      assert.deepEqual(status.data.callback, { path: '/api/integrations/fmp/callback', keySet: true });
      const acked = status.data.rows.find((r) => r.reference === first.reference && r.ackStatus);
      assert.equal(acked.ackStatus, 'success');
      assert.ok(!JSON.stringify(status.data).includes(CALLBACK_KEY), 'the key is never shown');
    });

    await t.test('log rows older than 90 days are cleared by the worker, newer ones stay (D90)', async () => {
      const old = await db.fmpLog.create({ data: { id: 'old-log-row-test', createdAt: new Date(Date.now() - 91 * 86_400_000), direction: 'SES', kind: 'queued', ok: true, summary: 'old' } });
      const recent = await db.fmpLog.create({ data: { id: 'recent-log-row-test', createdAt: new Date(Date.now() - 89 * 86_400_000), direction: 'SES', kind: 'queued', ok: true, summary: 'recent' } });
      fmp.lastPrune = 0;
      await fmp.tick();
      assert.equal(await db.fmpLog.findUnique({ where: { id: old.id } }), null);
      assert.ok(await db.fmpLog.findUnique({ where: { id: recent.id } }));
      const stamp = fmp.lastPrune;
      await db.fmpLog.create({ data: { id: 'old-log-row-test', createdAt: new Date(Date.now() - 91 * 86_400_000), direction: 'SES', kind: 'queued', ok: true, summary: 'old again' } });
      await fmp.tick();
      assert.ok(await db.fmpLog.findUnique({ where: { id: 'old-log-row-test' } }), 'it runs at most every 6 hours');
      assert.equal(fmp.lastPrune, stamp);
    });

    // ---- D95: one FileMaker record per order, and what the `ses` script answered ----------------------------------------
    await t.test('a second send of the same order updates its FileMaker record (the script needs exactly one), with the new serials (D95)', async () => {
      reset();
      const s = await driveTo('send');
      await fmp.tick();
      const firstRow = await rowOf(s.reference, 'SENT_TO_CASHIER');
      const recordsBefore = fm.records;
      const firstBody = JSON.parse(fm.bodies.get(firstRow.fmpRecordId));
      // the cashier sends it back, stock scans other units and sends again
      assert.equal((await app(`/sessions/${s.id}/cashier/reject`, 'POST', { reason: 'หยิบสินค้าผิด' }, 'cashier')).status, 201);
      for (const action of ['found', 'send']) assert.equal((await app(`/sessions/${s.id}/step`, 'POST', { action }, 'stock')).status, 201, action);
      reset();
      assert.deepEqual(await fmp.tick(), { sent: 1, failed: 0 });
      assert.equal(fm.records, recordsBefore, 'no second record');
      const patch = fm.calls.find((c) => c.method === 'PATCH');
      assert.ok(patch, 'the record was updated');
      assert.equal(patch.path, `/fmi/data/vLatest/databases/UFService/layouts/ses/records/${firstRow.fmpRecordId}`);
      const rows = await db.fmpOutbox.findMany({ where: { reference: s.reference }, orderBy: { createdAt: 'asc' } });
      assert.equal(rows.length, 2);
      assert.equal(rows[1].fmpRecordId, firstRow.fmpRecordId, 'the second message names the same record');
      const nowBody = JSON.parse(fm.bodies.get(firstRow.fmpRecordId));
      assert.notDeepEqual(nowBody.items.flatMap((i) => i.sn), firstBody.items.flatMap((i) => i.sn), 'FileMaker now holds the serials scanned last');
      assert.equal(nowBody.outboxId, rows[1].id);
      assert.equal((await logsOf({ reference: s.reference, kind: 'update' })).length, 1);

      // an ADMIN's resend updates the same record too
      reset();
      assert.equal((await app('/admin/fmp/resend', 'POST', { reference: s.reference }, 'admin')).status, 201);
      await fmp.tick();
      assert.equal(fm.records, recordsBefore);
      assert.equal(fm.calls.filter((c) => c.method === 'PATCH').length, 1);

      // a record FileMaker deleted is created anew
      fm.gone.add(firstRow.fmpRecordId);
      assert.equal((await app('/admin/fmp/resend', 'POST', { reference: s.reference }, 'admin')).status, 201);
      fm.calls.length = 0;
      await fmp.tick();
      assert.equal(fm.records, recordsBefore + 1, 'created anew');
      const latest = await rowOf(s.reference, 'RESEND');
      assert.equal(latest.status, 'sent');
      assert.equal(latest.fmpRecordId, String(fm.records));
      assert.equal((await logsOf({ reference: s.reference, kind: 'record-gone' })).length, 1);
      reset();
    });

    await t.test("the script's answer is shown: CREATED with the sale, an SN error, and ALREADY_DONE after a resend (D95)", async () => {
      process.env.FMP_SCRIPT = 'ses';
      reset();
      fm.script = { result: JSON.stringify({ ok: true, code: 'CREATED', sesID: 'x', saleID: 'S-77', lines: 3, payments: 1 }), error: '0' };
      const s = await driveTo('send');
      await fmp.tick();
      let row = await rowOf(s.reference, 'SENT_TO_CASHIER');
      assert.equal(row.status, 'sent');
      assert.equal(row.ackStatus, 'success');
      assert.equal(row.ackMessage, 'CREATED saleID S-77 (3 รายการ)');
      assert.ok(row.ackAt && row.ackReceivedAt);
      const scriptLog = (await logsOf({ reference: s.reference, kind: 'script' })).at(-1);
      assert.equal(scriptLog.direction, 'IN');
      assert.equal(scriptLog.ok, true);
      assert.match(scriptLog.summary, /สคริปต์ ses ตอบ: CREATED saleID S-77/);

      // an SN FileMaker does not know: still "sent" (the record exists), but the answer is an error
      fm.script = { result: JSON.stringify({ ok: false, code: 'SN_NOT_FOUND', sesID: 'x', message: 'SN F9X not found in stock' }), error: '0' };
      const e = await driveTo('send');
      await fmp.tick();
      row = await rowOf(e.reference, 'SENT_TO_CASHIER');
      assert.equal(row.status, 'sent');
      assert.equal(row.ackStatus, 'error');
      assert.equal(row.ackMessage, 'SN_NOT_FOUND: SN F9X not found in stock');
      assert.equal((await logsOf({ reference: e.reference, kind: 'script' })).at(-1).ok, false);

      // the bill was opened from the first send: a later send's serials are not used, so it is not a success
      fm.script = { result: JSON.stringify({ ok: true, code: 'ALREADY_DONE', sesID: 'x', saleID: 'S-77' }), error: '0' };
      assert.equal((await app('/admin/fmp/resend', 'POST', { reference: s.reference }, 'admin')).status, 201);
      await fmp.tick();
      row = await rowOf(s.reference, 'RESEND');
      assert.equal(row.ackStatus, 'error');
      assert.match(row.ackMessage, /^ALREADY_DONE saleID S-77: FMP เปิดบิลจากการส่งครั้งก่อนไปแล้ว/);

      // a result that is not JSON says nothing about the order
      fm.script = { result: 'ok', error: '0' };
      const p = await driveTo('send');
      await fmp.tick();
      row = await rowOf(p.reference, 'SENT_TO_CASHIER');
      assert.equal(row.ackStatus, null);
      assert.equal(row.scriptResult, 'ok');
      delete process.env.FMP_SCRIPT;
      reset();
    });

    await t.test('reading the script answer: first send vs update, and anything that is not the script JSON (D95)', () => {
      assert.deepEqual(scriptVerdict(JSON.stringify({ ok: true, code: 'ALREADY_DONE', saleID: 'S1' }), false), { status: 'success', message: 'ALREADY_DONE saleID S1' }, 'on a first send ALREADY_DONE is fine');
      assert.equal(scriptVerdict(JSON.stringify({ ok: true, code: 'ALREADY_DONE', saleID: 'S1' }), true).status, 'error');
      assert.deepEqual(scriptVerdict(JSON.stringify({ ok: false, code: 'IN_PROGRESS' }), false), { status: 'error', message: 'IN_PROGRESS' });
      assert.deepEqual(scriptVerdict(JSON.stringify({ ok: true }), false), { status: 'success', message: 'OK' });
      for (const junk of ['', 'ok', '[]', 'null', '{"code":"X"}', '{"ok":"yes"}']) assert.equal(scriptVerdict(junk, false), null, junk);
      assert.ok(scriptVerdict(JSON.stringify({ ok: false, code: 'X', message: 'y'.repeat(400) }), false).message.length <= 255);
    });

  } finally {
    clearEnv();
    if (world) {
      const refs = await db.customerSession.findMany({ where: { branchId: { in: Object.values(world.branches).map((b) => b.id) } }, select: { reference: true } });
      await db.fmpOutbox.deleteMany({ where: { reference: { in: refs.map((r) => r.reference) } } });
    }
    await db.fmpLog.deleteMany({ where: { OR: [{ createdAt: { gte: testStart } }, { id: { in: ['old-log-row-test', 'recent-log-row-test'] } }] } });
    fake.close();
    await cleanup(ctx, world);
  }
});
