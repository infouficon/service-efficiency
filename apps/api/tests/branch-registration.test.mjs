import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cleanup, seedWorld, startApi } from './support.mjs';

test('each branch has a registration URL for the receipt QR, set by ADMIN even when the ERP owns the branch (F10)', async (t) => {
  const ctx = await startApi(t);
  if (!ctx) return;
  const { db, request } = ctx;
  let world;
  try {
    world = await seedWorld(ctx);
    const { cookies, branches } = world;
    const put = (id, body, who = 'admin') =>
      request(`/branches/${id}/registration-url`, 'PUT', body, cookies[who]);
    const url = `https://pos.example.test/register?branch=${branches.a.code}`;

    await t.test('ADMIN sets and clears it; nobody else can', async () => {
      assert.equal(
        branches.a.registrationUrl ?? null,
        null,
        'none to begin with',
      );
      for (const who of ['staff', 'stock', 'cashier', 'manager'])
        assert.equal((await put(branches.a.id, { url }, who)).status, 403, who);
      const set = await put(branches.a.id, { url });
      assert.equal(set.status, 200, JSON.stringify(set.data));
      assert.equal(set.data.registrationUrl, url);
      assert.equal(
        set.data.code,
        branches.a.code,
        'the rest of the branch is untouched',
      );
      const list = await request('/branches', 'GET', undefined, cookies.admin);
      assert.equal(
        list.data.find((b) => b.id === branches.a.id).registrationUrl,
        url,
      );
      const cleared = await put(branches.a.id, { url: null });
      assert.equal(cleared.data.registrationUrl, null);
      assert.equal((await put('no-such-branch', { url })).status, 404);
    });

    await t.test(
      'only a real http(s) address, at most 512 characters',
      async () => {
        for (const bad of [
          {},
          { url: '' },
          { url: 'not a url' },
          { url: 'ftp://pos.example.test/register' },
          { url: 'javascript:alert(1)' },
          { url: `https://pos.example.test/${'x'.repeat(520)}` },
          { url, extra: 1 },
        ])
          assert.equal(
            (await put(branches.a.id, bad)).status,
            400,
            JSON.stringify(bad).slice(0, 80),
          );
        assert.equal(
          (
            await put(branches.a.id, {
              url: 'http://localhost:3000/register?branch=A',
            })
          ).status,
          200,
        );
      },
    );

    await t.test(
      'an ERP-managed branch refuses hand edits but still takes the URL; sessions carry it to the receipt',
      async () => {
        await db.branch.update({
          where: { id: branches.b.id },
          data: {
            erpBranchId: 700_000_000 + Math.floor(Math.random() * 1_000_000),
          },
        });
        const edit = await request(
          `/branches/${branches.b.id}`,
          'PUT',
          { code: branches.b.code, name: 'renamed', phone: '', active: true },
          cookies.admin,
        );
        assert.equal(edit.status, 409, 'the ERP owns name and phone');
        const set = await put(branches.b.id, { url });
        assert.equal(set.status, 200, JSON.stringify(set.data));
        const walkIn = await request(
          '/sessions',
          'POST',
          { phone: '0999900500' },
          cookies.staffB,
        );
        assert.equal(walkIn.status, 201);
        assert.equal(walkIn.data.branch.registrationUrl, url);
        assert.equal(walkIn.data.branch.phone, branches.b.phone);
      },
    );
  } finally {
    await cleanup(ctx, world);
  }
});
