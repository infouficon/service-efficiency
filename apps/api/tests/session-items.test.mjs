import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cleanup, seedWorld, startApi } from './support.mjs';

const { availableUnits } = await import('../dist/products/products.service.js');
const { SessionsService } = await import('../dist/sessions/sessions.service.js');

test('availability counts the quantity of every promised item (F3)', () => {
  const inv = {
    branchId: 'b',
    skuId: 's',
    erpReady: 5,
    erpAsOf: new Date('2026-10-13T05:00:00Z'),
    outOfStockAt: null,
  };
  const map = (list) => new Map([['b\u0000s', list]]);
  const held = (quantity, completedAt = null) => ({
    branchId: 'b',
    skuId: 's',
    completedAt,
    quantity,
  });
  assert.equal(availableUnits(inv, map([held(2)])), 3);
  assert.equal(availableUnits(inv, map([held(2), held(1)])), 2);
  assert.equal(availableUnits(inv, map([held(9)])), 0, 'never negative');
  assert.equal(
    availableUnits(inv, map([held(2, new Date('2026-10-13T04:00:00Z'))])),
    5,
    'completed before the snapshot: the ERP already sold it',
  );
  // a reservation written without a quantity (older tests, old rows) is one unit
  assert.equal(
    availableUnits(
      inv,
      map([{ branchId: 'b', skuId: 's', completedAt: null }]),
    ),
    4,
  );
});

test('changeItem keeps STOCK_REQUESTED when in STOCK_REQUESTED, and resets to SEARCHING when in FOUND or later (D82)', async () => {
  const makeFixture = (initialState) => {
    let updatedSessionData = null;
    let updatedItemData = null;
    let returnedShelfStock = 0;

    const sessionRow = {
      id: 'sess-1',
      reference: 'SES-20261016-000001',
      branchId: 'branch-1',
      state: initialState,
      outcome: null,
      items: [
        {
          id: 'item-1',
          skuId: 'sku-old',
          quantity: 1,
          deducted: initialState === 'FOUND' ? 1 : 0,
          sku: {
            id: 'sku-old',
            sku: 'IPHONE-16-128-BLK',
            storage: '128GB',
            color: 'Black',
            model: {
              name: 'iPhone 16',
              product: { name: 'iPhone' },
            },
          },
        },
      ],
    };

    const newSkuRow = {
      id: 'sku-new',
      sku: 'IPHONE-16-256-WHT',
      storage: '256GB',
      color: 'White',
      active: true,
      model: {
        name: 'iPhone 16',
        product: { name: 'iPhone' },
      },
    };

    const tx = {
      branchInventory: {
        updateMany: async ({ data }) => {
          returnedShelfStock += data.stock?.increment ?? 0;
        },
      },
      sessionItem: {
        update: async ({ data }) => {
          updatedItemData = data;
        },
      },
      customerSession: {
        update: async ({ data }) => {
          updatedSessionData = data;
          return { ...sessionRow, ...data };
        },
      },
    };

    const prisma = {
      customerSession: {
        findFirst: async () => sessionRow,
      },
      productSku: {
        findFirst: async () => newSkuRow,
      },
      $transaction: async (fn) => fn(tx),
    };

    const svc = new SessionsService(prisma, {}, {});
    return {
      svc,
      getUpdatedSessionData: () => updatedSessionData,
      getUpdatedItemData: () => updatedItemData,
      getReturnedShelfStock: () => returnedShelfStock,
    };
  };

  const staffUser = {
    staffId: 'staff-1',
    branchId: 'branch-1',
    roles: ['STAFF'],
  };

  // Case 1: In STOCK_REQUESTED -> stays STOCK_REQUESTED
  const reqCase = makeFixture('STOCK_REQUESTED');
  await reqCase.svc.changeItem(staffUser, 'sess-1', {
    oldItemId: 'item-1',
    newSkuId: 'sku-new',
    reason: 'ลูกค้าเปลี่ยนใจ (ความจุ/สี/รุ่น)',
  });
  assert.equal(reqCase.getUpdatedSessionData().state, 'STOCK_REQUESTED');
  assert.equal(reqCase.getUpdatedItemData().skuId, 'sku-new');
  assert.equal(reqCase.getReturnedShelfStock(), 0);
  assert.equal(
    reqCase.getUpdatedSessionData().events.create.metadata.fromState,
    'STOCK_REQUESTED',
  );

  // Case 2: In FOUND -> transitions to SEARCHING and returns deducted stock
  const foundCase = makeFixture('FOUND');
  await foundCase.svc.changeItem(staffUser, 'sess-1', {
    oldItemId: 'item-1',
    newSkuId: 'sku-new',
    reason: 'ลูกค้าเปลี่ยนใจ (ความจุ/สี/รุ่น)',
  });
  assert.equal(foundCase.getUpdatedSessionData().state, 'SEARCHING');
  assert.equal(foundCase.getUpdatedItemData().skuId, 'sku-new');
  assert.equal(foundCase.getReturnedShelfStock(), 1);
  assert.equal(
    foundCase.getUpdatedSessionData().events.create.metadata.fromState,
    'FOUND',
  );
});

test('a session holds several main products with quantities (D40 flow, F3)', async (t) => {
  const ctx = await startApi(t);
  if (!ctx) return;
  const { db, request } = ctx;
  let world;
  try {
    world = await seedWorld(ctx);
    const { cookies, branches, prefix } = world;
    const product = await db.product.create({
      data: {
        category: 'iPhone',
        name: `${prefix} Phone`,
        models: {
          create: {
            name: `${prefix} Model`,
            skus: {
              create: [
                {
                  sku: `${prefix}-A`,
                  name: `${prefix} A 128GB`,
                  color: 'Black',
                  storage: '128GB',
                },
                {
                  sku: `${prefix}-B`,
                  name: `${prefix} B 256GB`,
                  color: 'White',
                  storage: '256GB',
                },
              ],
            },
          },
        },
      },
      include: { models: { include: { skus: true } } },
    });
    const [skuA, skuB] = product.models[0].skus.sort((x, y) =>
      x.sku.localeCompare(y.sku),
    );
    for (const sku of [skuA, skuB])
      await db.branchInventory.create({
        data: {
          branchId: branches.a.id,
          skuId: sku.id,
          stock: 5,
          active: true,
        },
      });
    const stockOf = async (sku) =>
      (
        await db.branchInventory.findUnique({
          where: { branchId_skuId: { branchId: branches.a.id, skuId: sku.id } },
        })
      ).stock;
    const step = (id, action, who) =>
      request(`/sessions/${id}/step`, 'POST', { action }, cookies[who]);
    const put = (id, body) =>
      request(`/sessions/${id}/selection`, 'PUT', body, cookies.staff);
    const get = async (id) =>
      (await request(`/sessions/${id}`, 'GET', undefined, cookies.staff)).data;
    const setUnlimited = (value) =>
      request('/settings', 'PUT', { stockUnlimited: value }, cookies.admin);
    let phoneNo = 200;
    /** A session at PRODUCT_SELECTION, ready for items. */
    const atSelection = async () => {
      const created = await request(
        '/sessions',
        'POST',
        { phone: `09999002${String(phoneNo++).slice(-2)}` },
        cookies.staff,
      );
      assert.equal(created.status, 201, JSON.stringify(created.data));
      return created.data.id;
    };
    const confirmed = async (items) => {
      const id = await atSelection();
      assert.equal((await put(id, { items, payments: ['Cash'] })).status, 200);
      const res = await request(
        `/sessions/${id}/confirm`,
        'POST',
        undefined,
        cookies.staff,
      );
      assert.equal(res.status, 201, JSON.stringify(res.data));
      return id;
    };
    const atSearching = async (items) => {
      const id = await confirmed(items);
      assert.equal((await step(id, 'search', 'stock')).status, 201);
      return id;
    };
    const itemOf = (session, sku) =>
      session.items.find((i) => i.skuId === sku.id);
    const twoAndOne = [
      { skuId: skuA.id, quantity: 2 },
      { skuId: skuB.id, quantity: 1 },
    ];

    await t.test(
      'items come back with their SKU, replace each other and can be cleared',
      async () => {
        const id = await atSelection();
        const first = await put(id, {
          items: [
            { skuId: skuA.id, quantity: 2 },
            { skuId: skuB.sku, quantity: 1 },
          ],
        });
        assert.equal(first.status, 200, JSON.stringify(first.data));
        assert.equal(first.data.items.length, 2);
        const a = itemOf(first.data, skuA);
        const b = itemOf(first.data, skuB);
        assert.equal(a.quantity, 2);
        assert.equal(b.quantity, 1, 'a SKU code is accepted as well as an id');
        assert.equal(a.sku.sku, skuA.sku);
        assert.equal(
          a.sku.model.product.category,
          'iPhone',
          'the sku carries its model and product',
        );
        assert.equal(a.deducted, 0);
        const second = await put(id, {
          items: [{ skuId: skuB.id, quantity: 3 }],
        });
        assert.deepEqual(
          second.data.items.map((i) => [i.skuId, i.quantity]),
          [[skuB.id, 3]],
        );
        const untouched = await put(id, { payments: ['Transfer'] });
        assert.equal(
          untouched.data.items.length,
          1,
          'a save without `items` leaves them alone',
        );
        const cleared = await put(id, { items: [] });
        assert.equal(cleared.data.items.length, 0);
      },
    );

    await t.test(
      'bad items are refused, and the old single-product fields are gone',
      async () => {
        const id = await atSelection();
        const bad = [
          [{ skuId: 'no-such-sku', quantity: 1 }],
          [{ skuId: skuA.id, quantity: 0 }],
          [{ skuId: skuA.id, quantity: -1 }],
          [{ skuId: skuA.id, quantity: 1.5 }],
          [{ skuId: skuA.id, quantity: '2' }],
          [{ skuId: skuA.id }],
          [
            { skuId: skuA.id, quantity: 1 },
            { skuId: skuA.id, quantity: 1 },
          ],
          [
            { skuId: skuA.id, quantity: 1 },
            { skuId: skuA.sku, quantity: 1 },
          ],
          [{ skuId: skuA.id, quantity: 1, extra: true }],
        ];
        for (const items of bad)
          assert.equal(
            (await put(id, { items })).status,
            400,
            JSON.stringify(items),
          );
        assert.equal((await put(id, { skuId: skuA.id })).status, 400);
        assert.equal((await put(id, { productId: product.id })).status, 400);
        assert.equal(
          (await get(id)).items.length,
          0,
          'nothing was saved by the refused calls',
        );
      },
    );

    await t.test(
      'confirmation needs at least one item, and locks them',
      async () => {
        const id = await atSelection();
        const none = await request(
          `/sessions/${id}/confirm`,
          'POST',
          undefined,
          cookies.staff,
        );
        assert.equal(none.status, 400);
        assert.equal((await put(id, { items: twoAndOne })).status, 200);
        const done = await request(
          `/sessions/${id}/confirm`,
          'POST',
          undefined,
          cookies.staff,
        );
        assert.equal(done.status, 201, JSON.stringify(done.data));
        assert.equal(done.data.state, 'STOCK_REQUESTED');
        assert.equal(done.data.items.length, 2);
        assert.equal(
          (await put(id, { items: [{ skuId: skuA.id, quantity: 1 }] })).status,
          400,
          'locked after confirmation',
        );
      },
    );

    await t.test(
      'FOUND takes the quantity of every item off the shelf (switch off); a cancel gives exactly that back',
      async () => {
        await setUnlimited(false);
        const id = await atSearching(twoAndOne);
        const found = await step(id, 'found', 'stock');
        assert.equal(found.status, 201, JSON.stringify(found.data));
        assert.equal(await stockOf(skuA), 3);
        assert.equal(await stockOf(skuB), 4);
        assert.equal(itemOf(found.data, skuA).deducted, 2);
        assert.equal(itemOf(found.data, skuB).deducted, 1);
        assert.equal(
          found.data.events.filter((e) => e.eventType === 'STOCK_FOUND').at(-1)
            .metadata.deducted,
          3,
        );
        const cancelled = await request(
          `/sessions/${id}/cancel`,
          'POST',
          { reason: 'ลูกค้าเปลี่ยนใจ' },
          cookies.stock,
        );
        assert.equal(cancelled.status, 201, JSON.stringify(cancelled.data));
        assert.equal(await stockOf(skuA), 5);
        assert.equal(await stockOf(skuB), 5);
        assert.deepEqual(
          cancelled.data.items.map((i) => i.deducted),
          [0, 0],
          'the units are back, nothing is held any more',
        );
      },
    );

    await t.test(
      'with "stock unlimited" on nothing is taken, and a later switch change cannot invent units',
      async () => {
        await setUnlimited(true);
        const id = await atSearching(twoAndOne);
        const found = await step(id, 'found', 'stock');
        assert.equal(await stockOf(skuA), 5);
        assert.equal(itemOf(found.data, skuA).deducted, 0);
        await setUnlimited(false);
        assert.equal(
          (
            await request(
              `/sessions/${id}/cancel`,
              'POST',
              { reason: 'ลูกค้าเปลี่ยนใจ' },
              cookies.stock,
            )
          ).status,
          201,
        );
        assert.equal(await stockOf(skuA), 5, 'no unit invented');
        // FOUND with the switch off, then on, then cancel: the units taken go back
        const id2 = await atSearching(twoAndOne);
        await step(id2, 'found', 'stock');
        assert.equal(await stockOf(skuA), 3);
        await setUnlimited(true);
        await request(
          `/sessions/${id2}/cancel`,
          'POST',
          { reason: 'ลูกค้าเปลี่ยนใจ' },
          cookies.stock,
        );
        assert.equal(await stockOf(skuA), 5);
      },
    );

    await t.test(
      'stock reports the missing item by id; the customer keeps the rest (ACCEPT_PARTIAL)',
      async () => {
        await setUnlimited(false);
        const id = await atSearching(twoAndOne);
        const before = await get(id);
        const itemB = itemOf(before, skuB);
        const stranger = await request(
          `/sessions/${id}/stock/report-missing`,
          'POST',
          {
            missingItems: ['x'],
            missingItemIds: ['not-an-item-of-this-session'],
          },
          cookies.stock,
        );
        assert.equal(
          stranger.status,
          400,
          'an id that is not an item of this session',
        );
        const reported = await request(
          `/sessions/${id}/stock/report-missing`,
          'POST',
          {
            missingItems: [`${skuB.name} ×1`],
            foundItems: [`${skuA.name} ×2`],
            missingItemIds: [itemB.id],
            stockNote: 'หมด',
          },
          cookies.stock,
        );
        assert.equal(reported.status, 201, JSON.stringify(reported.data));
        assert.deepEqual(reported.data.stockReview.missingItemIds, [itemB.id]);
        const inventoryB = await db.branchInventory.findUnique({
          where: {
            branchId_skuId: { branchId: branches.a.id, skuId: skuB.id },
          },
        });
        assert.equal(
          inventoryB.stock,
          0,
          'D41: a missing report zeroes that SKU, and only that one',
        );
        assert.equal(await stockOf(skuA), 5);
        const resolved = await request(
          `/sessions/${id}/staff/resolve-stock-review`,
          'POST',
          { action: 'ACCEPT_PARTIAL' },
          cookies.staff,
        );
        assert.equal(resolved.status, 201, JSON.stringify(resolved.data));
        assert.equal(resolved.data.state, 'FOUND');
        assert.deepEqual(
          resolved.data.items.map((i) => i.skuId),
          [skuA.id],
          'the missing item is gone',
        );
        assert.equal(await stockOf(skuA), 3, 'the rest is taken off the shelf');
        assert.equal(itemOf(resolved.data, skuA).deducted, 2);
        await request(
          `/sessions/${id}/cancel`,
          'POST',
          { reason: 'ลูกค้าเปลี่ยนใจ' },
          cookies.stock,
        );
        await db.branchInventory.update({
          where: {
            branchId_skuId: { branchId: branches.a.id, skuId: skuB.id },
          },
          data: { stock: 5, outOfStockAt: null },
        });
      },
    );

    await t.test(
      'CHANGE_ITEMS drops the missing item and reopens the selection',
      async () => {
        const id = await atSearching(twoAndOne);
        const itemA = itemOf(await get(id), skuA);
        await request(
          `/sessions/${id}/stock/report-missing`,
          'POST',
          { missingItems: [`${skuA.name} ×2`], missingItemIds: [itemA.id] },
          cookies.stock,
        );
        const changed = await request(
          `/sessions/${id}/staff/resolve-stock-review`,
          'POST',
          { action: 'CHANGE_ITEMS' },
          cookies.staff,
        );
        assert.equal(changed.status, 201, JSON.stringify(changed.data));
        assert.equal(changed.data.state, 'PRODUCT_SELECTION');
        assert.equal(changed.data.confirmed, false);
        assert.deepEqual(
          changed.data.items.map((i) => i.skuId),
          [skuB.id],
        );
        const again = await put(id, {
          items: [
            ...changed.data.items.map((i) => ({
              skuId: i.skuId,
              quantity: i.quantity,
            })),
            { skuId: skuA.id, quantity: 1 },
          ],
        });
        assert.equal(
          again.status,
          200,
          'the staff can add another item after the change',
        );
        await db.branchInventory.update({
          where: {
            branchId_skuId: { branchId: branches.a.id, skuId: skuA.id },
          },
          data: { stock: 5, outOfStockAt: null },
        });
      },
    );

    await t.test(
      'a review without item ids (made before F3) names the main product instead',
      async () => {
        const id = await atSearching(twoAndOne);
        await request(
          `/sessions/${id}/stock/report-missing`,
          'POST',
          { missingItems: ['สินค้าหลัก'], foundItems: [] },
          cookies.stock,
        );
        const resolved = await request(
          `/sessions/${id}/staff/resolve-stock-review`,
          'POST',
          { action: 'ACCEPT_PARTIAL' },
          cookies.staff,
        );
        assert.equal(resolved.status, 201, JSON.stringify(resolved.data));
        assert.equal(
          resolved.data.items.length,
          0,
          'the main product(s) are gone, as before F3',
        );
        for (const sku of [skuA, skuB])
          await db.branchInventory.update({
            where: {
              branchId_skuId: { branchId: branches.a.id, skuId: sku.id },
            },
            data: { stock: 5, outOfStockAt: null },
          });
      },
    );

    await t.test(
      'the out-of-stock endpoint zeroes every item and ends the session',
      async () => {
        const id = await atSearching(twoAndOne);
        const res = await request(
          `/sessions/${id}/out-of-stock`,
          'POST',
          { action: 'cancel', reason: 'OUT_OF_STOCK' },
          cookies.stock,
        );
        assert.equal(res.status, 201, JSON.stringify(res.data));
        assert.equal(res.data.outcome, 'OUT_OF_STOCK');
        assert.equal(await stockOf(skuA), 0);
        assert.equal(await stockOf(skuB), 0);
        for (const sku of [skuA, skuB])
          await db.branchInventory.update({
            where: {
              branchId_skuId: { branchId: branches.a.id, skuId: sku.id },
            },
            data: { stock: 5, outOfStockAt: null },
          });
      },
    );

    await t.test(
      'changing an item in STOCK_REQUESTED keeps the state at STOCK_REQUESTED; changing in FOUND returns stock and moves to SEARCHING (D82)',
      async () => {
        await setUnlimited(false);
        const id = await confirmed([{ skuId: skuA.id, quantity: 1 }]);
        const before = await get(id);
        assert.equal(before.state, 'STOCK_REQUESTED');

        const changedInRequested = await request(
          `/sessions/${id}/change-item`,
          'POST',
          {
            oldItemId: before.items[0].id,
            newSkuId: skuB.id,
            reason: 'ลูกค้าเปลี่ยนใจ (ความจุ/สี/รุ่น)',
            note: 'เปลี่ยนสี',
          },
          cookies.staff,
        );
        assert.equal(
          changedInRequested.status,
          201,
          JSON.stringify(changedInRequested.data),
        );
        assert.equal(
          changedInRequested.data.state,
          'STOCK_REQUESTED',
          'remains in STOCK_REQUESTED when Stock has not started searching yet',
        );
        assert.equal(changedInRequested.data.stockStartedAt, null);
        assert.equal(changedInRequested.data.items[0].skuId, skuB.id);
        const ev1 = changedInRequested.data.events.at(-1);
        assert.equal(ev1.eventType, 'ITEM_CHANGED');
        assert.equal(ev1.metadata.fromState, 'STOCK_REQUESTED');

        // Stock can now start searching normally from STOCK_REQUESTED
        const searching = await step(id, 'search', 'stock');
        assert.equal(searching.status, 201, JSON.stringify(searching.data));
        assert.equal(searching.data.state, 'SEARCHING');
        assert.notEqual(searching.data.stockStartedAt, null);

        // Stock finds the item (deducts skuB)
        const found = await step(id, 'found', 'stock');
        assert.equal(found.status, 201, JSON.stringify(found.data));
        assert.equal(found.data.state, 'FOUND');
        assert.equal(await stockOf(skuB), 4);

        // Changing item in FOUND returns skuB to shelf and transitions back to SEARCHING
        const changedInFound = await request(
          `/sessions/${id}/change-item`,
          'POST',
          {
            oldItemId: found.data.items[0].id,
            newSkuId: skuA.id,
            reason: 'ลูกค้าเปลี่ยนใจ (ความจุ/สี/รุ่น)',
          },
          cookies.staff,
        );
        assert.equal(
          changedInFound.status,
          201,
          JSON.stringify(changedInFound.data),
        );
        assert.equal(changedInFound.data.state, 'SEARCHING');
        assert.equal(changedInFound.data.stockFoundAt, null);
        assert.equal(await stockOf(skuB), 5, 'returned to shelf');
        assert.equal(changedInFound.data.items[0].skuId, skuA.id);
      },
    );
  } finally {
    await cleanup(ctx, world);
  }
});
