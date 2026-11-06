import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cleanup, seedCatalog, seedWorld, startApi } from './support.mjs';

test('ADMIN pins a model to the top of the staff list; the staff catalog carries pinnedAt and the UPC (D109)', async (t) => {
  const ctx = await startApi(t);
  if (!ctx) return;
  const { db, request } = ctx;
  let world;
  try {
    world = await seedWorld(ctx);
    const { cookies, prefix } = world;
    const [sku] = await seedCatalog(ctx, world, 1, 3);
    await db.productSku.update({ where: { id: sku.id }, data: { upc: '195951406091' } });
    const modelId = sku.modelId;

    assert.equal((await request(`/products/models/${modelId}`, 'PUT', { pinned: true }, cookies.staff)).status, 403);

    const pinned = await request(`/products/models/${modelId}`, 'PUT', { pinned: true }, cookies.admin);
    assert.equal(pinned.status, 200, JSON.stringify(pinned.data));
    assert.ok(pinned.data.pinnedAt, 'pinning stamps the time');

    const mine = async () => {
      const res = await request('/products', 'GET', undefined, cookies.staff);
      assert.equal(res.status, 200);
      const product = res.data.find((p) => p.name === `${prefix} Phone`);
      return product.models[0];
    };
    const model = await mine();
    assert.ok(model.pinnedAt);
    assert.equal(model.skus[0].upc, '195951406091');

    const unpinned = await request(`/products/models/${modelId}`, 'PUT', { pinned: false }, cookies.admin);
    assert.equal(unpinned.data.pinnedAt, null);
    assert.equal((await mine()).pinnedAt, null);
    assert.equal((await request(`/products/models/${modelId}`, 'PUT', { pinned: 'yes' }, cookies.admin)).status, 400);
  } finally {
    await cleanup(ctx, world);
  }
});
