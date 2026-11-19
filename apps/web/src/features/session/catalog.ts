/** The branch catalog as the product pickers use it (SkuPicker, D107): types, the API shape, stock rules, the model list. */
import type { Product } from '../../types/session';

/** Get the attribute value for a spec key from a SKU (D142) */
export function getSkuAttribute(s: CatalogSku, key: string): string {
  if (s.attributes && typeof s.attributes[key] === 'string' && s.attributes[key].trim()) {
    return s.attributes[key].trim();
  }
  if (key === 'color') return s.color?.trim() || '';
  if (key === 'storage') return s.storage?.trim() || '';
  if (key === 'memory') return s.memory?.trim() || '';
  return '';
}

/** A SKU as the branch product list returns it (D41, D52, D59). */
export interface CatalogSku {
  id: string;
  sku: string;
  name: string;
  color?: string | null;
  storage?: string | null;
  /** memory (RAM) of a Mac, e.g. "16GB" (D79) */
  memory?: string | null;
  price?: number | null;
  /** D142: dynamic specifications per category */
  attributes?: Record<string, string> | null;
  stock?: number;
  stockSource?: 'unlimited' | 'erp' | 'manual';
  erpAsOf?: string | null;
  /** Apple numbers its UPCs in launch order: the newest UPC of a model says how new it is (D109) */
  upc?: string | null;
}
export interface CatalogModel {
  id: string;
  name: string;
  /** D109: pinned by ADMIN to the top of the list (the last pinned first) */
  pinnedAt?: string | null;
  skus: CatalogSku[];
}
export interface CatalogProduct {
  id: string;
  category: string;
  name: string;
  models: CatalogModel[];
}

/** The shape of `GET /products` for a branch user: only what the picker needs, inactive records already dropped. */
export function toCatalog(data: unknown): CatalogProduct[] {
  if (!Array.isArray(data)) return [];
  const out: CatalogProduct[] = [];
  for (const p of data as Array<{
    id: string;
    category: string;
    name: string;
    active: boolean;
    models?: Array<{
      id: string;
      name: string;
      active: boolean;
      pinnedAt?: string | null;
      skus?: Array<CatalogSku & { active: boolean; branchActive?: boolean }>;
    }>;
  }>) {
    if (!p.active) continue;
    const models: CatalogModel[] = [];
    for (const m of p.models ?? []) {
      if (!m.active) continue;
      const skus = (m.skus ?? []).filter(
        (s) => s.active && s.branchActive !== false,
      );
      if (skus.length > 0)
        models.push({
          id: m.id,
          name: m.name,
          pinnedAt: m.pinnedAt ?? null,
          skus,
        });
    }
    if (models.length > 0)
      out.push({ id: p.id, category: p.category, name: p.name, models });
  }
  return out;
}

/** No stock figure blocks a product while the ADMIN switch "stock unlimited" is on (D59). */
export const isUnlimited = (s: { stockSource?: string }) =>
  s.stockSource === 'unlimited';
export const isOutOfStock = (s: {
  stockSource?: string;
  stock?: number | null;
}) => !isUnlimited(s) && typeof s.stock === 'number' && s.stock <= 0;

/** One model of a category, as the model list shows it. */
export interface ModelChoice {
  key: string;
  product: CatalogProduct;
  model: CatalogModel;
  /** the product name under the model name, only where the model name alone does not say it (or two models share a name) */
  sub?: string;
  /** minimum price of this model's active skus (null if none have price) */
  minPrice?: number | null;
}

/** Formats a numeric price to Thai Baht currency string (e.g. ฿37,900) */
export function formatPrice(price: number | null | undefined): string | null {
  if (typeof price !== 'number' || Number.isNaN(price) || price <= 0)
    return null;
  return `฿${price.toLocaleString('th-TH')}`;
}

/** The newest numeric UPC of a model (UPC-A / EAN / GTIN), as a number for ordering; 0 when it has none (e.g. a CTO Mac). */
function newestUpc(model: CatalogModel): number {
  return Math.max(
    0,
    ...model.skus.map((s) =>
      /^\d{12,14}$/.test(s.upc?.trim() ?? '') ? Number(s.upc) : 0,
    ),
  );
}

/**
 * The models of one category with something to sell, new to old (D109): the ones ADMIN pinned first (the last pinned on top),
 * then by the newest UPC (Apple numbers them in launch order), then by name.
 */
export function modelChoices(
  catalog: CatalogProduct[] | null,
  category: string,
): ModelChoice[] {
  if (!catalog || !category) return [];
  const list: ModelChoice[] = [];
  for (const p of catalog) {
    if (p.category !== category) continue;
    for (const m of p.models) {
      if (m.skus.length > 0) {
        const prices = m.skus
          .map((s) => s.price)
          .filter((val): val is number => typeof val === 'number' && val > 0);
        const minPrice = prices.length > 0 ? Math.min(...prices) : null;
        list.push({ key: `${p.id}::${m.id}`, product: p, model: m, minPrice });
      }
    }
  }
  const pinned = (c: ModelChoice) =>
    c.model.pinnedAt ? Date.parse(c.model.pinnedAt) || 0 : 0;
  list.sort(
    (a, b) =>
      pinned(b) - pinned(a) ||
      newestUpc(b.model) - newestUpc(a.model) ||
      a.model.name.localeCompare(b.model.name, 'en', {
        numeric: true,
        sensitivity: 'base',
      }),
  );
  for (const choice of list) {
    const firstWord =
      choice.product.name.trim().split(/\s+/)[0]?.toLowerCase() ?? '';
    const shared =
      list.filter(
        (other) =>
          other.model.name.toLowerCase() === choice.model.name.toLowerCase(),
      ).length > 1;
    if (shared || !choice.model.name.toLowerCase().includes(firstWord))
      choice.sub = choice.product.name;
  }
  return list;
}

export interface Picked {
  product: CatalogProduct;
  model: CatalogModel;
  sku: CatalogSku;
}

/** The catalog entry an item stands for (`id` = the SKU id). */
export function toProduct(
  p: CatalogProduct,
  m: CatalogModel,
  s: CatalogSku,
): Product {
  return {
    id: s.id,
    category: p.category,
    product: p.name,
    model: s.name || m.name,
    modelName: m.name,
    sku: s.sku,
    price: s.price,
    stock: s.stock,
    stockSource: s.stockSource,
    erpAsOf: s.erpAsOf,
    branchActive: true,
  };
}
