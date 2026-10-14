import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cleanup, seedWorld, startApi } from './support.mjs';

const SEEDED = [
  'Cash',
  'Transfer',
  'SPayLater',
  'TrueMoney',
  'Full Credit Card',
  '0% Credit Card',
  'PayNext',
  'UFund',
  'Ulite',
  'Thisshop',
  'Kashjoy',
];

test('payment methods are a list ADMIN keeps; names are history, so never renamed (F6)', async (t) => {
  const ctx = await startApi(t);
  if (!ctx) return;
  const { db, request } = ctx;
  let world;
  try {
    world = await seedWorld(ctx);
    const { cookies, prefix } = world;
    const list = (who, query = '') =>
      request(`/payment-methods${query}`, 'GET', undefined, cookies[who]);
    const names = async (who, query) =>
      (await list(who, query)).data.map((m) => m.name);

    await t.test(
      'the migration seeds the eleven methods the app offered, in order',
      async () => {
        assert.deepEqual(
          (await names('staff')).slice(0, SEEDED.length),
          SEEDED,
        );
        for (const who of ['staff', 'stock', 'cashier', 'manager', 'admin'])
          assert.equal((await list(who)).status, 200, who);
        assert.equal((await request('/payment-methods', 'GET')).status, 401);
      },
    );

    await t.test(
      'only ADMIN adds a method; it lands at the end; a name is used once',
      async () => {
        const add = (body, who = 'admin') =>
          request('/payment-methods', 'POST', body, cookies[who]);
        for (const who of ['staff', 'stock', 'cashier', 'manager'])
          assert.equal(
            (await add({ name: `${prefix} Wallet` }, who)).status,
            403,
            who,
          );
        const created = await add({ name: `${prefix} Wallet` });
        assert.equal(created.status, 201, JSON.stringify(created.data));
        assert.equal(created.data.active, true);
        assert.equal((await names('staff')).at(-1), `${prefix} Wallet`);
        assert.equal((await add({ name: `${prefix} Wallet` })).status, 409);
        assert.equal(
          (await add({ name: `${prefix.toUpperCase()} WALLET` })).status,
          409,
          'case does not make a second method',
        );
        for (const bad of [
          {},
          { name: '   ' },
          { name: 'x'.repeat(65) },
          { name: 'ok', extra: 1 },
          { name: 5 },
        ])
          assert.equal((await add(bad)).status, 400, JSON.stringify(bad));
        assert.equal(
          (await add({ name: ` ${prefix} Trimmed ` })).data.name,
          `${prefix} Trimmed`,
        );
      },
    );

    await t.test(
      'switching a method off hides it from staff but keeps it for ADMIN; the name cannot change',
      async () => {
        const wallet = (await list('admin', '?all=true')).data.find(
          (m) => m.name === `${prefix} Wallet`,
        );
        const put = (id, body, who = 'admin') =>
          request(`/payment-methods/${id}`, 'PUT', body, cookies[who]);
        assert.equal(
          (await put(wallet.id, { active: false }, 'staff')).status,
          403,
        );
        const off = await put(wallet.id, { active: false });
        assert.equal(off.status, 200, JSON.stringify(off.data));
        assert.equal(off.data.active, false);
        assert.ok(!(await names('staff')).includes(`${prefix} Wallet`));
        assert.ok(
          !(await names('staff', '?all=true')).includes(`${prefix} Wallet`),
          '?all=true is for ADMIN only',
        );
        assert.ok(
          (await names('admin', '?all=true')).includes(`${prefix} Wallet`),
        );
        assert.equal(
          (await put(wallet.id, { name: 'Renamed' })).status,
          400,
          'history keeps the name',
        );
        assert.equal((await put('no-such-id', { active: true })).status, 404);
        assert.equal(
          (await put(wallet.id, { active: true })).data.active,
          true,
        );
      },
    );

    await t.test(
      'a method moves up or down by swapping with its neighbour',
      async () => {
        const move = (id, direction, who = 'admin') =>
          request(
            `/payment-methods/${id}/move`,
            'POST',
            { direction },
            cookies[who],
          );
        const all = () => list('admin', '?all=true').then((r) => r.data);
        const before = await all();
        const last = before.at(-1);
        assert.equal((await move(last.id, 'up', 'staff')).status, 403);
        assert.equal((await move(last.id, 'sideways')).status, 400);
        assert.equal((await move(last.id, 'up')).status, 201);
        const after = await all();
        assert.deepEqual(
          after.map((m) => m.id),
          [...before.slice(0, -2), last, before.at(-2)].map((m) => m.id),
        );
        assert.equal((await move(last.id, 'down')).status, 201);
        assert.deepEqual(
          (await all()).map((m) => m.id),
          before.map((m) => m.id),
        );
        const first = before[0];
        assert.equal(
          (await move(first.id, 'up')).status,
          201,
          'moving the first one up changes nothing',
        );
        assert.deepEqual(
          (await all()).map((m) => m.id),
          before.map((m) => m.id),
        );
      },
    );

    await t.test('at least one method stays active', async () => {
      const all = (await list('admin', '?all=true')).data;
      const keep = all.find((m) => m.active);
      const others = all.filter((m) => m.id !== keep.id && m.active);
      try {
        await db.paymentMethod.updateMany({
          where: { id: { in: others.map((m) => m.id) } },
          data: { active: false },
        });
        const res = await request(
          `/payment-methods/${keep.id}`,
          'PUT',
          { active: false },
          cookies.admin,
        );
        assert.equal(res.status, 400);
        assert.equal(
          (await db.paymentMethod.findUnique({ where: { id: keep.id } }))
            .active,
          true,
        );
      } finally {
        await db.paymentMethod.updateMany({
          where: { id: { in: others.map((m) => m.id) } },
          data: { active: true },
        });
      }
    });

    await t.test('PUT /payment-methods/reorder updates positions (D71)', async () => {
      const all = () => list('admin', '?all=true').then((r) => r.data);
      const before = await all();
      const ids = before.map((m) => m.id);
      const reversedIds = [...ids].reverse();

      assert.equal(
        (
          await request(
            '/payment-methods/reorder',
            'PUT',
            { ids: reversedIds },
            cookies.staff,
          )
        ).status,
        403,
        'ADMIN only',
      );

      const reordered = await request(
        '/payment-methods/reorder',
        'PUT',
        { ids: reversedIds },
        cookies.admin,
      );
      assert.equal(reordered.status, 200);
      assert.deepEqual(
        reordered.data.map((m) => m.id),
        reversedIds,
      );

      // restore original order
      await request(
        '/payment-methods/reorder',
        'PUT',
        { ids },
        cookies.admin,
      );
    });
  } finally {
    await cleanup(ctx, world);
  }
});
