import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  extractAccessoryGroups,
  formatAccessoryItemName,
  formatPrice,
  getMacType,
  isAccessoryFromProduct,
  MAC_TYPES,
  modelChoices,
} from '../src/features/session/catalog.ts';

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

test('Mac family classification: iMac, Mac Studio, Mac mini, MacBook (D149)', () => {
  assert.deepEqual(MAC_TYPES, ['iMac', 'Mac Studio', 'Mac mini', 'MacBook']);

  assert.equal(getMacType('iMac 24 M4'), 'iMac');
  assert.equal(getMacType('iMac (24-inch, M3)'), 'iMac');

  assert.equal(getMacType('Mac Studio M2 Max'), 'Mac Studio');
  assert.equal(getMacType('Mac Studio M2 Ultra'), 'Mac Studio');

  assert.equal(getMacType('Mac mini M4'), 'Mac mini');
  assert.equal(getMacType('Mac mini M4 Pro'), 'Mac mini');

  assert.equal(getMacType('MacBook Air 13 M3'), 'MacBook');
  assert.equal(getMacType('MacBook Air 15 M3'), 'MacBook');
  assert.equal(getMacType('MacBook Pro 14 M4'), 'MacBook');
  assert.equal(getMacType('MacBook Pro 16 M4 Pro'), 'MacBook');
  assert.equal(getMacType('MacBook Neo A18 Pro'), 'MacBook');
});

test('Mac modelChoices: models sharing family and size are merged into a single card without subtitles (D150)', () => {
  const macProduct = (name, models) => ({ id: name, category: 'Mac', name, models });
  const catalog = [
    macProduct('iMac 24', [
      { id: 'm1', name: 'IMAC 24 M6 512TB', skus: [{ id: 's1', sku: 's1', name: '512GB Silver' }] },
      { id: 'm2', name: 'IMAC 24 M6 256TB', skus: [{ id: 's2', sku: 's2', name: '256GB Blue' }] },
      { id: 'm3', name: 'iMac 24 M4 (CTO)', skus: [{ id: 's3', sku: 's3', name: '1TB Orange' }] },
    ]),
    macProduct('MacBook Air', [
      { id: 'm4', name: 'Macbook Air M5 13.6', skus: [{ id: 's4', sku: 's4', name: '512GB Midnight' }] },
      { id: 'm5', name: 'Macbook Air M5 15.3', skus: [{ id: 's5', sku: 's5', name: '512GB Starlight' }] },
    ]),
  ];

  const choices = modelChoices(catalog, 'Mac');
  assert.equal(choices.length, 3);
  const imac = choices.find((c) => c.model.name === 'iMac 24"');
  const mba13 = choices.find((c) => c.model.name === 'MacBook Air 13"');
  const mba15 = choices.find((c) => c.model.name === 'MacBook Air 15"');

  assert.ok(imac, 'iMac 24" card exists');
  assert.ok(mba13, 'MacBook Air 13" card exists');
  assert.ok(mba15, 'MacBook Air 15" card exists');

  assert.equal(imac.sub, undefined, 'no subtitle on unified iMac 24" card');
  assert.equal(imac.model.skus.length, 3, 'all 3 iMac SKUs merged into one model');
});

test('extractAccessoryGroups: extracts real groups from catalog, retains selected, and preserves all options (D152, D154)', () => {
  const fallback = ['Apple Pencil', 'Case', 'Magic Mouse'];
  const accCategory = new Set(['Accessories', 'Custom Accessory']);

  // 1. When catalog is empty, uses fallback
  assert.deepEqual(extractAccessoryGroups([], accCategory, fallback), ['Apple Pencil', 'Case', 'Magic Mouse']);
  assert.deepEqual(extractAccessoryGroups(null, accCategory, fallback), ['Apple Pencil', 'Case', 'Magic Mouse']);

  // 2. Extracts real sub-categories/product names from accessory categories and preserves fallback
  const catalog = [
    { id: '1', category: 'Accessories', name: 'Power Adapter', models: [] },
    { id: '2', category: 'Accessories', name: 'USB-C Cable', models: [] },
    { id: '3', category: 'Accessories', name: 'AirTag Case', models: [] },
    { id: '4', category: 'Custom Accessory', name: 'Screen Protector', models: [] },
    { id: '5', category: 'iPhone', name: 'iPhone 16', models: [] }, // not an accessory
  ];

  const groups = extractAccessoryGroups(catalog, accCategory, fallback);
  assert.deepEqual(
    groups.sort(),
    ['AirTag Case', 'Apple Pencil', 'Case', 'Magic Mouse', 'Power Adapter', 'Screen Protector', 'USB-C Cable'].sort(),
  );

  // 3. Retains already selected accessories even if not in catalog and never drops fallback (D154)
  const withSelected = extractAccessoryGroups([], accCategory, fallback, ['Apple Pencil']);
  assert.deepEqual(withSelected, ['Apple Pencil', 'Case', 'Magic Mouse']);

  const withCustomSelected = extractAccessoryGroups(catalog, accCategory, fallback, ['Old Custom Accessory']);
  assert.ok(withCustomSelected.includes('Old Custom Accessory'));
  assert.ok(withCustomSelected.includes('Power Adapter'));
  assert.ok(withCustomSelected.includes('Apple Pencil'));

  // 4. D156: When fallback is omitted or empty, strictly only catalog accessory items and selected keys are returned
  const realOnly = extractAccessoryGroups(catalog, accCategory, [], ['Custom Picked Item']);
  assert.deepEqual(
    realOnly.sort(),
    ['AirTag Case', 'Custom Picked Item', 'Power Adapter', 'Screen Protector', 'USB-C Cable'].sort(),
  );
});

test('formatAccessoryItemName and isAccessoryFromProduct: format descriptive name with SKU and match product (D153)', () => {
  const model = { id: 'm1', name: 'iPhone Case for iPhone 13', skus: [] };
  const sku1 = {
    id: 's1',
    sku: 'MM243FE/A',
    name: 'iPhone 13 Silicone Case with MagSafe - Marigold',
  };
  const sku2 = {
    id: 's2',
    sku: 'MM244FE/A',
    name: 'Clear Case',
  };

  // 1. If sku name already contains relevant terms, format cleanly with (SKU)
  const name1 = formatAccessoryItemName(model, sku1);
  assert.equal(name1, 'iPhone 13 Silicone Case with MagSafe - Marigold (MM243FE/A)');

  // 2. Formats with sku name and part number
  const name2 = formatAccessoryItemName(model, sku2);
  assert.equal(name2, 'Clear Case (MM244FE/A)');

  // 3. isAccessoryFromProduct matches product name, model name, or SKU part number
  const product = {
    id: 'p1',
    category: 'Accessories',
    name: 'iPhone Case',
    models: [model],
  };
  model.skus = [sku1, sku2];

  assert.equal(isAccessoryFromProduct(product, name1), true);
  assert.equal(isAccessoryFromProduct(product, name2), true);
  assert.equal(isAccessoryFromProduct(product, 'USB-C to Lightning Cable'), false);
});
