import type { Product, ProductModel, ProductSKU } from '../types/session';

export const mockProductModels: ProductModel[] = [
  {
    id: 'm-ip16pm',
    category: 'iPhone',
    name: 'iPhone 16 Pro Max',
    code: 'IP16PM',
  },
  { id: 'm-ip16p', category: 'iPhone', name: 'iPhone 16 Pro', code: 'IP16P' },
  { id: 'm-ip16', category: 'iPhone', name: 'iPhone 16', code: 'IP16' },
  {
    id: 'm-ipadpro13',
    category: 'iPad',
    name: 'iPad Pro 13" (M4)',
    code: 'IPADPRO13',
  },
  {
    id: 'm-ipadair11',
    category: 'iPad',
    name: 'iPad Air 11" (M2)',
    code: 'IPADAIR11',
  },
  {
    id: 'm-mbp14',
    category: 'Mac',
    name: 'MacBook Pro 14" (M3 Pro)',
    code: 'MBP14',
  },
  {
    id: 'm-mba13',
    category: 'Mac',
    name: 'MacBook Air 13" (M3)',
    code: 'MBA13',
  },
  {
    id: 'm-aw10',
    category: 'Watch',
    name: 'Apple Watch Series 10',
    code: 'AW10',
  },
  {
    id: 'm-awu2',
    category: 'Watch',
    name: 'Apple Watch Ultra 2',
    code: 'AWU2',
  },
];

export const mockProductSKUs: ProductSKU[] = [
  {
    id: 'sku-1',
    modelId: 'm-ip16pm',
    modelName: 'iPhone 16 Pro Max',
    category: 'iPhone',
    sku: 'MYWU3TH/A',
    name: 'iPhone 16 Pro Max 256GB Desert Titanium',
    color: 'Desert Titanium',
    storage: '256GB',
  },
  {
    id: 'sku-2',
    modelId: 'm-ip16pm',
    modelName: 'iPhone 16 Pro Max',
    category: 'iPhone',
    sku: 'MYWV3TH/A',
    name: 'iPhone 16 Pro Max 512GB Natural Titanium',
    color: 'Natural Titanium',
    storage: '512GB',
  },
  {
    id: 'sku-3',
    modelId: 'm-ip16p',
    modelName: 'iPhone 16 Pro',
    category: 'iPhone',
    sku: 'MYND3TH/A',
    name: 'iPhone 16 Pro 128GB Black Titanium',
    color: 'Black Titanium',
    storage: '128GB',
  },
  {
    id: 'sku-4',
    modelId: 'm-ip16',
    modelName: 'iPhone 16',
    category: 'iPhone',
    sku: 'MYE73TH/A',
    name: 'iPhone 16 128GB Ultramarine',
    color: 'Ultramarine',
    storage: '128GB',
  },
  {
    id: 'sku-5',
    modelId: 'm-ipadpro13',
    modelName: 'iPad Pro 13" (M4)',
    category: 'iPad',
    sku: 'MVX23TH/A',
    name: 'iPad Pro 13" Wi-Fi 256GB Space Black',
    color: 'Space Black',
    storage: '256GB',
  },
  {
    id: 'sku-6',
    modelId: 'm-ipadair11',
    modelName: 'iPad Air 11" (M2)',
    category: 'iPad',
    sku: 'MUWD3TH/A',
    name: 'iPad Air 11" Wi-Fi 128GB Starlight',
    color: 'Starlight',
    storage: '128GB',
  },
  {
    id: 'sku-7',
    modelId: 'm-mbp14',
    modelName: 'MacBook Pro 14" (M3 Pro)',
    category: 'Mac',
    sku: 'MRX33TH/A',
    name: 'MacBook Pro 14" M3 Pro 18GB/512GB Space Black',
    color: 'Space Black',
    storage: '512GB',
  },
  {
    id: 'sku-8',
    modelId: 'm-mba13',
    modelName: 'MacBook Air 13" (M3)',
    category: 'Mac',
    sku: 'MRXN3TH/A',
    name: 'MacBook Air 13" M3 8-core CPU 8GB/256GB Midnight',
    color: 'Midnight',
    storage: '256GB',
  },
  {
    id: 'sku-9',
    modelId: 'm-aw10',
    modelName: 'Apple Watch Series 10',
    category: 'Watch',
    sku: 'MWW73TH/A',
    name: 'Apple Watch Series 10 GPS 46mm Jet Black Sport Band',
    color: 'Jet Black',
    storage: '64GB',
  },
];

export const products: Product[] = mockProductSKUs.map((sku) => ({
  id: sku.id,
  category: sku.category,
  product: sku.modelName,
  model: sku.name,
  sku: sku.sku,
}));

export const referenceForPreview = (index: number) =>
  `SES-20260925-${String(index).padStart(6, '0')}`;

export const emptySelection = () => ({
  product: null,
  accessories: {},
  ontop: [],
  points: [],
  burnPoints: [],
  payments: [],
});
