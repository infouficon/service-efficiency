import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cleanup, seedCatalog, seedWorld, startApi } from './support.mjs';

const RESET = '/admin/warroom-sync/reset-catalog';

test('clearing the old catalog and queue history is counted first and needs a typed confirmation (D72)', async (t) => {
  const ctx = await startApi(t);
  if (!ctx) return;
  const { db, request } = ctx;
  let world;
  try {
    world = await seedWorld(ctx);
    const { cookies, branches, staffIds } = world;
    const skus = await seedCatalog(ctx, world, 2, 5);
    const customer = await db.customer.create({ data: { phone: '0999900421' } });
    await db.customerSession.create({
      data: {
        reference: `${world.prefix}-reset`.slice(0, 32),
        branchId: branches.a.id,
        staffId: staffIds.staff,
        customerId: customer.id,
        state: 'FOUND',
        items: { create: { skuId: skus[0].id, quantity: 1 } },
        events: { create: { eventType: 'STOCK_FOUND', actorStaffId: staffIds.staff } },
      },
    });
    await db.dailyCounter.create({
      data: { scope: `queue:${branches.a.id}:A`, day: '2026-10-14', lastNo: 3 },
    });
    const post = (query, body, who = 'admin') =>
      request(`${RESET}${query}`, 'POST', body, cookies[who]);
    const left = async () => ({
      sessions: await db.customerSession.count(),
      customers: await db.customer.count(),
      counters: await db.dailyCounter.count(),
      products: await db.product.count(),
      skus: await db.productSku.count(),
      inventory: await db.branchInventory.count(),
    });

    await t.test('only ADMIN; flags must be exactly true/false', async () => {
      for (const who of ['staff', 'stock', 'cashier', 'manager'])
        assert.equal((await post('?dryRun=true', undefined, who)).status, 403, who);
      assert.equal((await post('?dryRun=1')).status, 400);
    });

    await t.test('a dry run counts what would go and removes nothing', async () => {
      const before = await left();
      const res = await post('?dryRun=true');
      assert.equal(res.status, 201, JSON.stringify(res.data));
      assert.equal(res.data.dryRun, true);
      const c = res.data.counts;
      assert.ok(c.sessions >= 1 && c.customers >= 1 && c.skus >= 2 && c.inventoryRows >= 2);
      assert.ok(c.products >= 1 && c.models >= 1);
      assert.deepEqual(await left(), before);
    });

    await t.test('a real run without the exact confirmation is refused and removes nothing', async () => {
      const before = await left();
      assert.equal((await post('', undefined)).status, 400);
      assert.equal((await post('', {})).status, 400);
      assert.equal((await post('', { confirm: 'yes' })).status, 400);
      assert.deepEqual(await left(), before);
    });

    await t.test('with the confirmation it clears sessions, customers, counters and the whole catalog, and keeps the rest', async () => {
      const res = await post('', { confirm: 'ล้างข้อมูล' });
      assert.equal(res.status, 201, JSON.stringify(res.data));
      assert.equal(res.data.dryRun, false);
      assert.deepEqual(await left(), {
        sessions: 0,
        customers: 0,
        counters: 0,
        products: 0,
        skus: 0,
        inventory: 0,
      });
      assert.equal(await db.productModel.count(), 0);
      assert.equal(await db.sessionItem.count(), 0);
      assert.equal(await db.sessionEvent.count(), 0);
      // what is not catalog or queue history stays
      assert.equal(await db.branch.count({ where: { id: branches.a.id } }), 1);
      assert.equal(await db.staff.count({ where: { staffId: staffIds.staff } }), 1);
      assert.ok((await db.category.count()) >= 5);
      assert.ok((await db.paymentMethod.count()) >= 11);
      const trace = await db.erpSyncRun.findFirst({
        where: { kind: 'catalog-reset' },
        orderBy: { startedAt: 'desc' },
      });
      assert.equal(trace.actorStaffId, staffIds.admin);
      assert.equal(trace.ok, true);
      assert.ok(trace.summary.sessions >= 1);
      // a second look finds nothing left
      const again = await post('?dryRun=true');
      assert.equal(again.data.counts.products, 0);
    });

    await t.test('an empty catalog stays empty after a restart (no demo products come back)', async () => {
      const second = await startApi(t);
      if (!second) return;
      try {
        assert.equal(await second.db.product.count(), 0);
        const list = await second.request('/products?admin=true', 'GET', undefined, cookies.admin);
        assert.equal(list.status, 200);
        assert.deepEqual(list.data, []);
      } finally {
        await second.stop();
      }
    });
  } finally {
    await db.erpSyncRun.deleteMany({ where: { kind: 'catalog-reset' } }).catch(() => undefined);
    await cleanup(ctx, world);
  }
});
