import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cleanup, seedWorld, startApi } from './support.mjs';

test('API docs: all endpoints for ADMIN only; the U POS contract is public (D84)', async (t) => {
  const ctx = await startApi(t);
  if (!ctx) return;
  const { request } = ctx;
  let world;
  try {
    world = await seedWorld(ctx);
    const { cookies } = world;

    await t.test('the POS contract page and JSON are public and list only the POS endpoints', async () => {
      const json = await request('/pos-docs-json');
      assert.equal(json.status, 200);
      const paths = Object.keys(json.data.paths).sort();
      assert.deepEqual(paths, ['/api/integrations/pos/bills', '/api/integrations/pos/orders']);
      assert.ok(json.data.components.securitySchemes['pos-key'], 'bearer scheme documented');
      const orders = json.data.paths['/api/integrations/pos/orders'].get;
      assert.deepEqual(orders.parameters.map((p) => p.name).sort(), ['branch', 'queue']);
      assert.ok(orders.responses['200'].content['application/json'].schema.example.orders);
      const bills = json.data.paths['/api/integrations/pos/bills'].post;
      const body = bills.requestBody.content['application/json'].schema;
      assert.ok(JSON.stringify(json.data.components.schemas).includes('openedAt'), JSON.stringify(body));
      for (const code of ['401', '404'])
        assert.ok(orders.responses[code], `orders documents ${code}`);
      for (const code of ['400', '404', '409'])
        assert.ok(bills.responses[code], `bills documents ${code}`);
      const base = await ctx.app.getUrl();
      const page = await fetch(`${base}/api/pos-docs`);
      assert.equal(page.status, 200);
      const html = await page.text();
      assert.match(html, /swagger/i);
      // helmet's CSP allows scripts from the same origin only: the page must not rely on an inline script
      assert.deepEqual(html.match(/<script(?![^>]*\bsrc=)[^>]*>/g) ?? [], [], 'no inline script');
      for (const file of ['swagger-ui-init.js', 'swagger-ui-bundle.js'])
        assert.equal((await fetch(`${base}/api/pos-docs/${file}`)).status, 200, file);
    });

    await t.test('the full docs need an ADMIN session', async () => {
      assert.equal((await request('/docs-json')).status, 401, 'no cookie');
      for (const who of ['staff', 'stock', 'cashier', 'manager'])
        assert.equal((await request('/docs-json', 'GET', undefined, cookies[who])).status, 403, who);
      const base = await ctx.app.getUrl();
      assert.equal((await fetch(`${base}/api/docs`)).status, 401);
      const page = await fetch(`${base}/api/docs`, { headers: { Cookie: cookies.staff } });
      assert.equal(page.status, 403);
      const ok = await fetch(`${base}/api/docs`, { headers: { Cookie: cookies.admin } });
      assert.equal(ok.status, 200);
      assert.match(await ok.text(), /swagger/i);
      const asset = await fetch(`${base}/api/docs/swagger-ui-bundle.js`);
      assert.equal(asset.status, 401, 'the assets are behind the same gate');
    });

    await t.test('the full document lists the endpoints, grouped, without leaking secrets', async () => {
      const res = await request('/docs-json', 'GET', undefined, cookies.admin);
      assert.equal(res.status, 200);
      const paths = Object.keys(res.data.paths);
      for (const p of [
        '/api/auth/login',
        '/api/sessions',
        '/api/products',
        '/api/categories',
        '/api/payment-methods',
        '/api/customer-types',
        '/api/settings',
        '/api/admin/warroom-sync/run',
        '/api/admin/warroom-sync/reset-catalog',
        '/api/integrations/pos/orders',
      ])
        assert.ok(paths.includes(p), `${p} is documented`);
      assert.ok(paths.length > 40, `${paths.length} paths`);
      assert.ok(!paths.some((p) => p.startsWith('/api/docs') || p.startsWith('/api/pos-docs')), 'the docs are not in the docs');
      assert.ok(res.data.tags.some((tag) => tag.name === 'Categories'));
      const tagged = res.data.paths['/api/categories'].get.tags;
      assert.deepEqual(tagged, ['Categories']);
      const text = JSON.stringify(res.data);
      assert.ok(!/postgres:\/\/|mysql:\/\//.test(text), 'no connection strings');
      assert.equal(res.data.components.securitySchemes.cookie.name, 'se_session');
    });
  } finally {
    await cleanup(ctx, world);
  }
});
