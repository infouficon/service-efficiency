import assert from 'node:assert/strict';
import http from 'node:http';
import { test } from 'node:test';
import { PATH, cleanup, seedCatalog, seedWorld, startApi } from './support.mjs';

// D130: ADMIN's switch for where an order sent to the cashier goes: the real FileMaker (U POS), nowhere, or the test FileMaker.
process.env.FMP_WORKER_INTERVAL_SECONDS = '0'; // the test calls tick() itself
const USER = 'ses';
const PASSWORD = 'push-mode-test-password';

/** A stand-in for one FileMaker Data API server (login / logout, create / update / find in layout `ses`). */
function fakeFileMaker(database) {
  const fm = { calls: [], records: 0, bodies: new Map(), valid: new Set(), token: 0 };
  fm.server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const url = new URL(req.url, 'http://fm');
      const body = raw ? JSON.parse(raw) : null;
      fm.calls.push({ method: req.method, path: url.pathname, body });
      res.setHeader('content-type', 'application/json');
      const send = (status, code, message, response = {}) => {
        res.statusCode = status;
        res.end(JSON.stringify({ response, messages: [{ code, message }] }));
      };
      const base = `/fmi/data/vLatest/databases/${database}`;
      const bearer = (req.headers.authorization ?? '').replace('Bearer ', '');
      if (req.method === 'POST' && url.pathname === `${base}/sessions`) {
        const token = `${database}-tok-${(fm.token += 1)}`;
        fm.valid.add(token);
        return send(200, '0', 'OK', { token });
      }
      if (req.method === 'DELETE' && url.pathname.startsWith(`${base}/sessions/`)) return send(200, '0', 'OK');
      if (!fm.valid.has(bearer)) return send(401, '952', 'Invalid FileMaker Data API token (*)');
      if (req.method === 'POST' && url.pathname === `${base}/layouts/ses/records`) {
        fm.records += 1;
        fm.bodies.set(String(fm.records), body.fieldData?.ses_body);
        return send(200, '0', 'OK', { recordId: String(fm.records), modId: '0' });
      }
      if (req.method === 'POST' && url.pathname === `${base}/layouts/ses/_find`) return send(500, '401', 'No records match the request');
      const update = url.pathname.match(new RegExp(`^${base}/layouts/ses/records/(\\d+)$`));
      if (req.method === 'PATCH' && update) {
        if (!fm.bodies.has(update[1])) return send(500, '101', 'Record is missing');
        fm.bodies.set(update[1], body.fieldData?.ses_body);
        return send(200, '0', 'OK', { modId: '1' });
      }
      return send(404, '102', 'Not found');
    });
  });
  return fm;
}

const prod = fakeFileMaker('UFService');
const uat = fakeFileMaker('UFService_UAT');
await Promise.all([prod, uat].map((fm) => new Promise((resolve) => fm.server.listen(0, '127.0.0.1', resolve))));
const PROD_ENV = { FMP_HOST: `http://127.0.0.1:${prod.server.address().port}`, FMP_DATABASE: 'UFService', FMP_USER: USER, FMP_PASSWORD: PASSWORD };
const UAT_ENV = { FMP_UAT_HOST: `http://127.0.0.1:${uat.server.address().port}`, FMP_UAT_DATABASE: 'UFService_UAT', FMP_UAT_USER: USER, FMP_UAT_PASSWORD: PASSWORD };
const clearEnv = () => {
  for (const k of [...Object.keys(PROD_ENV), ...Object.keys(UAT_ENV)]) delete process.env[k];
};
const creates = (fm) => fm.calls.filter((c) => c.method === 'POST' && c.path.endsWith('/layouts/ses/records'));
const writes = (fm) => fm.calls.filter((c) => c.path.includes('/layouts/ses/records'));

test('ADMIN switches where orders go: real FileMaker, nowhere (logged), or the UAT FileMaker (D130)', async (t) => {
  const ctx = await startApi(t);
  if (!ctx) {
    prod.server.close();
    uat.server.close();
    return;
  }
  const { db, request } = ctx;
  let world;
  const testStart = new Date(Date.now() - 1000);
  try {
    clearEnv();
    Object.assign(process.env, PROD_ENV);
    await db.setting.deleteMany({ where: { name: 'fmpPushMode' } });
    world = await seedWorld(ctx);
    const { cookies } = world;
    const [sku] = await seedCatalog(ctx, world, 1, 20);
    const app = (path, method, body, who) => request(path, method, body, cookies[who]);
    const fmp = ctx.app.get((await import('../dist/fmp/fmp.service.js')).FmpService);
    let phoneNo = 10;
    const driveTo = async (lastAction) => {
      const created = await app('/sessions', 'POST', { phone: `09999130${String(phoneNo++).padStart(2, '0')}` }, 'staff');
      const id = created.data.id;
      for (const [action, role] of PATH) {
        if (action === 'confirm') {
          await app(`/sessions/${id}/selection`, 'PUT', { items: [{ skuId: sku.id, quantity: 1 }], payments: ['Cash'], receiptType: 'SIMPLIFIED' }, 'staff');
          await app(`/sessions/${id}/confirm`, 'POST', undefined, 'staff');
        } else {
          const res = await app(`/sessions/${id}/step`, 'POST', { action }, role);
          assert.equal(res.status, 201, `${action}: ${JSON.stringify(res.data)}`);
        }
        if (action === lastAction) break;
      }
      return (await app(`/sessions/${id}`, 'GET', undefined, 'staff')).data;
    };
    const rowsOf = (reference) => db.fmpOutbox.findMany({ where: { reference }, orderBy: { createdAt: 'asc' } });
    const setMode = (mode, who = 'admin') => app('/admin/fmp/mode', 'PUT', { mode }, who);
    const resetCalls = () => {
      prod.calls.length = 0;
      uat.calls.length = 0;
    };

    await t.test('production by default, as before the switch; only ADMIN changes it, and only to a FileMaker that is set', async () => {
      assert.equal((await app('/settings', 'GET', undefined, 'staff')).data.fmpPushMode, 'production', 'everybody sees where orders go');
      const status = (await app('/admin/fmp', 'GET', undefined, 'admin')).data;
      assert.equal(status.mode.mode, 'production');
      assert.equal(status.uat.configured, false);
      assert.equal((await setMode('off', 'staff')).status, 403);
      assert.equal((await setMode('somewhere')).status, 400);
      assert.equal((await setMode('uat')).status, 400, 'no FMP_UAT_* yet');
    });

    let queuedBeforeOff;
    await t.test('production: the message goes to the real FileMaker with test=false', async () => {
      resetCalls();
      const s = await driveTo('send');
      const [row] = await rowsOf(s.reference);
      assert.equal(row.target, 'PRODUCTION');
      assert.equal(row.status, 'pending');
      assert.equal(JSON.parse(row.payload).test, false);
      await fmp.tick();
      assert.equal(creates(prod).length, 1);
      assert.equal(uat.calls.length, 0);
      queuedBeforeOff = await driveTo('send'); // queued while production, still pending when ADMIN switches off below
    });

    await t.test('off: nothing leaves SES; an order sent meanwhile is kept as skipped and logged, never sent later', async () => {
      resetCalls();
      const res = await setMode('off');
      assert.equal(res.status, 200);
      assert.equal(res.data.mode, 'off');
      assert.equal((await app('/settings', 'GET', undefined, 'stock')).data.fmpPushMode, 'off');
      const s = await driveTo('send');
      assert.equal(s.state, 'SENT_TO_CASHIER', 'the order itself goes on');
      const [row] = await rowsOf(s.reference);
      assert.equal(row.status, 'skipped');
      assert.equal(row.target, 'NONE');
      assert.match(row.lastError, /ปิดการส่ง/);
      assert.equal(s.fmp.status, 'skipped', 'the order says why U POS has no bill');
      const logged = await db.fmpLog.findFirst({ where: { reference: s.reference, kind: 'skipped' } });
      assert.ok(logged, 'written to the FileMaker log');
      assert.ok(await db.fmpLog.findFirst({ where: { kind: 'mode', createdAt: { gte: testStart } } }), 'the switch is logged');
      assert.deepEqual(await fmp.tick(), { sent: 0, failed: 0 });
      assert.equal(prod.calls.length + uat.calls.length, 0, 'not even the message queued before the switch');
      assert.equal((await rowsOf(queuedBeforeOff.reference))[0].status, 'pending');
      // an order only ever held back has no held bill: cancelling it queues nothing
      assert.equal((await app(`/sessions/${s.id}/cancel`, 'POST', { reason: 'ลูกค้าเปลี่ยนใจ' }, 'staff')).status, 201);
      assert.equal((await rowsOf(s.reference)).length, 1);

      // back to production: what waited goes; what was held back stays held back
      assert.equal((await setMode('production')).status, 200);
      await fmp.tick();
      assert.equal((await rowsOf(queuedBeforeOff.reference))[0].status, 'sent');
      assert.equal((await rowsOf(s.reference))[0].status, 'skipped');
      assert.equal(creates(prod).length, 1);
    });

    await t.test('uat: the test FileMaker gets test=true; a record id never crosses servers; a release goes where the bill is', async () => {
      Object.assign(process.env, UAT_ENV);
      assert.equal((await app('/admin/fmp', 'GET', undefined, 'admin')).data.uat.configured, true);

      // an order billed in production before the switch
      resetCalls();
      const real = await driveTo('send');
      await fmp.tick();
      assert.equal(creates(prod).length, 1);

      assert.equal((await setMode('uat')).status, 200);
      resetCalls();
      const s = await driveTo('send');
      const [row] = await rowsOf(s.reference);
      assert.equal(row.target, 'UAT');
      assert.equal(JSON.parse(row.payload).test, true);
      await fmp.tick();
      assert.equal(creates(uat).length, 1);
      assert.equal(prod.calls.length, 0, 'nothing reaches the real FileMaker');
      assert.match((await db.fmpLog.findFirst({ where: { reference: s.reference, direction: 'OUT', kind: 'create' } })).summary, /^\[UAT\] /);

      // the order billed in production is sent back to stock while on UAT: the release still goes to production
      resetCalls();
      assert.equal((await app(`/sessions/${real.id}/cashier/reject`, 'POST', { reason: 'อื่น ๆ', otherReason: 'หยิบผิดสี' }, 'staff')).status, 201);
      const back = (await rowsOf(real.reference)).find((r) => r.event === 'RETURNED_TO_STOCK');
      assert.equal(back.target, 'PRODUCTION');
      assert.equal(JSON.parse(back.payload).test, false);
      await fmp.tick();
      assert.equal(writes(prod).filter((c) => c.method === 'PATCH').length, 1, 'updates the production record');
      assert.equal(writes(uat).length, 0);

      // the UAT order resent once ADMIN is back on production: a NEW record in production, not a PATCH of the UAT record id
      assert.equal((await setMode('production')).status, 200);
      resetCalls();
      assert.equal((await app('/admin/fmp/resend', 'POST', { reference: s.reference }, 'admin')).status, 201);
      await fmp.tick();
      assert.equal(creates(prod).length, 1);
      assert.equal(writes(prod).filter((c) => c.method === 'PATCH').length, 0);
      assert.equal(uat.calls.length, 0);
    });

    await t.test('a message whose FileMaker is no longer set fails (and retries) instead of going to the other one', async () => {
      assert.equal((await setMode('uat')).status, 200);
      const s = await driveTo('send');
      for (const k of Object.keys(UAT_ENV)) delete process.env[k];
      resetCalls();
      assert.deepEqual(await fmp.tick(), { sent: 0, failed: 1 });
      assert.equal(prod.calls.length, 0);
      const [row] = await rowsOf(s.reference);
      assert.equal(row.status, 'pending');
      assert.match(row.lastError, /UAT/);
      // and a new order on uat without FMP_UAT_* is held back, not sent to production
      const next = await driveTo('send');
      assert.equal((await rowsOf(next.reference))[0].status, 'skipped');
    });
  } finally {
    clearEnv();
    await db.setting.deleteMany({ where: { name: 'fmpPushMode' } });
    if (world) {
      const refs = await db.customerSession.findMany({ where: { branchId: { in: Object.values(world.branches).map((b) => b.id) } }, select: { reference: true } });
      await db.fmpOutbox.deleteMany({ where: { reference: { in: refs.map((r) => r.reference) } } });
    }
    await db.fmpLog.deleteMany({ where: { createdAt: { gte: testStart } } });
    prod.server.close();
    uat.server.close();
    await cleanup(ctx, world);
  }
});
