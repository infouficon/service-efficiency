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

test('Watch modelChoices: models sharing series name are merged into a single card without subtitles (D148)', () => {
  const watchProduct = (name, models) => ({ id: name, category: 'Watch', name, models });
  const catalog = [
    watchProduct('S12 Alu Cell', [
      { id: 'm1', name: 'S12 42mm', skus: [{ id: 's1', sku: 's1', name: 'S12 42mm Cell' }] },
    ]),
    watchProduct('S12 Alu GPS', [
      { id: 'm2', name: 'Apple Watch Series 12', skus: [{ id: 's2', sku: 's2', name: 'S12 42mm GPS' }] },
    ]),
    watchProduct('S12 Alu Ceramic', [
      { id: 'm3', name: 'Apple Watch Series 12', skus: [{ id: 's3', sku: 's3', name: 'S12 Ceramic' }] },
    ]),
    watchProduct('S12 Alu Ti', [
      { id: 'm4', name: 'Apple Watch Series 12', skus: [{ id: 's4', sku: 's4', name: 'S12 Ti' }] },
    ]),
    watchProduct('SE3 (2026) GPS', [
      { id: 'm5', name: 'Apple Watch SE', skus: [{ id: 's5', sku: 's5', name: 'SE3 GPS' }] },
    ]),
  ];

  const choices = modelChoices(catalog, 'Watch');
  assert.equal(choices.length, 2);
  const s12 = choices.find((c) => c.model.name === 'Apple Watch Series 12');
  const se = choices.find((c) => c.model.name === 'Apple Watch SE');

  assert.ok(s12, 'Apple Watch Series 12 card exists');
  assert.ok(se, 'Apple Watch SE card exists');
  assert.equal(s12.sub, undefined, 'no confusing subtitle on merged Series 12 card');
  assert.equal(se.sub, undefined, 'no confusing subtitle on SE card');
  assert.equal(s12.model.skus.length, 4, 'all 4 S12 variant SKUs are combined into one model');
});
