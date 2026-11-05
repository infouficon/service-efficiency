import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const conf = readFileSync(new URL('../nginx.conf.template', import.meta.url), 'utf8');

test('nginx: /api/ is a ^~ prefix, so the assets regex never takes API files (the Swagger UI was a blank page, D84)', () => {
  assert.match(conf, /location \^~ \/api\/ \{/);
  assert.doesNotMatch(conf, /location \/api\/ \{/);
  // the static-assets rule still exists for the SPA's own files
  assert.match(conf, /location ~\* \\\.\(\?:css\|js\|/);
});

test('nginx: a missing asset is 503 no-store, never a 404 Cloudflare would cache (H-39)', () => {
  assert.match(conf, /try_files \$uri @asset_missing;/);
  assert.doesNotMatch(conf, /try_files \$uri =404;/);
  const missing = conf.slice(conf.indexOf('location @asset_missing'));
  assert.match(missing, /add_header Cache-Control "no-store" always;/);
  assert.match(missing, /return 503;/);
});
