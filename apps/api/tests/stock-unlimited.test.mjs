import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cleanup, seedWorld, startApi } from './support.mjs';

test('stock unlimited: one global ADMIN switch, on by default (D59)', async (t) => {
  const ctx = await startApi(t);
  if (!ctx) return;
  const { db, request } = ctx;
  let world;
  try {
    world = await seedWorld(ctx);
    const { cookies, branches, prefix, staffIds } = world;
    const product = await db.product.create({
      data: {
        category: 'iPhone',
        name: `${prefix} Phone`,
        models: {
          create: {
            name: `${prefix} Model`,
            skus: {
              create: {
                sku: `${prefix}-SKU1`,
                name: `${prefix} 128GB`,
                color: 'Black',
                storage: '128GB',
              },
            },
          },
        },
      },
      include: { models: { include: { skus: true } } },
    });
    const sku = product.models[0].skus[0];
    const inventoryKey = {
      branchId_skuId: { branchId: branches.a.id, skuId: sku.id },
    };
    await db.branchInventory.create({
      data: { branchId: branches.a.id, skuId: sku.id, stock: 1, active: true },
    });
    const stockNow = async () =>
      (await db.branchInventory.findUnique({ where: inventoryKey })).stock;
    const setUnlimited = (value, who = 'admin') =>
      request('/settings', 'PUT', { stockUnlimited: value }, cookies[who]);
    const listedSku = async () => {
      const res = await request('/products', 'GET', undefined, cookies.staff);
      assert.equal(res.status, 200);
      return res.data
        .flatMap((p) => p.models.flatMap((m) => m.skus))
        .find((s) => s.sku === sku.sku);
    };
    const step = (id, action, who) =>
      request(`/sessions/${id}/step`, 'POST', { action }, cookies[who]);
    /** A session taken to FOUND for `sku` (STAFF does the front, STOCK the search). */
    const toFound = async (phone) => {
      const created = await request(
        '/sessions',
        'POST',
        { phone },
        cookies.staff,
      );
      assert.equal(created.status, 201, JSON.stringify(created.data));
      const id = created.data.id;
      for (const action of ['startDemo', 'endDemo', 'buy', 'startSelection'])
        assert.equal((await step(id, action, 'staff')).status, 201, action);
      const chosen = await request(
        `/sessions/${id}/selection`,
        'PUT',
        { skuId: sku.id, payments: ['Cash'] },
        cookies.staff,
      );
      assert.equal(chosen.status, 200, JSON.stringify(chosen.data));
      const confirmed = await request(
        `/sessions/${id}/confirm`,
        'POST',
        undefined,
        cookies.staff,
      );
      assert.equal(confirmed.status, 201, JSON.stringify(confirmed.data));
      assert.equal((await step(id, 'search', 'stock')).status, 201);
      const found = await step(id, 'found', 'stock');
      assert.equal(found.status, 201, JSON.stringify(found.data));
      return found.data;
    };
    const foundEvent = (session) =>
      session.events.filter((e) => e.eventType === 'STOCK_FOUND').at(-1);
    const cancel = (id, who = 'stock') =>
      request(
        `/sessions/${id}/cancel`,
        'POST',
        { reason: 'ลูกค้าเปลี่ยนใจ' },
        cookies[who],
      );

    await t.test(
      'the switch is on by default and everybody can read it',
      async () => {
        for (const who of ['staff', 'stock', 'cashier', 'manager', 'admin']) {
          const res = await request(
            '/settings',
            'GET',
            undefined,
            cookies[who],
          );
          assert.equal(res.status, 200);
          assert.equal(res.data.stockUnlimited, true, who);
        }
        assert.equal((await request('/settings', 'GET')).status, 401);
        const adminView = await request(
          '/settings',
          'GET',
          undefined,
          cookies.admin,
        );
        assert.equal(
          adminView.data.updatedBy ?? null,
          null,
          'never changed yet',
        );
      },
    );

    await t.test('only ADMIN switches it, with a real boolean', async () => {
      for (const who of ['staff', 'stock', 'cashier', 'manager'])
        assert.equal((await setUnlimited(false, who)).status, 403, who);
      assert.equal(
        (await request('/settings', 'PUT', {}, cookies.admin)).status,
        400,
      );
      assert.equal(
        (
          await request(
            '/settings',
            'PUT',
            { stockUnlimited: 'no' },
            cookies.admin,
          )
        ).status,
        400,
      );
      assert.equal(
        (
          await request(
            '/settings',
            'PUT',
            { stockUnlimited: false, other: 1 },
            cookies.admin,
          )
        ).status,
        400,
      );
      const off = await setUnlimited(false);
      assert.equal(off.status, 200, JSON.stringify(off.data));
      assert.equal(off.data.stockUnlimited, false);
      assert.equal(off.data.updatedBy, staffIds.admin);
      assert.ok(off.data.updatedAt);
      assert.equal(
        (await request('/settings', 'GET', undefined, cookies.staff)).data
          .stockUnlimited,
        false,
      );
      assert.equal(
        'updatedBy' in
          (await request('/settings', 'GET', undefined, cookies.staff)).data,
        false,
        'who changed it is for ADMIN only',
      );
      assert.equal((await setUnlimited(true)).data.stockUnlimited, true);
    });

    await t.test(
      'the branch product list says where each stock figure comes from',
      async () => {
        await setUnlimited(true);
        let row = await listedSku();
        assert.equal(row.stockSource, 'unlimited');
        assert.equal(row.stock, 1, 'the real number is still there');
        await setUnlimited(false);
        row = await listedSku();
        assert.equal(row.stockSource, 'manual');
        assert.equal(row.stock, 1);
      },
    );

    await t.test(
      'on: FOUND takes nothing from the shelf and a cancel gives nothing back',
      async () => {
        await setUnlimited(true);
        const found = await toFound('0999900101');
        assert.equal(await stockNow(), 1, 'no deduction while unlimited');
        assert.equal(foundEvent(found).metadata.deducted, 0);
        const cancelled = await cancel(found.id);
        assert.equal(cancelled.status, 201, JSON.stringify(cancelled.data));
        assert.equal(cancelled.data.outcome, 'CUSTOMER_CANCELLED');
        assert.equal(await stockNow(), 1);
      },
    );

    await t.test(
      'off: FOUND deducts one unit and a cancel gives it back (D41)',
      async () => {
        await setUnlimited(false);
        const found = await toFound('0999900102');
        assert.equal(await stockNow(), 0);
        assert.equal(foundEvent(found).metadata.deducted, 1);
        assert.equal((await cancel(found.id)).status, 201);
        assert.equal(await stockNow(), 1);
      },
    );

    await t.test(
      'the cancel follows what FOUND actually did, not the switch at that moment',
      async () => {
        // FOUND while OFF (unit taken), switch ON, cancel: the unit still goes back
        await setUnlimited(false);
        const first = await toFound('0999900103');
        assert.equal(await stockNow(), 0);
        await setUnlimited(true);
        assert.equal((await cancel(first.id)).status, 201);
        assert.equal(
          await stockNow(),
          1,
          'restored although unlimited is on now',
        );
        // FOUND while ON (nothing taken), switch OFF, cancel: nothing may be added
        const second = await toFound('0999900104');
        assert.equal(await stockNow(), 1);
        await setUnlimited(false);
        assert.equal((await cancel(second.id)).status, 201);
        assert.equal(await stockNow(), 1, 'no unit invented');
      },
    );

    await t.test(
      'a session that reached FOUND before this change (no record of a deduction) still gives its unit back',
      async () => {
        await setUnlimited(false);
        const found = await toFound('0999900105');
        assert.equal(await stockNow(), 0);
        // make it look like an old STOCK_FOUND event: no `deducted` in the metadata
        await db.sessionEvent.updateMany({
          where: { sessionId: found.id, eventType: 'STOCK_FOUND' },
          data: { metadata: {} },
        });
        assert.equal((await cancel(found.id)).status, 201);
        assert.equal(await stockNow(), 1);
      },
    );
  } finally {
    await cleanup(ctx, world);
  }
});
