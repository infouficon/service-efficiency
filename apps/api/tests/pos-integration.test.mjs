import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PATH, cleanup, seedCatalog, seedWorld, startApi } from './support.mjs';

// The U POS integration key (D60). Read per request, so setting it here is enough.
const KEY = 'test-pos-key-0123456789abcdef0123456789abcdef';
process.env.POS_API_KEY = KEY;

test('U POS reads the orders waiting at the cashier and reports the real bill (D60, F17)', async (t) => {
  const ctx = await startApi(t);
  if (!ctx) return;
  const { db, request } = ctx;
  let world;
  try {
    world = await seedWorld(ctx);
    const { cookies, branches } = world;
    const [skuA, skuB] = await seedCatalog(ctx, world, 2, 5);
    const base = await ctx.app.getUrl();
    const call = async (path, { method = 'GET', body, key = KEY } = {}) => {
      const response = await fetch(`${base}/api${path}`, {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(key ? { Authorization: `Bearer ${key}` } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return {
        status: response.status,
        data: await response.json().catch(() => null),
      };
    };
    const app = (path, method, body, who) =>
      request(path, method, body, cookies[who]);
    let phoneNo = 600;
    /** A session driven along the happy path up to and including `lastAction`. */
    const driveTo = async (lastAction) => {
      const created = await app(
        '/sessions',
        'POST',
        { phone: `09999006${String(phoneNo++).slice(-2)}` },
        'staff',
      );
      const id = created.data.id;
      for (const [action, role] of PATH) {
        if (action === 'confirm') {
          await app(
            `/sessions/${id}/selection`,
            'PUT',
            {
              items: [
                { skuId: skuA.id, quantity: 2 },
                { skuId: skuB.id, quantity: 1 },
              ],
              accessories: [{ accessoryName: 'Case', quantity: 1 }],
              payments: ['Cash'],
              ontop: ['AIS'],
              points: ['MCard'],
            },
            'staff',
          );
          await app(`/sessions/${id}/confirm`, 'POST', undefined, 'staff');
        } else {
          const res = await app(
            `/sessions/${id}/step`,
            'POST',
            { action },
            role,
          );
          assert.equal(
            res.status,
            201,
            `${action}: ${JSON.stringify(res.data)}`,
          );
        }
        if (action === lastAction) break;
      }
      return (await app(`/sessions/${id}`, 'GET', undefined, 'staff')).data;
    };

    await t.test(
      'closed without a key; the key is checked on every call',
      async () => {
        delete process.env.POS_API_KEY;
        assert.equal(
          (await call(`/integrations/pos/orders?branch=${branches.a.code}`))
            .status,
          404,
          'not configured: the door does not exist',
        );
        process.env.POS_API_KEY = KEY;
        assert.equal(
          (
            await call(`/integrations/pos/orders?branch=${branches.a.code}`, {
              key: '',
            })
          ).status,
          401,
        );
        assert.equal(
          (
            await call(`/integrations/pos/orders?branch=${branches.a.code}`, {
              key: `${KEY}x`,
            })
          ).status,
          401,
        );
        assert.equal(
          (
            await call(`/integrations/pos/orders?branch=${branches.a.code}`, {
              key: 'short',
            })
          ).status,
          401,
        );
        assert.equal(
          (await call(`/integrations/pos/orders?branch=${branches.a.code}`))
            .status,
          200,
        );
        assert.equal(
          (
            await call('/integrations/pos/bills', {
              method: 'POST',
              body: {},
              key: 'wrong',
            })
          ).status,
          401,
        );
        // the cookie of a signed-in user is no key
        assert.equal(
          (
            await request(
              '/integrations/pos/orders?branch=x',
              'GET',
              undefined,
              cookies.admin,
            )
          ).status,
          401,
        );
      },
    );

    await t.test(
      'the orders waiting for a bill, with their lines',
      async () => {
        const sent = await driveTo('send');
        const scanned = await driveTo('scan');
        await driveTo('found'); // not at the cashier yet
        const cancelled = await driveTo('send');
        await app(
          `/sessions/${cancelled.id}/cancel`,
          'POST',
          { reason: 'ลูกค้าเปลี่ยนใจ' },
          'cashier',
        );
        const billed = await driveTo('bill'); // already billed: nothing left to prefill
        assert.equal(billed.state, 'BILL_OPENED');

        const list = await call(
          `/integrations/pos/orders?branch=${branches.a.code}`,
        );
        assert.equal(list.status, 200, JSON.stringify(list.data));
        assert.equal(list.data.branch.code, branches.a.code);
        assert.deepEqual(
          list.data.orders.map((o) => o.reference).sort(),
          [sent.reference, scanned.reference].sort(),
          'only orders at SENT_TO_CASHIER, CASHIER_RECEIVED or CASHIER_SCAN',
        );
        const order = list.data.orders.find(
          (o) => o.reference === sent.reference,
        );
        assert.equal(
          order.queue,
          `${sent.queueLetter}${String(sent.queueNo).padStart(3, '0')}`,
        );
        assert.equal(order.state, 'SENT_TO_CASHIER');
        assert.equal(order.customerPhone, sent.phone);
        assert.deepEqual(
          order.items.map((i) => [i.partNo, i.quantity]).sort(),
          [
            [skuA.sku, 2],
            [skuB.sku, 1],
          ].sort(),
        );
        assert.ok(order.items.every((i) => i.name));
        assert.deepEqual(order.accessories, [{ name: 'Case', quantity: 1 }]);
        assert.deepEqual(order.payments, ['Cash']);
        assert.deepEqual(order.ontop, ['AIS']);
        assert.deepEqual(order.points, ['MCard']);
        assert.equal(order.posBillNo, null);
        assert.ok(
          !('staffPassword' in order) && !('id' in order),
          'no internal ids or credentials',
        );

        const byQueue = await call(
          `/integrations/pos/orders?branch=${branches.a.code}&queue=${order.queue}`,
        );
        assert.ok(byQueue.data.orders.every((o) => o.queue === order.queue));
        assert.ok(
          byQueue.data.orders.some((o) => o.reference === sent.reference),
        );
        assert.equal(
          (await call('/integrations/pos/orders')).status,
          400,
          'a branch is required',
        );
        assert.equal(
          (await call('/integrations/pos/orders?branch=NOPE')).status,
          404,
        );
        assert.deepEqual(
          (await call(`/integrations/pos/orders?branch=${branches.b.code}`))
            .data.orders,
          [],
          'another branch has none',
        );
        await app(
          `/sessions/${sent.id}/cancel`,
          'POST',
          { reason: 'ลูกค้าเปลี่ยนใจ' },
          'staff',
        );
        await app(
          `/sessions/${scanned.id}/cancel`,
          'POST',
          { reason: 'ลูกค้าเปลี่ยนใจ' },
          'staff',
        );
      },
    );

    await t.test(
      'the bill opened in U POS moves the order on and records the real time',
      async () => {
        const session = await driveTo('scan');
        // a time after the walk-in but well before "now": the real bill time is not the moment SES hears about it
        const openedAt = new Date(
          new Date(session.customerWalkInAt).getTime() + 1,
        ).toISOString();
        const bill = (body) =>
          call('/integrations/pos/bills', { method: 'POST', body });
        const done = await bill({
          reference: session.reference,
          billNo: 'INV-2026-000123',
          openedAt,
        });
        assert.equal(done.status, 201, JSON.stringify(done.data));
        assert.equal(done.data.state, 'BILL_OPENED');
        assert.equal(done.data.posBillNo, 'INV-2026-000123');
        const full = (
          await app(`/sessions/${session.id}`, 'GET', undefined, 'staff')
        ).data;
        assert.equal(full.state, 'BILL_OPENED');
        assert.equal(
          new Date(full.billOpenedAt).toISOString(),
          openedAt,
          'the real time, not the click',
        );
        assert.equal(new Date(full.posBillOpenedAt).toISOString(), openedAt);
        assert.equal(full.posBillNo, 'INV-2026-000123');
        const event = full.events
          .filter((e) => e.eventType === 'BILL_OPENED')
          .at(-1);
        assert.equal(event.actorStaffId, 'U-POS');
        assert.equal(event.metadata.source, 'U-POS');
        assert.equal(event.metadata.billNo, 'INV-2026-000123');
        // the cashier only has to complete the sale in SES
        assert.equal(
          (
            await app(
              `/sessions/${session.id}/step`,
              'POST',
              { action: 'complete' },
              'cashier',
            )
          ).status,
          201,
        );
        // the same report again changes nothing; a different bill number is a conflict
        assert.equal(
          (
            await bill({
              reference: session.reference,
              billNo: 'INV-2026-000123',
              openedAt,
            })
          ).status,
          201,
        );
        assert.equal(
          (
            await bill({
              reference: session.reference,
              billNo: 'INV-2026-000999',
              openedAt,
            })
          ).status,
          409,
        );

        // from SENT_TO_CASHIER and CASHIER_RECEIVED too: the cashier did not have to press anything in SES
        for (const stage of ['send', 'receive']) {
          const s = await driveTo(stage);
          const r = await bill({
            reference: s.reference,
            billNo: `B-${stage}`,
            openedAt: new Date().toISOString(),
          });
          assert.equal(r.status, 201, `${stage}: ${JSON.stringify(r.data)}`);
          assert.equal(r.data.state, 'BILL_OPENED');
          await app(
            `/sessions/${s.id}/cancel`,
            'POST',
            { reason: 'ลูกค้าเปลี่ยนใจ' },
            'staff',
          );
        }
      },
    );

    await t.test(
      'when the cashier pressed first the SES time stays and the U POS bill is added beside it',
      async () => {
        const session = await driveTo('bill');
        const clicked = session.billOpenedAt;
        const openedAt = new Date(
          new Date(session.customerWalkInAt).getTime() + 2,
        ).toISOString();
        const r = await call('/integrations/pos/bills', {
          method: 'POST',
          body: { reference: session.reference, billNo: 'B-late', openedAt },
        });
        assert.equal(r.status, 201, JSON.stringify(r.data));
        const full = (
          await app(`/sessions/${session.id}`, 'GET', undefined, 'staff')
        ).data;
        assert.equal(full.state, 'BILL_OPENED');
        assert.equal(
          full.billOpenedAt,
          clicked,
          'the SES milestone is not rewritten',
        );
        assert.equal(full.posBillNo, 'B-late');
        assert.equal(new Date(full.posBillOpenedAt).toISOString(), openedAt);
        assert.equal(
          full.events.filter((e) => e.eventType === 'BILL_OPENED').length,
          1,
          'no second event',
        );
        // and a completed sale can still learn its bill number
        await app(
          `/sessions/${session.id}/step`,
          'POST',
          { action: 'complete' },
          'cashier',
        );
        const completed = await driveTo('complete');
        const late = await call('/integrations/pos/bills', {
          method: 'POST',
          body: {
            reference: completed.reference,
            billNo: 'B-after',
            openedAt: new Date().toISOString(),
          },
        });
        assert.equal(late.status, 201);
        assert.equal(
          (await app(`/sessions/${completed.id}`, 'GET', undefined, 'staff'))
            .data.posBillNo,
          'B-after',
        );
      },
    );

    await t.test('what U POS may not do', async () => {
      const bill = (body) =>
        call('/integrations/pos/bills', { method: 'POST', body });
      const atStock = await driveTo('found');
      const now = new Date().toISOString();
      assert.equal(
        (
          await bill({
            reference: atStock.reference,
            billNo: 'X',
            openedAt: now,
          })
        ).status,
        409,
        'the order has not reached the cashier',
      );
      const atCashier = await driveTo('send');
      for (const bad of [
        {},
        { reference: atCashier.reference },
        { reference: atCashier.reference, billNo: '', openedAt: now },
        {
          reference: atCashier.reference,
          billNo: 'x'.repeat(65),
          openedAt: now,
        },
        { reference: atCashier.reference, billNo: 'X', openedAt: 'yesterday' },
        {
          reference: atCashier.reference,
          billNo: 'X',
          openedAt: new Date(Date.now() + 3_600_000).toISOString(),
        },
        {
          reference: atCashier.reference,
          billNo: 'X',
          openedAt: new Date(Date.now() - 400 * 86_400_000).toISOString(),
        },
        {
          reference: atCashier.reference,
          billNo: 'X',
          openedAt: now,
          extra: 1,
        },
      ])
        assert.equal(
          (await bill(bad)).status,
          400,
          JSON.stringify(bad).slice(0, 90),
        );
      assert.equal(
        (
          await bill({
            reference: 'SES-00000000-000000',
            billNo: 'X',
            openedAt: now,
          })
        ).status,
        404,
      );
      await app(
        `/sessions/${atCashier.id}/cancel`,
        'POST',
        { reason: 'ลูกค้าเปลี่ยนใจ' },
        'staff',
      );
      assert.equal(
        (
          await bill({
            reference: atCashier.reference,
            billNo: 'X',
            openedAt: now,
          })
        ).status,
        409,
        'a cancelled order',
      );
      await app(
        `/sessions/${atStock.id}/cancel`,
        'POST',
        { reason: 'ลูกค้าเปลี่ยนใจ' },
        'staff',
      );
      assert.equal(
        await db.customerSession.count({
          where: { posBillNo: { not: null }, branchId: branches.b.id },
        }),
        0,
      );
    });
  } finally {
    await cleanup(ctx, world);
  }
});
