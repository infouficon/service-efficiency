import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cleanup, seedWorld, startApi } from './support.mjs';

const APPLE = ['iPhone', 'iPad', 'Mac', 'Watch', 'Accessories'];

test('product categories are a list ADMIN keeps; staff only see products of an active one (D68)', async (t) => {
  const ctx = await startApi(t);
  if (!ctx) return;
  const { db, request } = ctx;
  let world;
  try {
    world = await seedWorld(ctx);
    const { cookies, prefix, branches } = world;
    const list = (who, query = '') =>
      request(`/categories${query}`, 'GET', undefined, cookies[who]);
    const names = async (who, query) =>
      (await list(who, query)).data.map((c) => c.name);

    await t.test(
      'the migration seeds the five Apple categories, in order; only Accessories is accessory-like',
      async () => {
        const all = (await list('admin', '?all=true')).data;
        assert.deepEqual(all.slice(0, 5).map((c) => c.name), APPLE);
        assert.deepEqual(
          all.slice(0, 5).map((c) => c.isAccessory),
          [false, false, false, false, true],
        );
        assert.ok(all.slice(0, 5).every((c) => c.active));
        for (const who of ['staff', 'stock', 'cashier', 'manager', 'admin'])
          assert.equal((await list(who)).status, 200, who);
        assert.equal((await request('/categories', 'GET')).status, 401);
        assert.equal(
          (await list('staff', '?all=true')).data.some((c) => 'productCount' in c),
          false,
          '?all=true is for ADMIN only: staff still get the plain list',
        );
      },
    );

    await t.test(
      'only ADMIN adds a category; it lands at the end; a name is used once, in any case',
      async () => {
        const add = (body, who = 'admin') =>
          request('/categories', 'POST', body, cookies[who]);
        for (const who of ['staff', 'stock', 'cashier', 'manager'])
          assert.equal((await add({ name: `${prefix} Tablet` }, who)).status, 403, who);
        const made = await add({ name: `${prefix} Tablet`, isAccessory: false });
        assert.equal(made.status, 201, JSON.stringify(made.data));
        assert.equal(made.data.active, true);
        assert.equal((await names('staff')).at(-1), `${prefix} Tablet`);
        assert.equal((await add({ name: `${prefix} Tablet` })).status, 409);
        assert.equal((await add({ name: `${prefix.toUpperCase()} TABLET` })).status, 409);
        assert.equal((await add({ name: 'iphone' })).status, 409, 'a built-in name too');
        for (const bad of [{}, { name: '   ' }, { name: 'x'.repeat(101) }, { name: 'ok', extra: 1 }])
          assert.equal((await add(bad)).status, 400, JSON.stringify(bad));
      },
    );

    await t.test(
      'a product can only go into a category that exists; the stored name is the category’s own spelling',
      async () => {
        const make = (body) => request('/products', 'POST', body, cookies.admin);
        const nope = await make({ category: `${prefix} Nowhere`, name: `${prefix} X` });
        assert.equal(nope.status, 400, JSON.stringify(nope.data));
        const ok = await make({ category: 'IPHONE', name: `${prefix} Spelling` });
        assert.equal(ok.status, 201, JSON.stringify(ok.data));
        assert.equal(ok.data.category, 'iPhone');
        const moved = await request(
          `/products/${ok.data.id}`,
          'PUT',
          { category: `${prefix} Nowhere` },
          cookies.admin,
        );
        assert.equal(moved.status, 400);
      },
    );

    await t.test(
      'switching a category off hides its products from staff but not from the back office',
      async () => {
        const category = (
          await list('admin', '?all=true')
        ).data.find((c) => c.name === `${prefix} Tablet`);
        const product = await db.product.create({
          data: {
            category: category.name,
            name: `${prefix} Pad`,
            models: {
              create: {
                name: `${prefix} Pad M`,
                skus: { create: { sku: `${prefix}-PAD`, name: `${prefix} Pad 64`, upc: '0123456789012' } },
              },
            },
          },
          include: { models: { include: { skus: true } } },
        });
        await db.branchInventory.create({
          data: {
            branchId: branches.a.id,
            skuId: product.models[0].skus[0].id,
            stock: 3,
            active: true,
          },
        });
        const seen = async (who) =>
          (await request('/products', 'GET', undefined, cookies[who])).data.some(
            (p) => p.id === product.id,
          );
        assert.equal(await seen('staff'), true);
        assert.equal(
          (await list('admin', '?all=true')).data.find((c) => c.id === category.id).productCount,
          1,
        );
        const off = await request(`/categories/${category.id}`, 'PUT', { active: false }, cookies.admin);
        assert.equal(off.status, 200);
        assert.equal(await seen('staff'), false, 'staff no longer see it');
        assert.equal(await seen('admin'), false, 'an admin without a branch gets the staff view too');
        const admin = (await request('/products?admin=true', 'GET', undefined, cookies.admin)).data;
        const found = admin.find((p) => p.id === product.id);
        assert.ok(found, 'the product list of the back office keeps it');
        assert.equal(found.models[0].skus[0].upc, '0123456789012');
        await request(`/categories/${category.id}`, 'PUT', { active: true }, cookies.admin);
        assert.equal(await seen('staff'), true, 'on again: back for staff');
        assert.equal(
          (await request(`/categories/${category.id}`, 'PUT', { name: 'renamed' }, cookies.admin)).status,
          400,
          'the name is what products store, so it cannot change',
        );
        assert.equal(
          (await request('/categories/not-a-category', 'PUT', { active: true }, cookies.admin)).status,
          404,
        );
      },
    );

    await t.test('the order can be changed, and the accessory flag edited', async () => {
      const all = async () => (await list('admin', '?all=true')).data;
      const before = await all();
      const last = before.at(-1);
      const moved = await request(`/categories/${last.id}/move`, 'POST', { direction: 'up' }, cookies.admin);
      assert.equal(moved.status, 201, JSON.stringify(moved.data));
      const after = await all();
      assert.equal(after.at(-2).id, last.id);
      assert.equal(after.at(-1).id, before.at(-2).id);
      assert.deepEqual(after.map((c) => c.position), after.map((_, i) => i + 1));
      assert.equal(
        (await request(`/categories/${last.id}/move`, 'POST', { direction: 'sideways' }, cookies.admin)).status,
        400,
      );
      const flagged = await request(`/categories/${last.id}`, 'PUT', { isAccessory: true }, cookies.admin);
      assert.equal(flagged.data.isAccessory, true);
    });
  } finally {
    // categories made by the test go last: the products and SKUs of the world are removed first
    if (world)
      await db.category
        .deleteMany({ where: { name: { startsWith: world.prefix } } })
        .catch(() => undefined);
    await cleanup(ctx, world);
  }
});
