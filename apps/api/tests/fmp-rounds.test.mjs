import assert from 'node:assert/strict';
import http from 'node:http';
import { test } from 'node:test';
import { PATH, cleanup, seedCatalog, seedWorld, startApi } from './support.mjs';

// D141: a message to FileMaker stays with its round of the order and with its FileMaker (real / test), and a message that takes a
// held bill away is never lost. Found by the review of D123 (send-back / cancel) and D130 (ADMIN's switch).
process.env.FMP_WORKER_INTERVAL_SECONDS = '0'; // the test calls tick() itself
const USER = 'ses';
const PASSWORD = 'rounds-test-password';
const POS_KEY = 'pos-key-of-the-real-filemaker-0123456789';
const POS_UAT_KEY = 'pos-key-of-the-test-filemaker-0123456789';
const CALLBACK_KEY = 'callback-key-of-the-real-filemaker-012345';
const CALLBACK_UAT_KEY = 'callback-key-of-the-test-filemaker-012345';

/**
 * A stand-in for one FileMaker Data API server that keeps its records (so `_find` by reference works) and can lose an answer:
 * `fm.before(kind, body)` runs before a record is written (it may be async, and may return 'drop' to write the record and then
 * cut the connection, as a time-out while the script ran would). `fm.script(body, isUpdate)` gives the script's answer.
 */
function fakeFileMaker(database) {
  const fm = { calls: [], records: 0, bodies: new Map(), valid: new Set(), token: 0, before: null, script: null };
  fm.server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', async () => {
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
      const scriptAnswer = (isUpdate) => (body.script && fm.script ? { scriptResult: fm.script(JSON.parse(body.fieldData.ses_body), isUpdate), scriptError: '0' } : {});
      if (req.method === 'POST' && url.pathname === `${base}/layouts/ses/records`) {
        const verdict = await fm.before?.('create', JSON.parse(body.fieldData.ses_body));
        fm.records += 1;
        fm.bodies.set(String(fm.records), body.fieldData.ses_body);
        if (verdict === 'drop') return req.socket.destroy();
        return send(200, '0', 'OK', { recordId: String(fm.records), modId: '0', ...scriptAnswer(false) });
      }
      if (req.method === 'POST' && url.pathname === `${base}/layouts/ses/_find`) {
        const wanted = String(body.query?.[0]?.ses_id ?? '').replace(/^==/, '');
        const found = [...fm.bodies].filter(([, text]) => JSON.parse(text).reference === wanted).map(([recordId]) => ({ recordId }));
        return found.length ? send(200, '0', 'OK', { data: found }) : send(500, '401', 'No records match the request');
      }
      const update = url.pathname.match(new RegExp(`^${base}/layouts/ses/records/(\\d+)$`));
      if (req.method === 'PATCH' && update) {
        if (!fm.bodies.has(update[1])) return send(500, '101', 'Record is missing');
        await fm.before?.('update', JSON.parse(body.fieldData.ses_body));
        fm.bodies.set(update[1], body.fieldData.ses_body);
        return send(200, '0', 'OK', { modId: '1', ...scriptAnswer(true) });
      }
      return send(404, '102', 'Not found');
    });
  });
  return fm;
}

const prod = fakeFileMaker('UFService');
const uat = fakeFileMaker('UFService_UAT');
await Promise.all([prod, uat].map((fm) => new Promise((resolve) => fm.server.listen(0, '127.0.0.1', resolve))));
const ENV = {
  FMP_HOST: `http://127.0.0.1:${prod.server.address().port}`,
  FMP_DATABASE: 'UFService',
  FMP_USER: USER,
  FMP_PASSWORD: PASSWORD,
  FMP_UAT_HOST: `http://127.0.0.1:${uat.server.address().port}`,
  FMP_UAT_DATABASE: 'UFService_UAT',
  FMP_UAT_USER: USER,
  FMP_UAT_PASSWORD: PASSWORD,
};
const EXTRA = ['FMP_SCRIPT', 'POS_API_KEY', 'POS_UAT_API_KEY', 'FMP_CALLBACK_KEY', 'FMP_UAT_CALLBACK_KEY'];
const clearEnv = () => {
  for (const k of [...Object.keys(ENV), ...EXTRA]) delete process.env[k];
};
const writes = (fm, method) => fm.calls.filter((c) => c.method === method && /\/layouts\/ses\/records(\/\d+)?$/.test(c.path));
const eventsOf = (calls) => calls.map((c) => JSON.parse(c.body.fieldData.ses_body).event);

test('messages to FileMaker stay with their round and their FileMaker; a release is never lost (D141)', async (t) => {
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
    Object.assign(process.env, ENV);
    await db.setting.deleteMany({ where: { name: 'fmpPushMode' } });
    world = await seedWorld(ctx);
    const { cookies } = world;
    const [sku] = await seedCatalog(ctx, world, 1, 40);
    const app = (path, method, body, who) => request(path, method, body, cookies[who]);
    const base = await ctx.app.getUrl();
    const door = async (path, body, key) => {
      const res = await fetch(`${base}/api${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(key ? { Authorization: `Bearer ${key}` } : {}) },
        body: JSON.stringify(body),
      });
      return { status: res.status, data: await res.json().catch(() => null) };
    };
    const fmp = ctx.app.get((await import('../dist/fmp/fmp.service.js')).FmpService);
    let phoneNo = 10;
    const driveTo = async (lastAction) => {
      const created = await app('/sessions', 'POST', { phone: `09999141${String(phoneNo++).padStart(2, '0')}` }, 'staff');
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
    const setMode = async (mode) => assert.equal((await app('/admin/fmp/mode', 'PUT', { mode }, 'admin')).status, 200);
    const dueNow = (reference) => db.fmpOutbox.updateMany({ where: { reference, status: 'pending' }, data: { nextAttemptAt: new Date(Date.now() - 1000) } });
    const reset = () => {
      for (const fm of [prod, uat]) {
        fm.calls.length = 0;
        fm.before = null;
        fm.script = null;
      }
    };
    const sendBack = (id) => app(`/sessions/${id}/cashier/reject`, 'POST', { reason: 'อื่น ๆ', otherReason: 'หยิบผิดสี' }, 'staff');
    const cancel = (id) => app(`/sessions/${id}/cancel`, 'POST', { reason: 'ลูกค้าเปลี่ยนใจ' }, 'staff');

    await t.test('ADMIN switches off while a round is going: the messages still waiting in that round stay in SES', async () => {
      reset();
      const one = await driveTo('send');
      const two = await driveTo('send');
      prod.before = async () => {
        prod.before = null;
        await setMode('off'); // the switch flips while the first message is on its way
      };
      assert.deepEqual(await fmp.tick(), { sent: 1, failed: 0 });
      assert.equal(writes(prod, 'POST').length, 1, 'the second message did not leave');
      assert.deepEqual([(await rowsOf(one.reference))[0].status, (await rowsOf(two.reference))[0].status], ['sent', 'pending']);
      await setMode('production');
      await fmp.tick();
      assert.equal((await rowsOf(two.reference))[0].status, 'sent');
    });

    await t.test('an order cancelled while its message waited: the old "open a bill" is not sent, the cancel is', async () => {
      reset();
      const s = await driveTo('send'); // queued, not sent yet
      await setMode('off');
      assert.equal((await cancel(s.id)).status, 201);
      let rows = await rowsOf(s.reference);
      // the cancel is not dropped by the switch: it waits, for the FileMaker the order was going to
      assert.deepEqual(rows.map((r) => [r.event, r.status, r.target]), [['SENT_TO_CASHIER', 'pending', 'PRODUCTION'], ['CANCELLED', 'pending', 'PRODUCTION']]);
      assert.deepEqual(await fmp.tick(), { sent: 0, failed: 0 });
      assert.equal(prod.calls.length, 0, 'off: nothing leaves');

      await setMode('production');
      assert.deepEqual(await fmp.tick(), { sent: 1, failed: 0 });
      rows = await rowsOf(s.reference);
      assert.deepEqual(rows.map((r) => [r.event, r.status, r.attempts]), [['SENT_TO_CASHIER', 'superseded', 0], ['CANCELLED', 'sent', 1]]);
      assert.deepEqual(eventsOf(writes(prod, 'POST')), ['CANCELLED'], 'FileMaker never got a bill to open for a cancelled order');
      assert.ok(await db.fmpLog.findFirst({ where: { reference: s.reference, kind: 'superseded' } }), 'and the log says why');
      assert.equal((await app('/admin/fmp', 'GET', undefined, 'admin')).data.counts.superseded >= 1, true);
    });

    await t.test('the bill was opened but the answer was lost, then the order is sent back: the release works on the SAME record', async () => {
      reset();
      const s = await driveTo('send');
      prod.before = () => {
        prod.before = null;
        return 'drop'; // FileMaker made the record (and the held bill); SES never hears
      };
      assert.deepEqual(await fmp.tick(), { sent: 0, failed: 1 });
      assert.equal((await sendBack(s.id)).status, 201);
      reset();
      assert.deepEqual(await fmp.tick(), { sent: 1, failed: 0 }); // the first message still waits for its retry
      assert.equal(writes(prod, 'POST').length, 0, 'no second record of the order');
      assert.deepEqual(eventsOf(writes(prod, 'PATCH')), ['RETURNED_TO_STOCK'], 'the record with the held bill is the one told');
      // the first message comes due after the order went back to stock: not sent again
      await dueNow(s.reference);
      reset();
      await fmp.tick();
      assert.equal(prod.calls.filter((c) => c.path.includes('/layouts/')).length, 0);
      assert.equal((await rowsOf(s.reference))[0].status, 'superseded');
    });

    await t.test('"already done" on the retry of the same message is its success; on a later message it is still an error', async () => {
      reset();
      process.env.FMP_SCRIPT = 'ses';
      const s = await driveTo('send');
      const already = (body, isUpdate) => JSON.stringify(isUpdate ? { ok: true, code: 'ALREADY_DONE', sesID: body.reference, saleID: 'S-9' } : { ok: true, code: 'CREATED', sesID: body.reference, saleID: 'S-9', lines: 1 });
      prod.script = already;
      prod.before = () => {
        prod.before = null;
        return 'drop';
      };
      await fmp.tick();
      await dueNow(s.reference);
      assert.deepEqual(await fmp.tick(), { sent: 1, failed: 0 });
      let [row] = await rowsOf(s.reference);
      assert.deepEqual([row.status, row.ackStatus], ['sent', 'success'], row.ackMessage);
      assert.match(row.ackMessage, /^ALREADY_DONE/);
      // ADMIN sends the order again while its bill is open: the serials of THIS message were not used: an error, as before
      assert.equal((await app('/admin/fmp/resend', 'POST', { reference: s.reference }, 'admin')).status, 201);
      await fmp.tick();
      row = (await rowsOf(s.reference)).at(-1);
      assert.deepEqual([row.event, row.ackStatus], ['RESEND', 'error']);
      delete process.env.FMP_SCRIPT;
    });

    await t.test('ADMIN cannot "take the bill away" of an order no FileMaker ever got', async () => {
      reset();
      const s = await driveTo('search'); // with STOCK, never sent to the cashier
      const res = await app('/admin/fmp/resend', 'POST', { reference: s.reference }, 'admin');
      assert.equal(res.status, 409, JSON.stringify(res.data));
      assert.equal((await rowsOf(s.reference)).length, 0, 'nothing queued: the first real send is not made stale');
    });

    let both;
    await t.test('an order that went to the test FileMaker and then to the real one: both are told when it leaves the cashier', async () => {
      reset();
      await setMode('uat');
      both = await driveTo('send');
      await fmp.tick();
      await setMode('production');
      assert.equal((await app('/admin/fmp/resend', 'POST', { reference: both.reference }, 'admin')).status, 201);
      await fmp.tick();
      assert.deepEqual([writes(uat, 'POST').length, writes(prod, 'POST').length], [1, 1]);
      assert.equal(await fmp.currentTarget(both.id), 'PRODUCTION');

      reset();
      assert.equal((await sendBack(both.id)).status, 201);
      const releases = (await rowsOf(both.reference)).filter((r) => r.event === 'RETURNED_TO_STOCK');
      assert.deepEqual(releases.map((r) => r.target), ['UAT', 'PRODUCTION'], 'the FileMaker used last is the latest message');
      assert.deepEqual(await fmp.tick(), { sent: 2, failed: 0 });
      assert.deepEqual([eventsOf(writes(uat, 'PATCH')), eventsOf(writes(prod, 'PATCH'))], [['RETURNED_TO_STOCK'], ['RETURNED_TO_STOCK']]);
      assert.equal((await app(`/sessions/${both.id}`, 'GET', undefined, 'staff')).data.fmp.target, 'PRODUCTION');

      // the test FileMaker has been told: the next time only the real one is
      reset();
      assert.equal((await cancel(both.id)).status, 201);
      assert.deepEqual((await rowsOf(both.reference)).filter((r) => r.event === 'CANCELLED').map((r) => r.target), ['PRODUCTION']);
      await fmp.tick();
    });

    await t.test('with its own key, the test FileMaker cannot close or write on an order that is in the real one', async () => {
      reset();
      process.env.POS_API_KEY = POS_KEY;
      process.env.FMP_CALLBACK_KEY = CALLBACK_KEY;
      await setMode('uat');
      const s = await driveTo('send');
      await fmp.tick();
      await setMode('production');
      assert.equal((await app('/admin/fmp/resend', 'POST', { reference: s.reference }, 'admin')).status, 201);
      await fmp.tick();
      const [uatRow, prodRow] = await rowsOf(s.reference);
      assert.deepEqual([uatRow.target, prodRow.target], ['UAT', 'PRODUCTION']);
      const bill = (billNo) => ({ reference: s.reference, billNo, openedAt: new Date().toISOString() });

      // one shared key (no UAT key set): SES cannot tell who calls, as before
      assert.equal((await door('/integrations/pos/bills', bill('T-1'), POS_UAT_KEY)).status, 401);
      assert.equal((await door('/integrations/fmp/callback', { reference: s.reference, status: 'reported', message: 'shared key' }, CALLBACK_KEY)).status, 200);
      assert.equal((await rowsOf(s.reference))[1].ackMessage, 'shared key', 'lands on the latest message');

      process.env.POS_UAT_API_KEY = POS_UAT_KEY;
      process.env.FMP_UAT_CALLBACK_KEY = CALLBACK_UAT_KEY;
      // a bill printed in the test FileMaker: refused, the order stays open
      const fromTest = await door('/integrations/pos/bills', bill('T-1'), POS_UAT_KEY);
      assert.equal(fromTest.status, 409, JSON.stringify(fromTest.data));
      assert.equal((await db.customerSession.findUnique({ where: { id: s.id } })).posBillNo, null);
      // the test FileMaker's report lands on ITS message, never on the real one's
      assert.equal((await door('/integrations/fmp/callback', { reference: s.reference, status: 'error', message: 'CANCELLED (บิลพัก): test' }, CALLBACK_UAT_KEY)).status, 200);
      let rows = await rowsOf(s.reference);
      assert.deepEqual([rows[0].ackMessage, rows[1].ackMessage], ['CANCELLED (บิลพัก): test', 'shared key']);
      assert.equal((await door('/integrations/fmp/callback', { outboxId: prodRow.id, status: 'success' }, CALLBACK_UAT_KEY)).status, 409);
      assert.equal((await door('/integrations/fmp/callback', { outboxId: prodRow.id, status: 'success' }, 'wrong-key-wrong-key-wrong-key-wrong-key')).status, 401);
      // the real FileMaker's bill closes the order as always
      const real = await door('/integrations/pos/bills', bill('R-1'), POS_KEY);
      assert.equal(real.status, 201, JSON.stringify(real.data));
      assert.equal(real.data.posBillNo, 'R-1');
      // an order that is in the test FileMaker takes the test FileMaker's bill
      await setMode('uat');
      const testOnly = await driveTo('send');
      await fmp.tick();
      assert.equal((await door('/integrations/pos/bills', { reference: testOnly.reference, billNo: 'R-2', openedAt: new Date().toISOString() }, POS_KEY)).status, 409);
      assert.equal((await door('/integrations/pos/bills', { reference: testOnly.reference, billNo: 'T-2', openedAt: new Date().toISOString() }, POS_UAT_KEY)).status, 201);
      await setMode('production');
      for (const k of ['POS_UAT_API_KEY', 'FMP_UAT_CALLBACK_KEY']) delete process.env[k];
    });

    await t.test('a report that names only the order never hides the error the script answered for its latest message', async () => {
      reset();
      const s = await driveTo('send');
      await fmp.tick();
      const [row] = await rowsOf(s.reference);
      // what the `ses` script answered when SES asked it to take the held bill away
      await db.fmpOutbox.update({ where: { id: row.id }, data: { ackStatus: 'error', ackMessage: 'BILL_IN_USE saleID 9', scriptResult: JSON.stringify({ ok: false, code: 'BILL_IN_USE', saleID: 9 }) } });
      const callback = (body) => door('/integrations/fmp/callback', body, CALLBACK_KEY);
      const late = await callback({ reference: s.reference, status: 'success', message: 'เปิดบิลแล้ว' });
      assert.equal(late.status, 200, 'accepted and logged');
      assert.equal((await rowsOf(s.reference))[0].ackMessage, 'BILL_IN_USE saleID 9', 'the error stays on the order');
      assert.match((await db.fmpLog.findFirst({ where: { reference: s.reference, kind: 'callback' }, orderBy: { createdAt: 'desc' } })).summary, /เก็บใน log เท่านั้น/);
      // another error does replace it (FileMaker cancelled the held bill), and so does a report that names the message
      await callback({ reference: s.reference, status: 'error', message: 'CANCELLED (บิลพัก): ยกเลิกบิลพักใน FMP' });
      assert.equal((await rowsOf(s.reference))[0].ackMessage, 'CANCELLED (บิลพัก): ยกเลิกบิลพักใน FMP');
      await callback({ outboxId: row.id, status: 'success', message: 'ok' });
      assert.equal((await rowsOf(s.reference))[0].ackStatus, 'success');
    });

    await t.test('an edit saved while a confirm waits is checked before the order is confirmed (D129 under the lock)', async () => {
      const created = await app('/sessions', 'POST', { phone: '0999914190' }, 'staff');
      const id = created.data.id;
      await app(`/sessions/${id}/selection`, 'PUT', { items: [{ skuId: sku.id, quantity: 1 }], payments: ['Cash'], receiptType: 'SIMPLIFIED' }, 'staff');
      let confirm;
      await db.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM CustomerSession WHERE id = ${id} FOR UPDATE`;
        confirm = app(`/sessions/${id}/confirm`, 'POST', undefined, 'staff'); // passes its first checks (Cash), then waits for the lock
        await new Promise((resolve) => setTimeout(resolve, 400));
        await tx.sessionPayment.deleteMany({ where: { sessionId: id } });
        await tx.sessionPayment.create({ data: { sessionId: id, method: '0% Credit Card' } }); // no card type, no months
      });
      const res = await confirm;
      assert.equal(res.status, 400, JSON.stringify(res.data));
      assert.match(JSON.stringify(res.data), /card type/);
      assert.equal((await db.customerSession.findUnique({ where: { id } })).confirmed, false);
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
