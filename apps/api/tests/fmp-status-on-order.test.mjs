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
    await app(`/sessions/${id}/selection`, 'PUT', { items: [{ skuId: sku.id, quantity: 1 }], accessories: [], payments: ['Cash'], ontop: [], points: [] }, 'staff');
    await app(`/sessions/${id}/confirm`, 'POST', undefined, 'staff');
    const one = async (who = 'cashier') => (await app(`/sessions/${id}`, 'GET', undefined, who)).data;
    const inList = async (who = 'cashier') => (await app('/sessions', 'GET', undefined, who)).data.find((x) => x.id === id);

    assert.equal((await one()).fmp, null, 'nothing sent yet');
    assert.equal((await inList()).fmp, null);

    const reference = (await one()).reference;
    const base = { sessionId: id, reference, event: 'SENT_TO_CASHIER', payload: '{}' };
    await db.fmpOutbox.create({ data: { ...base, id: randomUUID(), status: 'sent', attempts: 1, sentAt: new Date(), createdAt: new Date(Date.now() - 60_000) } });
    let v = await one();
    assert.deepEqual([v.fmp.status, v.fmp.ackStatus, v.fmp.error], ['sent', null, null]);

    // a later message wins; FileMaker's answer is there; staff and stock see it too
    await db.fmpOutbox.create({ data: { ...base, id: randomUUID(), event: 'RESEND', status: 'sent', attempts: 1, sentAt: new Date(), ackStatus: 'error', ackMessage: 'SN_NOT_FOUND: SN X not found in stock', ackReceivedAt: new Date() } });
    for (const who of ['cashier', 'staff', 'stock']) {
      v = await inList(who);
      assert.equal(v.fmp.ackStatus, 'error', who);
      assert.equal(v.fmp.ackMessage, 'SN_NOT_FOUND: SN X not found in stock');
    }
    assert.ok(!('payload' in (await one()).fmp), 'never the message body (it carries the customer phone)');

    // an undelivered message shows its error until it is sent
    await db.fmpOutbox.create({ data: { ...base, id: randomUUID(), event: 'RESEND', status: 'failed', attempts: 8, lastError: 'FileMaker ไม่ตอบภายใน 60 วินาที' } });
    v = await one();
    assert.deepEqual([v.fmp.status, v.fmp.attempts, v.fmp.error], ['failed', 8, 'FileMaker ไม่ตอบภายใน 60 วินาที']);
    await db.fmpOutbox.deleteMany({ where: { sessionId: id } });
  } finally {
    await cleanup(ctx, world);
  }
});
