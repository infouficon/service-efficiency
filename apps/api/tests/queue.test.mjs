import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cleanup, seedWorld, startApi } from './support.mjs';

const { bangkokDay, formatQueue, QueueService } =
  await import('../dist/queue/queue.service.js');

test('queue label and Bangkok day helpers', () => {
  assert.equal(formatQueue('A', 12), 'A012');
  assert.equal(formatQueue('B', 1), 'B001');
  assert.equal(formatQueue('A', 1000), 'A1000', 'four digits after 999');
  assert.equal(
    formatQueue(null, 7),
    '007',
    'sessions from before D57 have no letter',
  );
  // Bangkok is UTC+7: 16:59:59Z is still the same day there, 17:00:00Z is the next one
  assert.equal(bangkokDay(new Date('2026-03-01T16:59:59Z')), '2026-03-01');
  assert.equal(bangkokDay(new Date('2026-03-01T17:00:00Z')), '2026-03-02');
  assert.equal(bangkokDay(new Date('2026-12-31T17:00:00Z')), '2027-01-01');
});

test('walk-in starts at the phone number and takes a queue number (D56, D57)', async (t) => {
  const ctx = await startApi(t);
  if (!ctx) return;
  const { db, request } = ctx;
  let world;
  try {
    world = await seedWorld(ctx);
    const { cookies, branches } = world;
    const walkIn = (body, who = 'staff') =>
      request('/sessions', 'POST', body, cookies[who]);
    const types = (
      await request('/customer-types', 'GET', undefined, cookies.staff)
    ).data;
    const typeA = types.find((x) => x.letter === 'A');
    const typeB = types.find((x) => x.letter === 'B');
    assert.ok(typeA && typeB, 'the migration seeds the types A and B');

    await t.test('the phone is required: exactly 10 ASCII digits', async () => {
      assert.equal((await walkIn({})).status, 400);
      assert.equal((await walkIn({ phone: '' })).status, 400);
      assert.equal((await walkIn({ phone: '0999900' })).status, 400);
      assert.equal((await walkIn({ phone: '09999000011' })).status, 400);
      assert.equal((await walkIn({ phone: '099990000x' })).status, 400);
      assert.equal(
        (await walkIn({ phone: '๐๙๙๙๙๐๐๐๐๑' })).status,
        400,
        'Thai digits are refused',
      );
      assert.equal(
        await db.customerSession.count({ where: { branchId: branches.a.id } }),
        0,
      );
    });

    await t.test(
      'walk-in starts with phone, customer and no queue number (D70)',
      async () => {
        const res = await walkIn({ phone: '0999900001' });
        assert.equal(res.status, 201, JSON.stringify(res.data));
        assert.equal(
          res.data.queueLetter,
          null,
          'queue number is allocated at confirmation, not at walk-in (D70)',
        );
        assert.equal(res.data.queueNo, null);
        assert.equal(res.data.customerTypeId, null);
        assert.equal(res.data.customerType, null);
        assert.equal(res.data.phone, '0999900001');
        assert.ok(res.data.customerId);
        assert.equal(res.data.state, 'PRODUCT_SELECTION');
        assert.ok(res.data.productSelectionStartAt);
        assert.match(res.data.reference, /^SES-\d{8}-\d{6}$/);
        assert.equal(res.data.events.length, 2);
        assert.equal(res.data.events[0].eventType, 'SESSION_CREATED');
        assert.equal(res.data.events[1].eventType, 'PRODUCT_SELECTION_STARTED');
        const customer = await db.customer.findUnique({
          where: { phone: '0999900001' },
        });
        assert.equal(customer.id, res.data.customerId);
      },
    );

    await t.test(
      'walk-in keeps the same customer for the same phone; branch is assigned',
      async () => {
        const second = await walkIn({
          phone: '0999900001',
        });
        assert.equal(second.data.queueNo, null);
        const otherBranch = await walkIn({ phone: '0999900004' }, 'staffB');
        assert.equal(otherBranch.status, 201);
        assert.equal(otherBranch.data.queueNo, null);
        assert.equal(otherBranch.data.branchId, branches.b.id);
        assert.equal(
          second.data.customerId,
          (await db.customer.findUnique({ where: { phone: '0999900001' } })).id,
        );
      },
    );

    await t.test(
      'parallel walk-ins never collide on the reference (H-05)',
      async () => {
        const results = await Promise.all(
          Array.from({ length: 8 }, (_, i) =>
            walkIn({
              phone: `09999001${String(i).padStart(2, '0')}`,
            }),
          ),
        );
        assert.deepEqual(
          results.map((r) => r.status),
          Array(8).fill(201),
        );
        const refs = new Set(results.map((r) => r.data.reference));
        assert.equal(refs.size, 8);
      },
    );

    await t.test(
      'the day rolls over at midnight in Bangkok, not in the server zone',
      async () => {
        const queue = ctx.get(QueueService);
        const take = (iso) =>
          db.$transaction((tx) =>
            queue.allocate(tx, branches.a.id, typeA.id, new Date(iso)),
          );
        assert.equal((await take('2026-03-01T16:59:58Z')).queueNo, 1);
        assert.equal((await take('2026-03-01T16:59:59Z')).queueNo, 2);
        assert.equal(
          (await take('2026-03-01T17:00:00Z')).queueNo,
          1,
          '00:00 in Bangkok',
        );
        assert.equal((await take('2026-03-02T05:00:00Z')).queueNo, 2);
        assert.equal(
          (await take('2026-03-01T16:59:59Z')).queueNo,
          3,
          'an earlier day keeps counting on its own row',
        );
      },
    );

    await t.test(
      'a reference that already exists is skipped, never a failed walk-in',
      async () => {
        const first = await walkIn({ phone: '0999900030' });
        const [, day, no] = first.data.reference.match(/^SES-(\d{8})-(\d{6})$/);
        const taken = `SES-${day}-${String(Number(no) + 1).padStart(6, '0')}`;
        // e.g. a session from before the counters existed, or a restored backup
        await db.customerSession.create({
          data: {
            reference: taken,
            branchId: branches.a.id,
            staffId: world.staffIds.staff,
          },
        });
        const next = await walkIn({ phone: '0999900031' });
        assert.equal(next.status, 201, JSON.stringify(next.data));
        assert.equal(
          next.data.reference,
          `SES-${day}-${String(Number(no) + 2).padStart(6, '0')}`,
        );
      },
    );

    await t.test(
      'only an active type can be chosen; other roles may not start a walk-in',
      async () => {
        const gone = await walkIn({
          phone: '0999900010',
          customerTypeId: 'no-such-type',
        });
        assert.equal(gone.status, 400);
        assert.equal(
          (await walkIn({ phone: '0999900010' }, 'cashier')).status,
          403,
        );
        assert.equal(
          (
            await walkIn({
              phone: '0999900010',
              customerTypeId: typeA.id,
              queueNo: 1,
            })
          ).status,
          400,
          'the queue number can never be sent by the client',
        );
      },
    );

    await t.test(
      'a cancelled visit keeps the phone given at the start',
      async () => {
        const created = await walkIn({ phone: '0999900011' });
        const id = created.data.id;
        const done = await request(
          `/sessions/${id}/cancel`,
          'POST',
          { reason: 'ลูกค้าเปลี่ยนใจ' },
          cookies.staff,
        );
        assert.equal(done.status, 201, JSON.stringify(done.data));
        assert.equal(done.data.outcome, 'CUSTOMER_CANCELLED');
        assert.equal(done.data.phone, '0999900011');
        assert.ok(done.data.customerId);
      },
    );

    await t.test('list and detail carry the session fields', async () => {
      const list = await request('/sessions', 'GET', undefined, cookies.staff);
      assert.equal(list.status, 200);
      const row = list.data[0];
      assert.ok(row);
      const detail = await request(
        `/sessions/${row.id}`,
        'GET',
        undefined,
        cookies.staff,
      );
      assert.equal(detail.status, 200);
      assert.equal(detail.data.id, row.id);
      const byRef = await request(
        `/sessions/${row.reference}`,
        'GET',
        undefined,
        cookies.staff,
      );
      assert.equal(
        byRef.data.id,
        row.id,
        'the reference still works as a lookup key',
      );
    });
  } finally {
    await cleanup(ctx, world);
  }
});

test('customer types: everyone reads, only ADMIN manages, letters fill A-Z in order (D57)', async (t) => {
  const ctx = await startApi(t);
  if (!ctx) return;
  const { db, request } = ctx;
  let world;
  try {
    world = await seedWorld(ctx);
    const { cookies, prefix } = world;
    const list = (who, query = '') =>
      request(`/customer-types${query}`, 'GET', undefined, cookies[who]);
    const before = (await list('admin', '?all=true')).data;
    const used = new Set(before.map((x) => x.letter));
    const nextFree = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'].find(
      (l) => !used.has(l),
    );

    await t.test(
      'any signed-in role reads the active types, in letter order',
      async () => {
        for (const who of ['staff', 'stock', 'cashier', 'manager']) {
          const res = await list(who);
          assert.equal(res.status, 200);
          assert.deepEqual(
            res.data.map((x) => x.letter),
            [...res.data.map((x) => x.letter)].sort(),
          );
          assert.ok(res.data.every((x) => x.active));
        }
        assert.equal((await request('/customer-types', 'GET')).status, 401);
      },
    );

    await t.test(
      'creating, renaming and switching off is ADMIN only',
      async () => {
        assert.equal(
          (
            await request(
              '/customer-types',
              'POST',
              { name: `${prefix} x` },
              cookies.manager,
            )
          ).status,
          403,
        );
        assert.equal(
          (
            await request(
              '/customer-types',
              'POST',
              { name: `${prefix} x` },
              cookies.staff,
            )
          ).status,
          403,
        );
        const auto = await request(
          '/customer-types',
          'POST',
          { name: `${prefix} VIP` },
          cookies.admin,
        );
        assert.equal(auto.status, 201, JSON.stringify(auto.data));
        assert.equal(
          auto.data.letter,
          nextFree,
          'no letter given: the next free one',
        );
        const chosen = await request(
          '/customer-types',
          'POST',
          { letter: 'y', name: `${prefix} Y`, description: ' รอนาน ' },
          cookies.admin,
        );
        if (used.has('Y')) assert.equal(chosen.status, 409);
        else {
          assert.equal(chosen.status, 201, JSON.stringify(chosen.data));
          assert.equal(
            chosen.data.letter,
            'Y',
            'lower case is taken as upper case',
          );
          assert.equal(chosen.data.description, 'รอนาน');
          assert.equal(
            (
              await request(
                '/customer-types',
                'POST',
                { letter: 'Y', name: `${prefix} again` },
                cookies.admin,
              )
            ).status,
            409,
            'a letter is used once',
          );
        }
        for (const bad of [
          { letter: 'AB', name: 'x' },
          { letter: '1', name: 'x' },
          { name: '   ' },
          {},
        ]) {
          assert.equal(
            (await request('/customer-types', 'POST', bad, cookies.admin))
              .status,
            400,
          );
        }
        const renamed = await request(
          `/customer-types/${auto.data.id}`,
          'PUT',
          { name: `${prefix} VIP+` },
          cookies.admin,
        );
        assert.equal(renamed.data.name, `${prefix} VIP+`);
        assert.equal(
          renamed.data.letter,
          auto.data.letter,
          'the letter never changes',
        );
        assert.equal(
          (
            await request(
              `/customer-types/${auto.data.id}`,
              'PUT',
              { letter: 'Q' },
              cookies.admin,
            )
          ).status,
          400,
        );
        assert.equal(
          (
            await request(
              `/customer-types/${auto.data.id}`,
              'PUT',
              { name: 'x' },
              cookies.staff,
            )
          ).status,
          403,
        );
        assert.equal(
          (
            await request(
              '/customer-types/none',
              'PUT',
              { name: 'x' },
              cookies.admin,
            )
          ).status,
          404,
        );
      },
    );

    await t.test(
      'a switched-off type leaves the staff list, cannot start a walk-in, and the last active one stays',
      async () => {
        const created = (
          await request(
            '/customer-types',
            'POST',
            { name: `${prefix} off` },
            cookies.admin,
          )
        ).data;
        const off = await request(
          `/customer-types/${created.id}`,
          'PUT',
          { active: false },
          cookies.admin,
        );
        assert.equal(off.data.active, false);
        assert.ok(!(await list('staff')).data.some((x) => x.id === created.id));
        assert.ok(
          (await list('admin', '?all=true')).data.some(
            (x) => x.id === created.id,
          ),
        );
        assert.ok(
          !(await list('manager', '?all=true')).data.some(
            (x) => x.id === created.id,
          ),
          '?all=true is for ADMIN only',
        );
        const refused = await request(
          '/sessions',
          'POST',
          { phone: '0999900020', customerTypeId: created.id },
          cookies.staff,
        );
        assert.equal(refused.status, 400);
        // the last active type cannot be switched off: simulate "only one left" inside this test's own transaction scope
        const active = (await list('admin')).data;
        const keep = active[0];
        const rest = active.slice(1);
        try {
          for (const x of rest)
            await db.customerType.update({
              where: { id: x.id },
              data: { active: false },
            });
          const last = await request(
            `/customer-types/${keep.id}`,
            'PUT',
            { active: false },
            cookies.admin,
          );
          assert.equal(last.status, 400);
          assert.equal(
            (await db.customerType.findUnique({ where: { id: keep.id } }))
              .active,
            true,
          );
        } finally {
          for (const x of rest)
            await db.customerType.update({
              where: { id: x.id },
              data: { active: true },
            });
        }
      },
    );

    await t.test(
      'payment methods, ontop, points, and burn points auto-classify session to that type (D69, D70)',
      async () => {
        const types = (await list('admin')).data;
        const typeB = types.find((x) => x.letter === 'B');
        const typeA = types.find((x) => x.letter === 'A');
        assert.ok(typeB && typeA);

        const updated = await request(
          `/customer-types/${typeB.id}`,
          'PUT',
          {
            paymentMethods: ['UFund', 'Ulite'],
            ontop: ['AIS Point'],
            points: ['The 1'],
            burnPoints: ['Burn KBank'],
          },
          cookies.admin,
        );
        assert.equal(updated.status, 200);
        assert.deepEqual(updated.data.paymentMethods, ['UFund', 'Ulite']);
        assert.deepEqual(updated.data.ontop, ['AIS Point']);
        assert.deepEqual(updated.data.points, ['The 1']);
        assert.deepEqual(updated.data.burnPoints, ['Burn KBank']);

        const walkIn = await request(
          '/sessions',
          'POST',
          { phone: '0999900099' },
          cookies.staff,
        );
        assert.equal(walkIn.status, 201);
        assert.equal(walkIn.data.queueLetter, null);
        assert.equal(walkIn.data.customerTypeId, null);

        const selectionRes = await request(
          `/sessions/${walkIn.data.id}/selection`,
          'PUT',
          { payments: ['Cash', 'UFund'] },
          cookies.staff,
        );
        assert.equal(selectionRes.status, 200);
        assert.equal(selectionRes.data.customerTypeId, typeB.id);
        assert.equal(selectionRes.data.queueLetter, null);
        assert.equal(selectionRes.data.customerType.letter, 'B');

        const reverted = await request(
          `/sessions/${walkIn.data.id}/selection`,
          'PUT',
          { payments: ['Cash'] },
          cookies.staff,
        );
        assert.equal(reverted.status, 200);
        assert.equal(reverted.data.customerTypeId, typeA.id);
        assert.equal(reverted.data.queueLetter, null);
        assert.equal(reverted.data.customerType.letter, 'A');

        // Ontop match also classifies to Type B
        const ontopRes = await request(
          `/sessions/${walkIn.data.id}/selection`,
          'PUT',
          { payments: ['Cash'], ontop: ['AIS Point'] },
          cookies.staff,
        );
        assert.equal(ontopRes.status, 200);
        assert.equal(ontopRes.data.customerTypeId, typeB.id);
        assert.equal(ontopRes.data.customerType.letter, 'B');
      },
    );
  } finally {
    await cleanup(ctx, world);
  }
});
