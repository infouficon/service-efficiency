import assert from 'node:assert/strict';
import { test } from 'node:test';
import { modelChoices } from '../src/features/session/catalog.ts';

const model = (name, upcs, pinnedAt = null) => ({
  id: name,
  name,
  pinnedAt,
  skus: upcs.map((upc, i) => ({ id: `${name}-${i}`, sku: `${name}-${i}`, name, upc })),
});
const product = (name, models) => ({ id: name, category: 'iPhone', name, models });

test('models new to old: pinned first (last pinned on top), then the newest UPC, then the name (D109)', () => {
  const catalog = [
    product('iPhone 15', [model('iPhone 15', ['195949036071'])]),
    product('iPhone 18 Pro', [model('iPhone 18 Pro', ['195951419343', '195951419497'])]),
    product('iPhone Duo', [model('iPhone Duo', ['195951406091'])]),
    product('iPhone 17e', [model('iPhone 17e', ['195951030609'])]),
    product('iPhone Air', [model('iPhone Air', [null, 'not-a-upc'])]),
  ];
  const names = (list) => list.map((c) => c.model.name);
  assert.deepEqual(names(modelChoices(catalog, 'iPhone')), ['iPhone 18 Pro', 'iPhone Duo', 'iPhone 17e', 'iPhone 15', 'iPhone Air']);

  catalog[2].models[0].pinnedAt = '2026-11-06T10:00:00.000Z';
  catalog[0].models[0].pinnedAt = '2026-11-01T10:00:00.000Z';
  assert.deepEqual(names(modelChoices(catalog, 'iPhone')), ['iPhone Duo', 'iPhone 15', 'iPhone 18 Pro', 'iPhone 17e', 'iPhone Air']);
  assert.deepEqual(modelChoices(catalog, 'iPad'), []);
});
