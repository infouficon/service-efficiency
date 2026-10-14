import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cleanup, seedWorld, startApi } from './support.mjs';

const RESET = '/admin/warroom-sync/reset-catalog';

test('"delete what is not from the ERP" keeps ERP products, customers and their queues (D78)', async (t) => {
  const ctx = await startApi(t);
  if (!ctx) return;
  const { db, request } = ctx;
  let world;
  try {
    world = await seedWorld(ctx);
    const { cookies, branches, staffIds, prefix } = world;
    const make = (suffix, erpManaged) =>
      db.product.create({
        data: {
          category: 'iPhone',
          name: `${prefix} ${suffix}`,
          erpManaged,
          models: {
            create: {
              name: `${prefix} ${suffix} M`,
              erpManaged,
              skus: {
                create: {
                  sku: `${prefix}-${suffix}`,
                  name: `${prefix} ${suffix} 128GB`,
                  erpManaged,
                },
              },
            },
          },
        },
        include: { models: { include: { skus: true } } },
      });
    const hand = await make('HAND', false);
    const erp = await make('ERP', true);
    // a hand-made product that holds an ERP SKU too (the sync reuses hand-made products): it must stay
    const mixed = await db.product.create({
      data: {
        category: 'iPhone',
        name: `${prefix} MIXED`,
        erpManaged: false,
        models: {
          create: {
            name: `${prefix} MIXED M`,
            erpManaged: false,
            skus: {
              create: [
                { sku: `${prefix}-MIXED-HAND`, name: 'hand', erpManaged: false },
                { sku: `${prefix}-MIXED-ERP`, name: 'erp', erpManaged: true },
              ],
            },
          },
        },
      },
      include: { models: { include: { skus: true } } },
    });
    const handSku = hand.models[0].skus[0];
    const erpSku = erp.models[0].skus[0];
    for (const sku of [handSku, erpSku])
      await db.branchInventory.create({
        data: { branchId: branches.a.id, skuId: sku.id, stock: 3, active: true },
      });
    const customer = await db.customer.create({ data: { phone: '0999900777' } });
    const session = (suffix, skuId) =>
      db.customerSession.create({
        data: {
          reference: `${prefix}-${suffix}`.slice(0, 32),
          branchId: branches.a.id,
          staffId: staffIds.staff,
          customerId: customer.id,
          state: 'FOUND',
          items: { create: { skuId, quantity: 1 } },
        },
      });
    const onHand = await session('onhand', handSku.id);
    const onErp = await session('onerp', erpSku.id);
    const post = (query, body, who = 'admin') =>
      request(`${RESET}${query}`, 'POST', body, cookies[who]);

    await t.test('only ADMIN; scope must be all or non-erp', async () => {
      assert.equal((await post('?scope=non-erp&dryRun=true', undefined, 'staff')).status, 403);
      assert.equal((await post('?scope=nothing&dryRun=true')).status, 400);
    });

    await t.test('a dry run counts, and removes nothing', async () => {
      const res = await post('?scope=non-erp&dryRun=true');
      assert.equal(res.status, 201, JSON.stringify(res.data));
      assert.equal(res.data.scope, 'non-erp');
      const c = res.data.counts;
      assert.ok(c.skus >= 2 && c.products >= 1 && c.sessions >= 1 && c.inventoryRows >= 1);
      assert.equal(c.customers, 0, 'customers are never removed in this scope');
      assert.equal(await db.productSku.count({ where: { id: handSku.id } }), 1);
    });

    await t.test('a real run needs the typed confirmation', async () => {
      assert.equal((await post('?scope=non-erp', {})).status, 400);
      assert.equal(await db.productSku.count({ where: { id: handSku.id } }), 1);
    });

    await t.test('it removes the hand-made SKUs and the queues that used them, and keeps the ERP side', async () => {
      const res = await post('?scope=non-erp', { confirm: 'ล้างข้อมูล' });
      assert.equal(res.status, 201, JSON.stringify(res.data));
      assert.equal(await db.productSku.count({ where: { id: handSku.id } }), 0);
      assert.equal(await db.product.count({ where: { id: hand.id } }), 0, 'the emptied hand-made product goes');
      assert.equal(await db.branchInventory.count({ where: { skuId: handSku.id } }), 0);
      assert.equal(await db.customerSession.count({ where: { id: onHand.id } }), 0);
      // the ERP product, its SKU, stock and queue stay
      assert.equal(await db.productSku.count({ where: { id: erpSku.id } }), 1);
      assert.equal(await db.product.count({ where: { id: erp.id } }), 1);
      assert.equal(await db.branchInventory.count({ where: { skuId: erpSku.id } }), 1);
      assert.equal(await db.customerSession.count({ where: { id: onErp.id } }), 1);
      assert.equal(await db.customer.count({ where: { id: customer.id } }), 1);
      // a hand-made product that still holds an ERP SKU stays, with only the ERP SKU
      const keptSkus = await db.productSku.findMany({ where: { modelId: mixed.models[0].id } });
      assert.deepEqual(keptSkus.map((s) => s.sku), [`${prefix}-MIXED-ERP`]);
      assert.equal(await db.product.count({ where: { id: mixed.id } }), 1);
      const trace = await db.erpSyncRun.findFirst({
        where: { kind: 'catalog-reset' },
        orderBy: { startedAt: 'desc' },
      });
      assert.equal(trace.summary.scope, 'non-erp');
      // nothing left to do
      const again = await post('?scope=non-erp&dryRun=true');
      assert.equal(await db.productSku.count({ where: { erpManaged: false } }), 0);
      assert.equal(again.data.counts.skus, 0);
    });
  } finally {
    await db.erpSyncRun.deleteMany({ where: { kind: 'catalog-reset' } }).catch(() => undefined);
    await cleanup(ctx, world);
  }
});
