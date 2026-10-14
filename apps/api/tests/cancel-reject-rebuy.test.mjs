import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PATH, cleanup, seedCatalog, seedWorld, startApi } from './support.mjs';

test('any role cancels, stock is told, the cashier can send an order back, a change reason can be bought again (F11, F12, F13)', async (t) => {
  const ctx = await startApi(t);
  if (!ctx) return;
  const { db, request } = ctx;
  let world;
  try {
    world = await seedWorld(ctx);
    const { cookies, branches } = world;
    const [skuA, skuB] = await seedCatalog(ctx, world, 2, 5);
    const stockOf = async (sku) =>
      (
        await db.branchInventory.findUnique({
          where: { branchId_skuId: { branchId: branches.a.id, skuId: sku.id } },
        })
      ).stock;
    const call = (path, method, body, who) =>
      request(path, method, body, cookies[who]);
    await call('/settings', 'PUT', { stockUnlimited: false }, 'admin');
    let phoneNo = 300;

    /** A session driven along the happy path up to and including `lastAction` (e.g. 'found'). */
    const driveTo = async (lastAction, { who = 'staff', type } = {}) => {
      const created = await call(
        '/sessions',
        'POST',
        {
          phone: `09999003${String(phoneNo++).slice(-2)}`,
          ...(type ? { customerTypeId: type } : {}),
        },
        who,
      );
      assert.equal(created.status, 201, JSON.stringify(created.data));
      const id = created.data.id;
      if (lastAction === 'walkIn' || lastAction === 'startSelection') return created.data;
      for (const [action, role] of PATH) {
        if (action === 'confirm') {
          const put = await call(
            `/sessions/${id}/selection`,
            'PUT',
            {
              items: [
                { skuId: skuA.id, quantity: 2 },
                { skuId: skuB.id, quantity: 1 },
              ],
              accessories: [{ accessoryName: 'Case', quantity: 1 }],
              payments: ['Cash', 'Transfer'],
              ontop: ['AIS'],
              points: ['MCard'],
            },
            'staff',
          );
          assert.equal(put.status, 200, JSON.stringify(put.data));
          const confirmed = await call(
            `/sessions/${id}/confirm`,
            'POST',
            undefined,
            'staff',
          );
          assert.equal(confirmed.status, 201, JSON.stringify(confirmed.data));
        } else {
          const res = await call(
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
      return (await call(`/sessions/${id}`, 'GET', undefined, 'staff')).data;
    };
    const cancel = (id, who, reason = 'ลูกค้าเปลี่ยนใจ', otherReason) =>
      call(`/sessions/${id}/cancel`, 'POST', { reason, otherReason }, who);

    await t.test(
      'every role of the branch can cancel at every stage (F12)',
      async () => {
        const stages = [
          'walkIn',
          'confirm',
          'search',
          'found',
          'send',
          'receive',
          'scan',
          'bill',
        ];
        const roles = ['staff', 'stock', 'cashier', 'manager', 'admin'];
        let n = 0;
        for (const stage of stages) {
          const who = roles[n++ % roles.length];
          const session = await driveTo(stage);
          const res = await cancel(session.id, who);
          assert.equal(
            res.status,
            201,
            `${who} at ${stage}: ${JSON.stringify(res.data)}`,
          );
          assert.equal(res.data.outcome, 'CUSTOMER_CANCELLED');
          assert.equal(res.data.cancelledBy, world.staffIds[who]);
        }
        // a brand-new walk-in can be cancelled by a cashier-only account too
        const fresh = await driveTo('walkIn');
        assert.equal((await cancel(fresh.id, 'cashier')).status, 201);
        assert.equal(
          await stockOf(skuA),
          5,
          'every unit taken at FOUND went back',
        );
        assert.equal(await stockOf(skuB), 5);
      },
    );

    await t.test(
      'a reason is required, a finished session cannot be cancelled, another branch cannot',
      async () => {
        const session = await driveTo('walkIn');
        assert.equal(
          (await call(`/sessions/${session.id}/cancel`, 'POST', {}, 'staff'))
            .status,
          400,
        );
        assert.equal(
          (await cancel(session.id, 'staff', 'อื่น ๆ', '  ')).status,
          400,
        );
        assert.equal(
          (await cancel(session.id, 'staffB')).status,
          403,
          'outside the branch',
        );
        assert.equal(
          (await cancel(session.id, 'staff', 'อื่น ๆ', 'ลูกค้าต้องไปก่อน'))
            .status,
          201,
        );
        assert.equal(
          (await cancel(session.id, 'stock')).status,
          400,
          'already ended',
        );
        const done = await driveTo('complete');
        assert.equal(done.state, 'COMPLETED');
        assert.equal(
          (await cancel(done.id, 'admin')).status,
          400,
          'a completed session is final',
        );
        await db.branchInventory.updateMany({
          where: { branchId: branches.a.id, skuId: { in: [skuA.id, skuB.id] } },
          data: { stock: 5 },
        });
      },
    );

    await t.test(
      'stock is told about a cancel after the request, until it says the goods are back (F12)',
      async () => {
        const found = await driveTo('found');
        const cancelled = await cancel(found.id, 'cashier');
        assert.equal(
          cancelled.data.stockAckAt,
          null,
          'the goods were picked: stock must act',
        );
        assert.equal(await stockOf(skuA), 5);
        const ack = (id, who) =>
          call(
            `/sessions/${id}/stock/acknowledge-cancel`,
            'POST',
            undefined,
            who,
          );
        assert.equal(
          (await ack(found.id, 'staff')).status,
          403,
          'only stock, a manager or an admin',
        );
        assert.equal((await ack(found.id, 'cashier')).status, 403);
        const acked = await ack(found.id, 'stock');
        assert.equal(acked.status, 201, JSON.stringify(acked.data));
        assert.equal(acked.data.stockAckBy, world.staffIds.stock);
        assert.ok(acked.data.stockAckAt);
        assert.ok(
          acked.data.events.some(
            (e) => e.eventType === 'STOCK_ACKNOWLEDGED_CANCEL',
          ),
        );
        assert.equal((await ack(found.id, 'stock')).status, 400, 'only once');

        // a cancel before the stock request has nothing to tell stock
        const early = await driveTo('startSelection');
        await cancel(early.id, 'staff');
        assert.equal((await ack(early.id, 'stock')).status, 400);

        // cancelled by a STOCK user before anything was picked: stock already knows
        const searching = await driveTo('search');
        const bySelf = await cancel(searching.id, 'stock');
        assert.equal(bySelf.data.stockAckBy, world.staffIds.stock);
        assert.ok(bySelf.data.stockAckAt);
        // cancelled by someone else while stock is searching: stock is told
        const searching2 = await driveTo('search');
        const byStaff = await cancel(searching2.id, 'staff');
        assert.equal(byStaff.data.stockAckAt, null);
        assert.equal(
          (await ack(searching2.id, 'manager')).status,
          201,
          'a manager of the branch may acknowledge',
        );
        assert.equal((await ack(searching2.id, 'stock')).status, 400);
        const other = await driveTo('found');
        await cancel(other.id, 'staff');
        assert.equal(
          (
            await call(
              `/sessions/${other.id}/stock/acknowledge-cancel`,
              'POST',
              undefined,
              'staffB',
            )
          ).status,
          403,
          'another branch',
        );
      },
    );

    await t.test(
      'the cashier sends an order back to stock: units released, the stage restarts, history kept (F13)',
      async () => {
        for (const stage of ['send', 'receive', 'scan']) {
          const session = await driveTo(stage);
          assert.equal(await stockOf(skuA), 3, 'FOUND took 2 of A');
          const reject = (body, who = 'cashier') =>
            call(`/sessions/${session.id}/cashier/reject`, 'POST', body, who);
          assert.equal(
            (await reject({ reason: 'หยิบสินค้าผิด' }, 'staff')).status,
            403,
            'only the cashier',
          );
          assert.equal((await reject({})).status, 400, 'a reason is required');
          assert.equal(
            (await reject({ reason: 'อื่น ๆ', otherReason: ' ' })).status,
            400,
          );
          const res = await reject({ reason: 'หยิบสินค้าผิด' });
          assert.equal(
            res.status,
            201,
            `${stage}: ${JSON.stringify(res.data)}`,
          );
          assert.equal(res.data.state, 'SEARCHING');
          assert.equal(res.data.outcome, null);
          assert.equal(res.data.confirmed, true);
          assert.equal(
            res.data.stockFoundAt,
            null,
            'the current pass starts again',
          );
          assert.equal(res.data.cashierReceivedAt, null);
          assert.equal(res.data.cashierScanAt, null);
          assert.deepEqual(
            res.data.items.map((i) => i.deducted),
            [0, 0],
          );
          assert.equal(
            await stockOf(skuA),
            5,
            'the units went back to the shelf',
          );
          assert.equal(await stockOf(skuB), 5);
          const event = res.data.events
            .filter((e) => e.eventType === 'CASHIER_REJECTED')
            .at(-1);
          assert.equal(event.metadata.reason, 'หยิบสินค้าผิด');
          assert.equal(
            event.metadata.fromState,
            {
              send: 'SENT_TO_CASHIER',
              receive: 'CASHIER_RECEIVED',
              scan: 'CASHIER_SCAN',
            }[stage],
          );
          // stock finds again, and the order goes through
          const again = await call(
            `/sessions/${session.id}/step`,
            'POST',
            { action: 'found' },
            'stock',
          );
          assert.equal(again.status, 201, JSON.stringify(again.data));
          assert.equal(await stockOf(skuA), 3, 'taken again');
          for (const action of ['send'])
            await call(
              `/sessions/${session.id}/step`,
              'POST',
              { action },
              'stock',
            );
          for (const action of ['receive', 'scan', 'bill', 'complete']) {
            const s = await call(
              `/sessions/${session.id}/step`,
              'POST',
              { action },
              'cashier',
            );
            assert.equal(s.status, 201, `${action}: ${JSON.stringify(s.data)}`);
          }
          // the history shows both rounds
          const full = (
            await call(`/sessions/${session.id}`, 'GET', undefined, 'staff')
          ).data;
          assert.equal(full.state, 'COMPLETED');
          assert.equal(
            full.events.filter((e) => e.eventType === 'STOCK_FOUND').length,
            2,
          );
          await db.branchInventory.updateMany({
            where: {
              branchId: branches.a.id,
              skuId: { in: [skuA.id, skuB.id] },
            },
            data: { stock: 5 },
          });
        }
        const atFound = await driveTo('found');
        const notYet = await call(
          `/sessions/${atFound.id}/cashier/reject`,
          'POST',
          { reason: 'หยิบสินค้าผิด' },
          'cashier',
        );
        assert.equal(
          notYet.status,
          400,
          'the cashier has not received it yet (FOUND)',
        );
        const billed = await driveTo('bill');
        const late = await call(
          `/sessions/${billed.id}/cashier/reject`,
          'POST',
          { reason: 'หยิบสินค้าผิด' },
          'cashier',
        );
        assert.equal(late.status, 400, 'the bill is open: too late');
        await cancel(atFound.id, 'stock');
        await cancel(billed.id, 'cashier');
      },
    );

    await t.test(
      'a change reason can be bought again: same queue number, the old data, a new session (F11)',
      async () => {
        const typeB = (
          await call('/customer-types', 'GET', undefined, 'staff')
        ).data.find((x) => x.letter === 'B');
        const old = await driveTo('found', { type: typeB.id });
        const cancelled = await cancel(old.id, 'cashier', 'เปลี่ยนสี');
        assert.equal(cancelled.status, 201, JSON.stringify(cancelled.data));
        assert.equal(await stockOf(skuA), 5, 'the cancel put the units back');
        const rebuy = (id, who = 'staff') =>
          call(`/sessions/${id}/rebuy`, 'POST', undefined, who);
        assert.equal(
          (await rebuy(old.id, 'cashier')).status,
          403,
          'a new purchase is a STAFF job',
        );
        assert.equal(
          (await rebuy(old.id, 'staffB')).status,
          403,
          'another branch',
        );
        const next = await rebuy(old.id);
        assert.equal(next.status, 201, JSON.stringify(next.data));
        const s = next.data;
        assert.notEqual(s.id, old.id);
        assert.equal(s.queueLetter, 'B');
        assert.equal(s.queueNo, old.queueNo, 'the old queue number');
        assert.equal(s.customerTypeId, typeB.id);
        assert.equal(s.phone, old.phone);
        assert.equal(s.customerId, old.customerId);
        assert.equal(s.state, 'PRODUCT_SELECTION');
        assert.equal(s.confirmed, false);
        assert.equal(s.outcome, null);
        assert.ok(s.decisionAt, 'the customer already decided to buy');
        assert.ok(s.productSelectionStartAt);
        assert.equal(s.rebuyOf.id, old.id);
        assert.equal(s.staffId, world.staffIds.staff);
        assert.deepEqual(
          s.items.map((i) => [i.skuId, i.quantity, i.deducted]).sort(),
          [
            [skuA.id, 2, 0],
            [skuB.id, 1, 0],
          ].sort(),
        );
        assert.deepEqual(
          s.accessories.map((a) => [a.accessoryName, a.quantity]),
          [['Case', 1]],
        );
        assert.deepEqual(s.payments.map((p) => p.method).sort(), [
          'Cash',
          'Transfer',
        ]);
        assert.deepEqual(
          s.ontop.map((o) => o.name),
          ['AIS'],
        );
        assert.deepEqual(
          s.points.map((o) => o.name),
          ['MCard'],
        );
        assert.deepEqual(
          s.events.map((e) => e.eventType),
          ['SESSION_CREATED', 'PRODUCT_SELECTION_STARTED'],
        );
        assert.equal(s.events[0].metadata.rebuyOf, old.reference);
        const oldAfter = (
          await call(`/sessions/${old.id}`, 'GET', undefined, 'staff')
        ).data;
        assert.equal(oldAfter.rebuiltAs.id, s.id);
        assert.equal(
          (await rebuy(old.id)).status,
          409,
          'once per cancelled session',
        );
        // the queue counter did not move: walk-in has no queue yet (D70)
        const walkIn = await call(
          '/sessions',
          'POST',
          { phone: '0999900399' },
          'staff',
        );
        assert.equal(walkIn.data.queueNo, null);
        // the new session goes on like any other
        assert.equal(
          (await call(`/sessions/${s.id}/confirm`, 'POST', undefined, 'staff'))
            .status,
          201,
        );
        assert.equal(
          (
            await call(
              `/sessions/${s.id}/step`,
              'POST',
              { action: 'search' },
              'stock',
            )
          ).status,
          201,
        );
        // and can itself be changed again
        assert.equal(
          (await cancel(s.id, 'staff', 'พนักงานเลือกสินค้าผิดพลาด')).status,
          201,
        );
        assert.equal((await rebuy(s.id)).status, 201);
      },
    );

    await t.test(
      'only a cancel with a change reason can be bought again',
      async () => {
        for (const reason of ['รอนาน', 'ลูกค้าเปลี่ยนใจ']) {
          const session = await driveTo('startSelection');
          await cancel(session.id, 'staff', reason);
          assert.equal(
            (
              await call(
                `/sessions/${session.id}/rebuy`,
                'POST',
                undefined,
                'staff',
              )
            ).status,
            400,
            reason,
          );
        }
        const running = await driveTo('startSelection');
        assert.equal(
          (
            await call(
              `/sessions/${running.id}/rebuy`,
              'POST',
              undefined,
              'staff',
            )
          ).status,
          400,
          'not cancelled',
        );
        for (const reason of [
          'เปลี่ยนรุ่น',
          'เปลี่ยนสี',
          'เปลี่ยนความจุ',
          'พนักงานเลือกสินค้าผิดพลาด',
        ]) {
          const session = await driveTo('startSelection');
          await cancel(session.id, 'staff', reason);
          assert.equal(
            (
              await call(
                `/sessions/${session.id}/rebuy`,
                'POST',
                undefined,
                'staff',
              )
            ).status,
            201,
            reason,
          );
        }
      },
    );
  } finally {
    await cleanup(ctx, world);
  }
});
