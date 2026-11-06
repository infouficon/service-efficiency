/** The branch catalog as the product pickers use it (SkuPicker, D107): types, the API shape, stock rules, the model list. */

/** A SKU as the branch product list returns it (D41, D52, D59). */
export interface CatalogSku {
  id: string;
  sku: string;
  name: string;
  color?: string | null;
  storage?: string | null;
  /** memory (RAM) of a Mac, e.g. "16GB" (D79) */
  memory?: string | null;
  stock?: number;
  stockSource?: 'unlimited' | 'erp' | 'manual';
  erpAsOf?: string | null;
}
export interface CatalogModel {
  id: string;
  name: string;
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
      if (skus.length > 0) models.push({ id: m.id, name: m.name, skus });
    }
    if (models.length > 0)
      out.push({ id: p.id, category: p.category, name: p.name, models });
  }
  return out;
}

/** No stock figure blocks a product while the ADMIN switch "stock unlimited" is on (D59). */
export const isUnlimited = (s: { stockSource?: string }) =>
  s.stockSource === 'unlimited';
export const isOutOfStock = (s: CatalogSku) =>
  !isUnlimited(s) && typeof s.stock === 'number' && s.stock <= 0;

/** One model of a category, as the model list shows it. */
export interface ModelChoice {
  key: string;
  product: CatalogProduct;
  model: CatalogModel;
  /** the product name under the model name, only where the model name alone does not say it (or two models share a name) */
  sub?: string;
}

/** The models of one category with something to sell, in name order so a series stays together (iPad Air…, iPad Pro…). */
export function modelChoices(catalog: CatalogProduct[] | null, category: string): ModelChoice[] {
  if (!catalog || !category) return [];
  const list: ModelChoice[] = [];
  for (const p of catalog) {
    if (p.category !== category) continue;
    for (const m of p.models) {
      if (m.skus.length > 0) list.push({ key: `${p.id}::${m.id}`, product: p, model: m });
    }
  }
  list.sort((a, b) =>
    a.model.name.localeCompare(b.model.name, 'en', { numeric: true, sensitivity: 'base' }),
  );
  for (const choice of list) {
    const firstWord = choice.product.name.trim().split(/\s+/)[0]?.toLowerCase() ?? '';
    const shared = list.filter(
      (other) => other.model.name.toLowerCase() === choice.model.name.toLowerCase(),
    ).length > 1;
    if (shared || !choice.model.name.toLowerCase().includes(firstWord)) choice.sub = choice.product.name;
  }
  return list;
}

export interface Picked {
  product: CatalogProduct;
  model: CatalogModel;
  sku: CatalogSku;
}
