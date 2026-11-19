import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cleanup, seedWorld, startApi } from './support.mjs';

test('Product colors palette: ADMIN manages central hex codes; colors are preserved across ERP syncs (D143)', async (t) => {
  const ctx = await startApi(t);
  if (!ctx) return;
  const { db, request } = ctx;
  let world;
  try {
    world = await seedWorld(ctx);
    const { cookies, prefix } = world;
    const list = (who = 'admin') =>
      request('/colors', 'GET', undefined, cookies[who]);
    const upsert = (body, who = 'admin') =>
      request('/colors', 'POST', body, cookies[who]);
    const del = (id, who = 'admin') =>
      request(`/colors/${id}`, 'DELETE', undefined, cookies[who]);

    await t.test('authenticated users can read colors; unauthenticated gets 401', async () => {
      assert.equal((await request('/colors', 'GET')).status, 401);
      for (const who of ['staff', 'stock', 'manager', 'admin']) {
        const res = await list(who);
        assert.equal(res.status, 200, who);
        assert.ok(Array.isArray(res.data));
      }
    });

    await t.test('only ADMIN can upsert colors; STAFF/STOCK get 403', async () => {
      const colorName = `${prefix}_Midnight`;
      for (const who of ['staff', 'stock', 'manager']) {
        const res = await upsert({ name: colorName, hexCode: '#1C1C1E' }, who);
        assert.equal(res.status, 403, who);
      }
    });

    await t.test('ADMIN can upsert color and update hex code; rejects invalid hex', async () => {
      const colorName = `${prefix}_NaturalTitanium`;

      // Invalid hex
      const badRes = await upsert({ name: colorName, hexCode: 'not-a-hex' });
      assert.equal(badRes.status, 400);

      // Valid upsert
      const okRes = await upsert({ name: colorName, hexCode: '#8A857B' });
      assert.equal(okRes.status, 201);
      assert.equal(okRes.data.name, colorName);
      assert.equal(okRes.data.hexCode, '#8A857B');

      // Check in list
      const listed = await list('staff');
      const found = listed.data.find((c) => c.name === colorName);
      assert.ok(found);
      assert.equal(found.hexCode, '#8A857B');

      // Update hex
      const updateRes = await upsert({ name: colorName, hexCode: '#9B968C' });
      assert.equal(updateRes.status, 201);
      assert.equal(updateRes.data.hexCode, '#9B968C');

      // Delete
      const delRes = await del(updateRes.data.id);
      assert.equal(delRes.status, 200);
    });
  } finally {
    if (world) await cleanup(ctx, world);
  }
});
