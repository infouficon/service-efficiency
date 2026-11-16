import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatPrice, modelChoices } from '../src/features/session/catalog.ts';

const model = (name, upcs, pinnedAt = null) => ({
  id: name,
  name,
  pinnedAt,
  skus: upcs.map((upc, i) => ({
    id: `${name}-${i}`,
    sku: `${name}-${i}`,
    name,
    upc,
  })),
});
const product = (name, models) => ({
  id: name,
  category: 'iPhone',
  name,
  models,
});

test('models new to old: pinned first (last pinned on top), then the newest UPC, then the name (D109)', () => {
  const catalog = [
    product('iPhone 15', [model('iPhone 15', ['195949036071'])]),
    product('iPhone 18 Pro', [
      model('iPhone 18 Pro', ['195951419343', '195951419497']),
    ]),
    product('iPhone Duo', [model('iPhone Duo', ['195951406091'])]),
    product('iPhone 17e', [model('iPhone 17e', ['195951030609'])]),
    product('iPhone Air', [model('iPhone Air', [null, 'not-a-upc'])]),
  ];
  const names = (list) => list.map((c) => c.model.name);
  assert.deepEqual(names(modelChoices(catalog, 'iPhone')), [
    'iPhone 18 Pro',
    'iPhone Duo',
    'iPhone 17e',
    'iPhone 15',
    'iPhone Air',
  ]);

  catalog[2].models[0].pinnedAt = '2026-11-06T10:00:00.000Z';
  catalog[0].models[0].pinnedAt = '2026-11-01T10:00:00.000Z';
  assert.deepEqual(names(modelChoices(catalog, 'iPhone')), [
    'iPhone Duo',
    'iPhone 15',
    'iPhone 18 Pro',
    'iPhone 17e',
    'iPhone Air',
  ]);
  assert.deepEqual(modelChoices(catalog, 'iPad'), []);
});

test('D145: modelChoices calculates minPrice and formatPrice formats currency correctly', () => {
  const catalog = [
    {
      id: 'p1',
      category: 'iPad',
      name: 'iPad Air',
      models: [
        {
          id: 'm1',
          name: 'iPad Air 11" (M4)',
          skus: [
            { id: 's1', sku: 'IPAD-128', name: 'iPad Air 128GB', price: 23900 },
            { id: 's2', sku: 'IPAD-256', name: 'iPad Air 256GB', price: 27900 },
          ],
        },
        {
          id: 'm2',
          name: 'iPad Air 13" (M4)',
          skus: [
            {
              id: 's3',
              sku: 'IPAD13-128',
              name: 'iPad Air 13 128GB',
              price: 37900,
            },
          ],
        },
        {
          id: 'm3',
          name: 'iPad Mini',
          skus: [
            { id: 's4', sku: 'MINI-64', name: 'iPad Mini 64GB', price: null },
          ],
        },
      ],
    },
  ];

  const choices = modelChoices(catalog, 'iPad');
  assert.equal(choices.length, 3);
  const m1Choice = choices.find((c) => c.model.name === 'iPad Air 11" (M4)');
  assert.equal(m1Choice.minPrice, 23900);

  const m2Choice = choices.find((c) => c.model.name === 'iPad Air 13" (M4)');
  assert.equal(m2Choice.minPrice, 37900);

  const m3Choice = choices.find((c) => c.model.name === 'iPad Mini');
  assert.equal(m3Choice.minPrice, null);

  assert.equal(formatPrice(23900), '฿23,900');
  assert.equal(formatPrice(37900), '฿37,900');
  assert.equal(formatPrice(null), null);
  assert.equal(formatPrice(0), null);
  assert.equal(formatPrice(undefined), null);
});
