import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { cleanup, seedCatalog, seedWorld, startApi } from './support.mjs';

test('each order carries its FileMaker side for the shop: delivery and FileMaker\'s answer (D100)', async (t) => {
  const ctx = await startApi(t);
  if (!ctx) return;
  const { db, request } = ctx;
  let world;
  try {
    world = await seedWorld(ctx);
    const { cookies } = world;
    const [sku] = await seedCatalog(ctx, world, 1, 10);
    const app = (path, method, body, who) => request(path, method, body, cookies[who]);
    const s = await app('/sessions', 'POST', { phone: '0999901234' }, 'staff');
    const id = s.data.id;
    await app(`/sessions/${id}/selection`, 'PUT', { items: [{ skuId: sku.id, quantity: 1 }], accessories: [], payments: ['Cash'], ontop: [], points: [], receiptType: 'SIMPLIFIED' }, 'staff');
    await app(`/sessions/${id}/confirm`, 'POST', undefined, 'staff');
    const one = async (who = 'staff') => (await app(`/sessions/${id}`, 'GET', undefined, who)).data;
    const inList = async (who = 'staff') => (await app('/sessions', 'GET', undefined, who)).data.find((x) => x.id === id);

    assert.equal((await one()).fmp, null, 'nothing sent yet');
    assert.equal((await inList()).fmp, null);

    const reference = (await one()).reference;
    const base = { sessionId: id, reference, event: 'SENT_TO_CASHIER', payload: '{}' };
    await db.fmpOutbox.create({ data: { ...base, id: randomUUID(), status: 'sent', attempts: 1, sentAt: new Date(), createdAt: new Date(Date.now() - 60_000) } });
    let v = await one();
    assert.deepEqual([v.fmp.status, v.fmp.ackStatus, v.fmp.error], ['sent', null, null]);

    // a later message wins; FileMaker's answer is there; staff and stock see it too
    await db.fmpOutbox.create({ data: { ...base, id: randomUUID(), event: 'RESEND', status: 'sent', attempts: 1, sentAt: new Date(), ackStatus: 'error', ackMessage: 'SN_NOT_FOUND: SN X not found in stock', ackReceivedAt: new Date() } });
    for (const who of ['staff', 'stock']) {
      v = await inList(who);
      assert.equal(v.fmp.ackStatus, 'error', who);
      assert.equal(v.fmp.ackMessage, 'SN_NOT_FOUND: SN X not found in stock');
    }
    assert.ok(!('payload' in (await one()).fmp), 'never the message body (it carries the customer phone)');

    // an undelivered message shows its error until it is sent
    await db.fmpOutbox.create({ data: { ...base, id: randomUUID(), event: 'RESEND', status: 'failed', attempts: 8, lastError: 'FileMaker ไม่ตอบภายใน 60 วินาที' } });
    v = await one();
    assert.deepEqual([v.fmp.status, v.fmp.attempts, v.fmp.error], ['failed', 8, 'FileMaker ไม่ตอบภายใน 60 วินาที']);
    assert.equal(v.fmp.attention, 'failed');

    // D140: `attention` is Admin's rule ("ออเดอร์ที่ต้องดู"), so a queue card and Admin never disagree
    const latest = async (data) => {
      await db.fmpOutbox.deleteMany({ where: { sessionId: id } });
      await db.fmpOutbox.create({ data: { ...base, id: randomUUID(), ...data } });
      return (await inList('stock')).fmp.attention;
    };
    const ago = (minutes) => new Date(Date.now() - minutes * 60_000);
    assert.equal(await latest({ status: 'pending', createdAt: ago(3) }), null, 'just queued');
    assert.equal(await latest({ status: 'pending', createdAt: ago(20) }), 'stuck');
    assert.equal(await latest({ status: 'sent', sentAt: ago(1), ackStatus: 'success', ackMessage: 'CREATED saleID 9' }), null);
    assert.equal(await latest({ status: 'sent', sentAt: ago(1), ackStatus: 'error', ackMessage: 'CANCELLED (บิลพัก): ยกเลิกบิลพักใน FMP' }), 'ack-error');
    assert.equal(
      await latest({ status: 'sent', sentAt: ago(1), ackStatus: 'success', ackMessage: 'CREATED_SN_LATER saleID 9', snCheck: [{ sn: 'A', code: 'OK', written: true }, { sn: 'B', code: 'SN_WRONG_BRANCH', written: false }] }),
      'sn-skipped',
    );
    // a delivery that failed after an answer came on the callback door is still a failure (Admin lists it as failed)
    assert.equal(await latest({ status: 'failed', attempts: 8, lastError: 'timeout', ackStatus: 'reported', ackMessage: 'หมายเหตุ' }), 'failed');
    const admin = (await app('/admin/fmp/attention', 'GET', undefined, 'admin')).data.problems.find((x) => x.reference === reference);
    assert.equal(admin?.kind, 'failed');
    await db.fmpOutbox.deleteMany({ where: { sessionId: id } });
  } finally {
    await cleanup(ctx, world);
  }
});
