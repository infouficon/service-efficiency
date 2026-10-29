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

const { FMP_MAX_ATTEMPTS } = await import('../dist/fmp/fmp.service.js');

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
      const response = { recordId: String(fm.records), modId: '0' };
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
  for (const k of [...Object.keys(ENV), 'FMP_SCRIPT']) delete process.env[k];
};

test('orders reach FileMaker: queued with the order, sent in one session, retried, resent (D88)', async (t) => {
  const ctx = await startApi(t);
  if (!ctx) {
    fake.close();
    return;
  }
  const { db, request } = ctx;
  let world;
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
      const { source, event, outboxId, queuedAt, branch, ...order } = payload;
      assert.ok(queuedAt && source && event && outboxId && branch);
      assert.deepEqual(order, JSON.parse(JSON.stringify(await posOrder(first.reference))), 'the same view as the POS door, not a second copy');
      assert.match(order.queue, /^[A-Z]\d{3,4}$/);
      assert.equal(order.items.length, 2);
      assert.equal(order.items[0].quantity, 2);
      assert.deepEqual(order.payments.sort(), ['Cash', 'Transfer']);
      assert.ok(!/"sn"|price|ราคา/i.test(row.payload), 'no serial numbers and no prices: SES has none');
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
      assert.deepEqual(JSON.parse(body['script.param']), { source: 'SES', reference: s.reference, event: 'SENT_TO_CASHIER', outboxId: row.id });
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
  } finally {
    clearEnv();
    if (world) {
      const refs = await db.customerSession.findMany({ where: { branchId: { in: Object.values(world.branches).map((b) => b.id) } }, select: { reference: true } });
      await db.fmpOutbox.deleteMany({ where: { reference: { in: refs.map((r) => r.reference) } } });
    }
    fake.close();
    await cleanup(ctx, world);
  }
});
