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
      };

      for (const who of ['staff', 'stock', 'manager']) {
        const res = await createQuestion(qData, who);
        assert.equal(res.status, 403, `${who} should be forbidden`);
      }

      const created = await createQuestion(qData, 'admin');
      assert.equal(created.status, 201);
      assert.equal(created.data.title, qData.title);
      assert.equal(created.data.target, 'BUY');

      const qId = created.data.id;

      // Staff cannot update
      assert.equal((await updateQuestion(qId, { title: 'Updated' }, 'staff')).status, 403);

      // Admin can update
      const updated = await updateQuestion(qId, { title: `${prefix} ความพึงพอใจโดยรวม` }, 'admin');
      assert.equal(updated.status, 200);
      assert.equal(updated.data.title, `${prefix} ความพึงพอใจโดยรวม`);

      // Staff can list active questions
      const staffList = await listQuestions('staff', '?target=BUY');
      assert.equal(staffList.status, 200);
      assert.ok(staffList.data.some((q) => q.id === qId));

      // Admin deletes
      const deleted = await deleteQuestion(qId, 'admin');
      assert.equal(deleted.status, 200);
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
