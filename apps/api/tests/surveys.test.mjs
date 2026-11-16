import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cleanup, seedWorld, startApi } from './support.mjs';

test('surveys: configurable questions for BUY and NOT_BUY, response collection, and CSV export (D140)', async (t) => {
  const ctx = await startApi(t);
  if (!ctx) return;
  const { db, request } = ctx;
  let world;
  try {
    world = await seedWorld(ctx);
    const { cookies, prefix, branches, staffId } = world;

    const listQuestions = (who, query = '') =>
      request(`/surveys/questions${query}`, 'GET', undefined, cookies[who]);

    const createQuestion = (body, who = 'admin') =>
      request('/surveys/questions', 'POST', body, cookies[who]);

    const updateQuestion = (id, body, who = 'admin') =>
      request(`/surveys/questions/${id}`, 'PUT', body, cookies[who]);

    const deleteQuestion = (id, who = 'admin') =>
      request(`/surveys/questions/${id}`, 'DELETE', undefined, cookies[who]);

    const submitResponse = (body, who = 'staff') =>
      request('/surveys/responses', 'POST', body, cookies[who]);

    await t.test('unauthenticated access is rejected with 401', async () => {
      assert.equal((await request('/surveys/questions', 'GET')).status, 401);
    });

    await t.test('only ADMIN can create, update, or delete survey questions', async () => {
      const qData = {
        target: 'BUY',
        title: `${prefix} ความพึงพอใจการบริการ`,
        questionType: 'SINGLE_CHOICE',
        options: ['ดีมาก', 'ปานกลาง', 'ควรปรับปรุง'],
        allowOther: true,
      };

      for (const who of ['staff', 'stock', 'manager']) {
        const res = await createQuestion(qData, who);
        assert.equal(res.status, 403, `${who} should be forbidden`);
      }

      const created = await createQuestion(qData, 'admin');
      assert.equal(created.status, 201);
      assert.equal(created.data.title, qData.title);
      assert.equal(created.data.target, 'BUY');
      assert.equal(created.data.allowOther, true);

      const qId = created.data.id;

      // Staff cannot update
      assert.equal((await updateQuestion(qId, { title: 'Updated' }, 'staff')).status, 403);

      // Admin can update
      const updated = await updateQuestion(qId, { title: `${prefix} ความพึงพอใจโดยรวม`, allowOther: false }, 'admin');
      assert.equal(updated.status, 200);
      assert.equal(updated.data.title, `${prefix} ความพึงพอใจโดยรวม`);
      assert.equal(updated.data.allowOther, false);

      // Staff can list active questions
      const staffList = await listQuestions('staff', '?target=BUY');
      assert.equal(staffList.status, 200);
      assert.ok(staffList.data.some((q) => q.id === qId));

      // Admin deletes
      const deleted = await deleteQuestion(qId, 'admin');
      assert.equal(deleted.status, 200);
    });

    await t.test('admin can reorder survey questions via drag-and-drop endpoint (D142)', async () => {
      const q1 = await createQuestion({
        target: 'BUY',
        title: `${prefix} Q1`,
        questionType: 'TEXT',
      });
      const q2 = await createQuestion({
        target: 'BUY',
        title: `${prefix} Q2`,
        questionType: 'TEXT',
      });
      assert.equal(q1.status, 201);
      assert.equal(q2.status, 201);

      // Staff cannot reorder
      const staffReorder = await request(
        '/surveys/questions/reorder',
        'POST',
        { target: 'BUY', orderedIds: [q2.data.id, q1.data.id] },
        cookies.staff,
      );
      assert.equal(staffReorder.status, 403);

      // Admin reorders q2 before q1
      const reorderRes = await request(
        '/surveys/questions/reorder',
        'POST',
        { target: 'BUY', orderedIds: [q2.data.id, q1.data.id] },
        cookies.admin,
      );
      assert.equal(reorderRes.status, 201);
      const ids = reorderRes.data.map((q) => q.id);
      assert.ok(ids.indexOf(q2.data.id) < ids.indexOf(q1.data.id));

      await deleteQuestion(q1.data.id, 'admin');
      await deleteQuestion(q2.data.id, 'admin');
    });

    await t.test('staff submits survey responses for a session', async () => {
      // 1. Create a question for NOT_BUY
      const notBuyQ = await createQuestion({
        target: 'NOT_BUY',
        title: `${prefix} สาเหตุหลักที่ไม่ตัดสินใจซื้อ`,
        questionType: 'SINGLE_CHOICE',
        options: ['ราคาแพง', 'รอสินค้านาน', 'ยังไม่อยากได้'],
      });
      assert.equal(notBuyQ.status, 201);

      // 2. Create a customer session
      const sessRes = await request(
        '/sessions',
        'POST',
        { branchId: branches[0].id, phone: '0812345678' },
        cookies.staff,
      );
      assert.equal(sessRes.status, 201);
      const session = sessRes.data;

      // 3. Submit survey response
      const submitRes = await submitResponse({
        sessionId: session.id,
        target: 'NOT_BUY',
        answers: [
          {
            questionId: notBuyQ.data.id,
            questionTitle: notBuyQ.data.title,
            questionType: notBuyQ.data.questionType,
            answer: 'ราคาแพง',
          },
        ],
      });
      assert.equal(submitRes.status, 201);
      assert.equal(submitRes.data.target, 'NOT_BUY');

      // 4. Clean up question
      await deleteQuestion(notBuyQ.data.id, 'admin');
    });
  } finally {
    await cleanup(ctx, world);
  }
});
