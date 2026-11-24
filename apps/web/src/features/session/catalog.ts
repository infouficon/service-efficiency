/** The branch catalog as the product pickers use it (SkuPicker, D107): types, the API shape, stock rules, the model list. */
import type { Product } from '../../types/session';

/** Get the attribute value for a spec key from a SKU (D142, D157, D188) */
export function getSkuAttribute(s: CatalogSku, key: string): string {
  let val = '';
  if (s.attributes && typeof s.attributes[key] === 'string' && s.attributes[key].trim()) {
    val = s.attributes[key].trim();
  } else if (key === 'color') {
    val = s.color?.trim() || '';
    if (!val && s.name) {
      const parts = s.name.split(/[-–—]/);
      if (parts.length > 1) {
        val = parts[parts.length - 1].replace(/\([^)]*\)/g, '').trim();
      } else {
        const parenMatch = s.name.match(/\(([^)]+)\)$/);
        if (parenMatch && !/\b\d+\s*(?:m|cm|gb|tb|w)\b/i.test(parenMatch[1])) {
          val = parenMatch[1].trim();
        } else {
          const colorMatch = s.name.match(
            /\b(Black|White|Stone|Light Blue|Dark Grey|Dark Gray|Sierra Blue|Midnight|Starlight|Pink|Red|Yellow|Green|Blue|Purple|Orange|Silver|Space Gray|Space Grey|Space Black|Natural Titanium|Desert Titanium|Teal|Ultramarine)\b/i,
          );
          if (colorMatch) {
            val = colorMatch[1].trim();
          }
        }
      }
    }
  } else if (key === 'storage') {
    val = s.storage?.trim() || '';
  } else if (key === 'memory') {
    val = s.memory?.trim() || '';
  } else if (key === 'caseSize') {
    const raw = (s as unknown as Record<string, unknown>).caseSize;
    if (typeof raw === 'string') val = raw.trim();
    if (!val && s.name) {
      const m = s.name.match(/\b(38|40|41|42|44|45|46|49)\s*mm\b/i);
      if (m) val = `${m[1]}mm`;
    }
  } else if (key === 'band') {
    const raw = (s as unknown as Record<string, unknown>).band;
    if (typeof raw === 'string') val = raw.trim();
    if (!val && s.name) {
      if (/braided\s*solo\s*loop/i.test(s.name)) val = 'Braided Solo Loop';
      else if (/solo\s*loop/i.test(s.name)) val = 'Solo Loop';
      else if (/sport\s*loop/i.test(s.name)) val = 'Sport Loop';
      else if (/sport\s*band/i.test(s.name)) val = 'Sport Band';
      else if (/milanese\s*loop/i.test(s.name)) val = 'Milanese Loop';
      else if (/alpine\s*loop/i.test(s.name)) val = 'Alpine Loop';
      else if (/trail\s*loop/i.test(s.name)) val = 'Trail Loop';
      else if (/ocean\s*band/i.test(s.name)) val = 'Ocean Band';
      else if (/link\s*bracelet/i.test(s.name)) val = 'Link Bracelet';
      else if (/magnetic\s*link/i.test(s.name)) val = 'Magnetic Link';
      else if (/modern\s*buckle/i.test(s.name)) val = 'Modern Buckle';
    }
  } else if (key === 'bandSize') {
    const raw = (s as unknown as Record<string, unknown>).bandSize;
    if (typeof raw === 'string') val = raw.trim();
    if (!val && s.name) {
      const sm = s.name.match(/\b(S\/M|M\/L)\b/i);
      if (sm) val = sm[1].toUpperCase();
      else {
        const sz = s.name.match(/\bSize\s*(\d{1,2})\b/i);
        if (sz) val = `Size ${sz[1]}`;
      }
    }
  } else if (key === 'wattage') {
    const raw = (s as unknown as Record<string, unknown>).wattage;
    if (typeof raw === 'string') val = raw.trim();
    if (!val && s.name) {
      const w = s.name.match(/\b(\d+)\s*W\b/i);
      if (w) val = `${w[1]}W`;
    }
  } else if (key === 'touchId') {
    if (s.name) {
      val = /touch\s*id/i.test(s.name) ? 'มี Touch ID' : 'ไม่มี Touch ID';
    }
  } else if (key === 'numericKeypad') {
    if (s.name) {
      val = /numeric\s*keypad/i.test(s.name) ? 'มี Numeric Keypad' : 'ไม่มี Numeric Keypad';
    }
  } else if (key === 'language') {
    if (s.name) {
      if (/thai/i.test(s.name) || /th\/[a-z]/i.test(s.sku || '')) val = 'Thai';
      else if (/us|english/i.test(s.name) || /ll\/[a-z]/i.test(s.sku || '') || /za\/[a-z]/i.test(s.sku || '')) val = 'US English';
    }
  } else if (key === 'caseType' || key === 'type') {
    if (s.name) {
      if (/silicone(?:\s*case)?/i.test(s.name)) val = 'Silicone Case with MagSafe';
      else if (/clear(?:\s*case)?/i.test(s.name)) val = 'Clear Case with MagSafe';
      else if (/finewoven(?:\s*case)?/i.test(s.name)) val = 'FineWoven Case with MagSafe';
      else if (/leather(?:\s*case)?/i.test(s.name)) val = 'Leather Case';
      else if (/smart\s*folio/i.test(s.name)) val = 'Smart Folio';
      else if (/magic\s*keyboard/i.test(s.name)) val = 'Magic Keyboard';
      else if (/key\s*ring/i.test(s.name)) val = 'FineWoven Key Ring';
      else if (/loop/i.test(s.name)) val = 'AirTag Loop';
      else if (/crossbody/i.test(s.name)) val = 'Crossbody Strap';
      else if (/wrist/i.test(s.name)) val = 'Wrist Strap';
      else if (/wallet/i.test(s.name)) val = 'FineWoven Wallet with MagSafe';
    }
  }

  if (key === 'color' && val) {
    // D157: Clean any leaked glass specifications like "with standard glass"
    const cleaned = val
      .replace(/\b(?:with\s+)?(?:standard|nano-?texture)(?:\s+glass)?\b/gi, '')
      .replace(/^[-–·:/\s]+|[-–·:/\s]+$/g, '')
      .trim();
    return cleaned || val;
  }
  return val;
}

/** D149: Canonical Mac family classification types */
export const MAC_TYPES = ['iMac', 'Mac Studio', 'Mac mini', 'MacBook'] as const;
export type MacType = (typeof MAC_TYPES)[number];

export function getMacType(modelName: string): MacType | null {
  const name = modelName.trim();
  if (/\bimac\b/i.test(name)) return 'iMac';
  if (/\bmac\s*studio\b/i.test(name)) return 'Mac Studio';
  if (/\bmac\s*mini\b/i.test(name)) return 'Mac mini';
  if (/\bmacbook\b/i.test(name)) return 'MacBook';
  return null;
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
      const skus = (m.skus ?? [])
        .filter((s) => s.active && s.branchActive !== false)
        .map((s) => {
          const colorClean = s.color ? getSkuAttribute(s, 'color') : s.color;
          let attributes = s.attributes;
          if (attributes && attributes.color) {
            attributes = {
              ...attributes,
              color: getSkuAttribute(s, 'color') || attributes.color,
            };
          }
          return {
            ...s,
            color: colorClean,
            attributes,
          };
        });
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
 * D150: Canonical model name for Mac by family and screen size
 * (e.g. "iMac 24\"", "MacBook Air 13\"", "MacBook Pro 14\"", "Mac mini", "Mac Studio")
 */
export function macModelOf(...texts: (string | null | undefined)[]): string | null {
  for (const t of texts) {
    const text = (t ?? '').trim();
    if (!text) continue;

    // iMac
    if (/\bimac\b/i.test(text)) {
      if (/\b24\b/i.test(text)) return 'iMac 24"';
      if (/\b27\b/i.test(text)) return 'iMac 27"';
      if (/\b21(?:\.5)?\b/i.test(text)) return 'iMac 21.5"';
      return 'iMac';
    }

    // Mac Studio
    if (/\bmac\s*studio\b/i.test(text)) {
      return 'Mac Studio';
    }

    // Mac mini
    if (/\bmac\s*mini\b/i.test(text)) {
      return 'Mac mini';
    }

    // Mac Pro
    if (/\bmac\s*pro\b/i.test(text) && !/\bmacbook\b/i.test(text)) {
      return 'Mac Pro';
    }

    // MacBook Air
    if (/\bmacbook\s*air\b/i.test(text)) {
      if (/\b15(?:\.3)?\b/i.test(text)) return 'MacBook Air 15"';
      if (/\b13(?:\.[36])?\b/i.test(text)) return 'MacBook Air 13"';
      if (/\b11(?:\.6)?\b/i.test(text)) return 'MacBook Air 11"';
      return 'MacBook Air';
    }

    // MacBook Pro
    if (/\bmacbook\s*pro\b/i.test(text)) {
      if (/\b16(?:\.2)?\b/i.test(text)) return 'MacBook Pro 16"';
      if (/\b14(?:\.2)?\b/i.test(text)) return 'MacBook Pro 14"';
      if (/\b13(?:\.3)?\b/i.test(text)) return 'MacBook Pro 13"';
      if (/\b15(?:\.4)?\b/i.test(text)) return 'MacBook Pro 15"';
      return 'MacBook Pro';
    }

    // Other MacBook
    if (/\bmacbook\b/i.test(text)) {
      if (/\bneo\b/i.test(text)) return 'MacBook Neo';
      if (/\b12\b/i.test(text)) return 'MacBook 12"';
      return 'MacBook';
    }
  }
  return null;
}

/**
 * D148: Canonical series model name for Apple Watch (e.g. "Apple Watch Series 12", "Apple Watch Ultra 2", "Apple Watch SE")
 */
export function normalizeWatchModelName(name: string): string {
  const text = name.trim();
  if (/(?:Apple\s+)?Watch\s+Ultra\s*2\b/i.test(text) || /\bUltra\s*2\b/i.test(text)) {
    return 'Apple Watch Ultra 2';
  }
  if (/(?:Apple\s+)?Watch\s+Ultra\b/i.test(text) || /\bUltra\b/i.test(text)) {
    return 'Apple Watch Ultra';
  }
  const seriesMatch =
    text.match(/(?:Apple\s+)?Watch\s+(?:Series\s+|S\s*)(\d{1,2})\b/i) ||
    text.match(/\b(?:Series\s+|S\s*)(\d{1,2})\b/i);
  if (seriesMatch) {
    return `Apple Watch Series ${seriesMatch[1]}`;
  }
  if (
    /(?:Apple\s+)?Watch\s+SE\b/i.test(text) ||
    /\bApple\s+Watch\s+SE\b/i.test(text) ||
    /\bSE\s*\d*\b/i.test(text)
  ) {
    return 'Apple Watch SE';
  }
  if (/Herm[eè]s/i.test(text)) {
    return 'Apple Watch Hermès';
  }
  return text;
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
  // D148: For Watch, normalize series names and merge duplicate models into a single canonical model card
  if (category.toLowerCase() === 'watch') {
    const mergedByName = new Map<string, ModelChoice>();
    for (const choice of list) {
      const canonicalName = normalizeWatchModelName(choice.model.name);
      const key = canonicalName.toLowerCase();
      const existing = mergedByName.get(key);
      if (existing) {
        existing.model = {
          ...existing.model,
          name: canonicalName,
          skus: [
            ...existing.model.skus,
            ...choice.model.skus.filter((s) => !existing.model.skus.some((es) => es.id === s.id)),
          ],
        };
      } else {
        mergedByName.set(key, {
          ...choice,
          product: {
            ...choice.product,
            name: canonicalName,
          },
          model: {
            ...choice.model,
            name: canonicalName,
          },
        });
      }
    }
    list.length = 0;
    list.push(...mergedByName.values());
  }

  // D150: For Mac, normalize model names and merge duplicate models into a single canonical model card
  if (category.toLowerCase() === 'mac') {
    const mergedByName = new Map<string, ModelChoice>();
    for (const choice of list) {
      const canonicalName = macModelOf(choice.model.name, choice.product.name) ?? choice.model.name;
      const key = canonicalName.toLowerCase();
      const existing = mergedByName.get(key);
      if (existing) {
        existing.model = {
          ...existing.model,
          name: canonicalName,
          skus: [
            ...existing.model.skus,
            ...choice.model.skus.filter((s) => !existing.model.skus.some((es) => es.id === s.id)),
          ],
        };
      } else {
        mergedByName.set(key, {
          ...choice,
          product: {
            ...choice.product,
            name: canonicalName,
          },
          model: {
            ...choice.model,
            name: canonicalName,
          },
        });
      }
    }
    list.length = 0;
    list.push(...mergedByName.values());
  }

  const pinned = (c: ModelChoice) => (c.model.pinnedAt ? Date.parse(c.model.pinnedAt) || 0 : 0);
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

/**
 * D152, D154: Extract real accessory groups (sub-categories / product names) from catalog
 * combined with fallback options and currently selected keys.
 * Ensures the full list of accessory groups remains available even when items are selected.
 */
export function extractAccessoryGroups(
  catalog: CatalogProduct[] | null | undefined,
  accessoryCategoryNames: Set<string>,
  fallback: readonly string[] = [],
  selectedKeys: readonly string[] = [],
): string[] {
  const namesSet = new Set<string>();
  // 1. Always include fallback options so full list never disappears
  for (const item of fallback) {
    if (item && item.trim()) {
      namesSet.add(item.trim());
    }
  }
  // 2. Include catalog accessory products
  if (catalog && catalog.length > 0) {
    for (const p of catalog) {
      if (accessoryCategoryNames.has(p.category)) {
        if (p.name && p.name.trim()) {
          namesSet.add(p.name.trim());
        }
      }
    }
  }
  // 3. Include any selected keys
  for (const k of selectedKeys) {
    if (k && k.trim()) {
      namesSet.add(k.trim());
    }
  }
  return Array.from(namesSet).sort((a, b) => a.localeCompare(b, 'th'));
}

/**
 * D153: Format specific accessory item name with SKU part number:
 * e.g. "iPhone 13 Silicone Case with MagSafe - Marigold (MM243FE/A)"
 */
export function formatAccessoryItemName(model: CatalogModel, sku: CatalogSku): string {
  const base = sku.name?.trim() || model.name?.trim() || sku.sku;
  const partNo = sku.sku?.trim();
  if (partNo && !base.includes(partNo)) {
    return `${base} (${partNo})`;
  }
  return base;
}

/**
 * Check whether a chosen accessory key belongs to a specific catalog product.
 */
export function isAccessoryFromProduct(product: CatalogProduct, accessoryKey: string): boolean {
  const keyLower = accessoryKey.toLowerCase();
  if (product.name && keyLower.includes(product.name.toLowerCase())) {
    return true;
  }
  for (const m of product.models) {
    if (m.name && keyLower.includes(m.name.toLowerCase())) {
      return true;
    }
    for (const s of m.skus) {
      if (s.sku && accessoryKey.includes(s.sku)) {
        return true;
      }
      if (s.name && keyLower.includes(s.name.toLowerCase())) {
        return true;
      }
    }
  }
  return false;
}
