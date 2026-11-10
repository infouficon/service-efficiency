import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { cleanup, seedWorld, startApi } from './support.mjs';

const MIN = 60_000;
const ago = (minutes) => new Date(Date.now() - minutes * MIN);

test('ADMIN sees what needs a person: orders waiting too long for a bill, and messages to FileMaker that failed (SES-10, D116)', async (t) => {
  const ctx = await startApi(t);
  if (!ctx) return;
  const { db, request } = ctx;
  let world;
  try {
    world = await seedWorld(ctx);
    const { prefix, cookies, branches, staffIds } = world;
    const ref = (name) => `${prefix}-${name}`.slice(0, 32);
    const order = (name, data) =>
      db.customerSession.create({
        data: { reference: ref(name), branchId: branches.a.id, staffId: staffIds.staff, state: 'SENT_TO_CASHIER', ...data },
      });
    const sentAt = (minutes) => ({ events: { create: { eventType: 'STOCK_SENT_TO_CASHIER', actorStaffId: staffIds.stock, createdAt: ago(minutes) } } });
    const message = async (name, session, data) =>
      db.fmpOutbox.create({
        data: { id: randomUUID(), sessionId: session.id, reference: ref(name), event: 'SENT_TO_CASHIER', payload: '{}', ...data },
      });

    // orders at the cashier
    const late = await order('late', sentAt(45)); // no bill 45 min after sending
    await order('fresh', sentAt(10)); // 10 min: not yet
    await order('paid-late', { state: 'BILL_OPENED', posBillNo: 'B-1', posBillOpenedAt: ago(300), ...sentAt(320) }); // bill open 5 h, not paid
    await order('paid-ok', { state: 'BILL_OPENED', posBillNo: 'B-2', posBillOpenedAt: ago(60), ...sentAt(90) }); // bill open 1 h: fine
    await order('done', { state: 'COMPLETED', ...sentAt(600) });
    await order('old', { state: 'SENT_TO_CASHIER', customerWalkInAt: ago(20 * 24 * 60), ...sentAt(20 * 24 * 60) }); // older than 14 days

    // messages to FileMaker
    const failed = await message('late', late, { status: 'failed', attempts: 5, lastError: 'FMP ปฏิเสธ (401)', createdAt: ago(40) });
    const stuck = await order('stuck', sentAt(5));
    await message('stuck', stuck, { status: 'pending', createdAt: ago(20) });
    const fine = await order('fine-wait', sentAt(5));
    await message('fine-wait', fine, { status: 'pending', createdAt: ago(3) }); // 3 min: still going
    const ackErr = await order('ack-err', sentAt(5));
    await message('ack-err', ackErr, { status: 'sent', sentAt: ago(4), ackStatus: 'error', ackMessage: 'SN_WRONG_BRANCH', createdAt: ago(4) });
    const healed = await order('healed', sentAt(5));
    await message('healed', healed, { status: 'failed', lastError: 'old failure', createdAt: ago(30) });
    await message('healed', healed, { status: 'sent', sentAt: ago(2), ackStatus: 'success', createdAt: ago(2) }); // a later good message clears it
    const ackOk = await order('ack-ok', sentAt(5));
    await message('ack-ok', ackOk, { status: 'sent', sentAt: ago(4), ackStatus: 'success', createdAt: ago(4) });

    const get = (query = '', who = 'admin') => request(`/admin/fmp/attention${query}`, 'GET', undefined, cookies[who]);
    const mine = (rows) => rows.filter((r) => r.reference.startsWith(prefix));

    await t.test('ADMIN only', async () => {
      assert.equal((await request('/admin/fmp/attention')).status, 401);
      for (const who of ['staff', 'stock', 'manager']) assert.equal((await get('', who)).status, 403, who);
    });

    await t.test('orders waiting for a bill: 30 min to open one, 4 h to pay it; newest sends and finished or old orders are left out', async () => {
      const res = await get();
      assert.equal(res.status, 200, JSON.stringify(res.data));
      assert.deepEqual(res.data.thresholds, { openMinutes: 30, payMinutes: 240, stuckMinutes: 10 });
      const waiting = mine(res.data.waiting);
      assert.deepEqual(
        waiting.map((w) => [w.reference, w.stage]).sort(),
        [[ref('late'), 'no-bill'], [ref('paid-late'), 'bill-open']].sort(),
      );
      const lateRow = waiting.find((w) => w.reference === ref('late'));
      assert.ok(lateRow.minutes >= 44 && lateRow.minutes <= 46, String(lateRow.minutes));
      assert.equal(lateRow.branchCode, branches.a.code);
      assert.equal(lateRow.fmp.status, 'failed', 'the FileMaker side of the order is shown with it');
      assert.equal(waiting.find((w) => w.reference === ref('paid-late')).posBillNo, 'B-1');
      assert.equal(res.data.waiting.findIndex((w) => w.reference === ref('paid-late')) < res.data.waiting.findIndex((w) => w.reference === ref('late')), true, 'longest wait first');
    });

    await t.test('messages that failed, are stuck or were answered with an error; a later good message clears the order', async () => {
      const problems = mine((await get()).data.problems);
      assert.deepEqual(
        problems.map((p) => [p.reference, p.kind]).sort(),
        [[ref('ack-err'), 'ack-error'], [ref('late'), 'failed'], [ref('stuck'), 'stuck']].sort(),
      );
      const f = problems.find((p) => p.reference === ref('late'));
      assert.equal(f.outboxId, failed.id);
      assert.equal(f.message, 'FMP ปฏิเสธ (401)');
      assert.equal(f.attempts, 5);
      assert.equal(problems.find((p) => p.reference === ref('ack-err')).message, 'SN_WRONG_BRANCH');
      assert.equal(problems.find((p) => p.reference === ref('stuck')).outboxId, (await db.fmpOutbox.findFirst({ where: { reference: ref('stuck') } })).id);
      assert.ok(!problems.some((p) => [ref('healed'), ref('ack-ok'), ref('fine-wait')].includes(p.reference)));
    });

    await t.test('the thresholds can be changed and are kept inside sane limits', async () => {
      const tight = await get('?openMinutes=5&stuckMinutes=2');
      assert.deepEqual(tight.data.thresholds, { openMinutes: 5, payMinutes: 240, stuckMinutes: 2 });
      assert.ok(mine(tight.data.waiting).some((w) => w.reference === ref('fresh')), '10 minutes is late when the limit is 5');
      assert.ok(mine(tight.data.problems).some((p) => p.reference === ref('fine-wait')), '3 minutes is stuck when the limit is 2');
      const wild = await get('?openMinutes=0&payMinutes=999999&stuckMinutes=abc');
      assert.deepEqual(wild.data.thresholds, { openMinutes: 5, payMinutes: 7 * 24 * 60, stuckMinutes: 10 });
      assert.equal(wild.data.total, wild.data.waiting.length + wild.data.problems.length);
    });
    await t.test('D119: a held bill FileMaker opened (script CREATED) waits for payment, not for a bill; skipped serials are flagged', async () => {
      const heldLate = await order('held-late', sentAt(300));
      await message('held-late', heldLate, { status: 'sent', sentAt: ago(299), ackStatus: 'success', createdAt: ago(299) });
      const heldOk = await order('held-ok', sentAt(60));
      await message('held-ok', heldOk, { status: 'sent', sentAt: ago(59), ackStatus: 'success', createdAt: ago(59) });
      const skipped = await order('skipped', sentAt(5));
      await message('skipped', skipped, {
        status: 'sent', sentAt: ago(4), ackStatus: 'success', createdAt: ago(4),
        snCheck: [{ sn: 'OK1', written: true, code: null }, { sn: 'BAD2', written: false, code: 'SN_WRONG_BRANCH', branch: 'ISTM', model: 'MX1' }],
      });
      const res = await get();
      const waiting = mine(res.data.waiting);
      assert.equal(waiting.find((w) => w.reference === ref('held-late'))?.stage, 'held-bill', 'held bill open 5 h without payment');
      assert.ok(!waiting.some((w) => w.reference === ref('held-ok')), 'a held bill open 1 h is fine (it is not "no bill after 30 min")');
      const p = mine(res.data.problems).find((x) => x.reference === ref('skipped'));
      assert.equal(p?.kind, 'sn-skipped');
      assert.match(p.message, /1 SN ไม่ได้ลงบิล: BAD2 \(SN_WRONG_BRANCH สาขา ISTM รุ่น MX1\)/);
      assert.equal(p.snCheck.length, 2);
    });
  } finally {
    if (world) await db.fmpOutbox.deleteMany({ where: { reference: { startsWith: world.prefix } } }).catch(() => undefined);
    await cleanup(ctx, world);
  }
});
