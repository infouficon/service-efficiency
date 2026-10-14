import { useEffect, useMemo, useState } from 'react';
import {
  Smartphone,
  Tablet,
  Laptop,
  Watch,
  Box,
  ArrowRight,
  Headphones,
  Plus,
  X,
} from 'lucide-react';
import {
  accessories,
  deviceCategories,
  ontop,
  payments,
  points,
} from '../../constants/options';
import type { Category, Product, Selection } from '../../types/session';
import { MultiSelect, Button, Notice } from '../../components/ui';
import {
  addItem,
  itemName,
  itemsText,
  quantitiesAreValid,
  quantityIsValid,
  stepAccessory,
  stepItem,
  toggleAccessory,
} from './workflow';
import {
  fetchCategoriesApi,
  fetchPaymentMethodsApi,
  fetchProductsApi,
} from '../../services/sessionApi';

function getCategoryIcon(cat: string, size = 16) {
  switch (cat) {
    case 'iPhone':
      return <Smartphone size={size} />;
    case 'iPad':
      return <Tablet size={size} />;
    case 'Mac':
      return <Laptop size={size} />;
    case 'Watch':
      return <Watch size={size} />;
    case 'Accessories':
      return <Headphones size={size} />;
    default:
      return <Box size={size} />;
  }
}

/** A SKU as the branch product list returns it (D41, D52, D59). */
interface CatalogSku {
  id: string;
  sku: string;
  name: string;
  color?: string | null;
  storage?: string | null;
  stock?: number;
  stockSource?: 'unlimited' | 'erp' | 'manual';
  erpAsOf?: string | null;
}
interface CatalogModel {
  id: string;
  name: string;
  skus: CatalogSku[];
}
interface CatalogProduct {
  id: string;
  category: string;
  name: string;
  models: CatalogModel[];
}

/** The shape of `GET /products` for a branch user: only what the picker needs, inactive records already dropped. */
function toCatalog(data: unknown): CatalogProduct[] {
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

/** The catalog entry an item stands for (`id` = the SKU id). */
function toProduct(p: CatalogProduct, m: CatalogModel, s: CatalogSku): Product {
  return {
    id: s.id,
    category: p.category,
    product: p.name,
    model: s.name || m.name,
    sku: s.sku,
    stock: s.stock,
    stockSource: s.stockSource,
    erpAsOf: s.erpAsOf,
    branchActive: true,
  };
}

/** No stock figure blocks a product while the ADMIN switch "stock unlimited" is on (D59). */
const isUnlimited = (s: { stockSource?: string }) =>
  s.stockSource === 'unlimited';
const isOutOfStock = (s: CatalogSku) =>
  !isUnlimited(s) && typeof s.stock === 'number' && s.stock <= 0;

/** The line above the picker about how fresh the stock figures are (F16): unlimited, or the oldest warroom snapshot behind the numbers. */
function stockInfoLine(skus: CatalogSku[]): string {
  if (skus.some(isUnlimited))
    return 'Stock: ไม่จำกัด (โหมดชั่วคราว) เลือกสินค้าได้ทุกรายการ';
  const times = skus
    .filter((s) => s.stockSource === 'erp' && s.erpAsOf)
    .map((s) => new Date(s.erpAsOf as string).getTime())
    .filter((t) => Number.isFinite(t));
  if (times.length === 0) return '';
  const oldest = new Date(Math.min(...times)).toLocaleString('th-TH', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
  return `ข้อมูล Stock ณ ${oldest} (อัปเดตจาก ERP ทุกประมาณ 3 ชั่วโมง)`;
}

function StockBadge({ sku }: { sku: CatalogSku }) {
  if (!isUnlimited(sku) && typeof sku.stock !== 'number') return null;
  const unlimited = isUnlimited(sku);
  const out = isOutOfStock(sku);
  return (
    <span
      className="wizard-stock-badge"
      style={{
        backgroundColor: unlimited ? '#eff6ff' : out ? '#fee2e2' : '#ecfdf5',
        color: unlimited ? '#1d4ed8' : out ? '#b91c1c' : '#047857',
      }}
    >
      {unlimited
        ? 'Stock ไม่จำกัด'
        : out
          ? 'สินค้าหมด (0 ชิ้น)'
          : `คงเหลือ ${sku.stock} ชิ้น`}
    </span>
  );
}

function getSkuOptionLabel(s: CatalogSku): string {
  if (s.color && s.name) {
    if (s.name.toLowerCase().includes(s.color.toLowerCase())) {
      return s.color;
    }
    return `${s.name} (${s.color})`;
  }
  return s.color || s.name || 'มาตรฐาน';
}

function getSkuStockText(s: CatalogSku): string {
  if (isUnlimited(s)) return 'มีจำหน่าย';
  if (isOutOfStock(s)) return 'สินค้าหมด';
  if (typeof s.stock === 'number') return `คงเหลือ ${s.stock} ชิ้น`;
  return 'พร้อมจำหน่าย';
}

/**
 * Choosing the main products (F2, F3, D72): cascading dropdowns (Category → Model → Capacity → Color)
 * that adds to a list, each product with a `−` / `+` quantity stepper. Several main products can be added.
 */
export function SelectionEditor({
  value,
  onChange,
  onReview,
}: {
  value: Selection;
  onChange: (selection: Selection) => void;
  onReview: () => void;
}) {
  const [catalog, setCatalog] = useState<CatalogProduct[] | null>(null);
  const [loadError, setLoadError] = useState('');
  // F6: the payment methods ADMIN keeps; the built-in list is the fallback when they cannot be loaded
  const [paymentNames, setPaymentNames] = useState<readonly string[]>(payments);
  // D68: the categories ADMIN keeps; the four device lines are the fallback when they cannot be loaded
  const [categoryList, setCategoryList] = useState<Category[] | null>(null);
  const [open, setOpen] = useState(value.items.length === 0);
  // with nothing chosen the picker is always open
  const formOpen = open || value.items.length === 0;

  // Cascading dropdown states
  const [category, setCategory] = useState<string>('');
  const [modelKey, setModelKey] = useState<string>('');
  const [storage, setStorage] = useState<string>('');
  const [skuId, setSkuId] = useState<string>('');

  useEffect(() => {
    let active = true;
    fetchProductsApi()
      .then((data: unknown) => {
        if (active) setCatalog(toCatalog(data));
      })
      .catch((err: unknown) => {
        if (active)
          setLoadError(
            err instanceof Error ? err.message : 'โหลดรายการสินค้าไม่สำเร็จ',
          );
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    fetchCategoriesApi()
      .then((list) => {
        if (active) setCategoryList(list);
      })
      .catch(() => {
        // keep the built-in device lines
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    fetchPaymentMethodsApi()
      .then((list) => {
        if (active && list.length > 0) setPaymentNames(list.map((m) => m.name));
      })
      .catch(() => {
        // keep the built-in list
      });
    return () => {
      active = false;
    };
  }, []);

  // the main-product tiles: every active category that is not accessory-like (accessories have their own step below)
  const categoryTiles = useMemo<readonly string[]>(
    () =>
      categoryList
        ? categoryList.filter((c) => !c.isAccessory).map((c) => c.name)
        : deviceCategories,
    [categoryList],
  );

  // Available models for selected category
  const availableModels = useMemo(() => {
    if (!catalog || !category) return [];
    const list: {
      key: string;
      product: CatalogProduct;
      model: CatalogModel;
      displayName: string;
    }[] = [];
    for (const p of catalog) {
      if (p.category !== category) continue;
      for (const m of p.models) {
        if (!m.skus || m.skus.length === 0) continue;
        const displayName =
          p.name === m.name || m.name.toLowerCase().includes(p.name.toLowerCase())
            ? m.name
            : `${p.name} - ${m.name}`;
        list.push({
          key: `${p.id}::${m.id}`,
          product: p,
          model: m,
          displayName,
        });
      }
    }
    return list;
  }, [catalog, category]);

  // Selected model object
  const selectedModelObj = useMemo(() => {
    return availableModels.find((m) => m.key === modelKey) ?? null;
  }, [availableModels, modelKey]);

  // Available storages for selected model
  const availableStorages = useMemo(() => {
    if (!selectedModelObj) return [];
    const set = new Set<string>();
    for (const s of selectedModelObj.model.skus) {
      const st = s.storage?.trim();
      if (st) set.add(st);
    }
    return Array.from(set);
  }, [selectedModelObj]);

  const hasStorage = availableStorages.length > 0;

  // Candidate SKUs for selected model and storage
  const candidateSkus = useMemo(() => {
    if (!selectedModelObj) return [];
    if (hasStorage && !storage) return [];
    if (hasStorage) {
      return selectedModelObj.model.skus.filter(
        (s) => (s.storage?.trim() || '') === storage,
      );
    }
    return selectedModelObj.model.skus;
  }, [selectedModelObj, hasStorage, storage]);

  // Resolved selected SKU
  const selectedSku = useMemo(() => {
    if (!selectedModelObj || !skuId) return null;
    return selectedModelObj.model.skus.find((s) => s.id === skuId) ?? null;
  }, [selectedModelObj, skuId]);

  const handleResetForm = () => {
    setCategory('');
    setModelKey('');
    setStorage('');
    setSkuId('');
  };

  const handleCategoryChange = (cat: string) => {
    setCategory(cat);
    setModelKey('');
    setStorage('');
    setSkuId('');
  };

  const handleModelChange = (key: string) => {
    setModelKey(key);
    setStorage('');
    setSkuId('');

    if (!key) return;
    const target = availableModels.find((m) => m.key === key);
    if (!target) return;

    const storages = Array.from(
      new Set(
        target.model.skus
          .map((s) => s.storage?.trim())
          .filter((st): st is string => Boolean(st)),
      ),
    );

    if (storages.length === 0) {
      if (target.model.skus.length === 1) {
        setSkuId(target.model.skus[0].id);
      }
    } else if (storages.length === 1) {
      setStorage(storages[0]);
      const matchingSkus = target.model.skus.filter(
        (s) => (s.storage?.trim() || '') === storages[0],
      );
      if (matchingSkus.length === 1) {
        setSkuId(matchingSkus[0].id);
      }
    }
  };

  const handleStorageChange = (newStorage: string) => {
    setStorage(newStorage);
    setSkuId('');

    if (!selectedModelObj || !newStorage) return;
    const matchingSkus = selectedModelObj.model.skus.filter(
      (s) => (s.storage?.trim() || '') === newStorage,
    );
    if (matchingSkus.length === 1) {
      setSkuId(matchingSkus[0].id);
    }
  };

  const handleSkuChange = (newSkuId: string) => {
    setSkuId(newSkuId);
  };

  const handleAddItem = () => {
    if (!selectedModelObj || !selectedSku) return;
    if (isOutOfStock(selectedSku)) return;

    onChange({
      ...value,
      items: addItem(
        value.items,
        toProduct(
          selectedModelObj.product,
          selectedModelObj.model,
          selectedSku,
        ),
      ),
    });
    handleResetForm();
    setOpen(false);
  };

  const allSkus = (catalog ?? []).flatMap((p) =>
    p.models.flatMap((m) => m.skus),
  );
  const stockInfo = stockInfoLine(allSkus);
  const reviewDisabled =
    value.items.length === 0 || !quantitiesAreValid(value.accessories);
  /** `+` stops at the stock figure unless nothing is blocked by stock (D59). */
  const canRaise = (item: Selection['items'][number]) =>
    isUnlimited(item.product) ||
    typeof item.product.stock !== 'number' ||
    item.quantity < item.product.stock;

  return (
    <>
      <p className="muted">
        เลือกสินค้าหลักที่ลูกค้าต้องการ (เพิ่มได้หลายรายการ)
      </p>
      {stockInfo && <p className="fine stock-info-line">{stockInfo}</p>}
      {loadError && <Notice error>{loadError}</Notice>}

      <fieldset className="chosen-items">
        <legend>สินค้าหลักที่เลือก</legend>
        {value.items.length === 0 ? (
          <p className="muted">ยังไม่ได้เลือกสินค้าหลัก</p>
        ) : (
          <ul>
            {value.items.map((item) => (
              <li key={item.product.id} className="chosen-item">
                <span className="chosen-item-name">
                  <span className="chosen-item-category">
                    {getCategoryIcon(item.product.category, 15)}
                  </span>
                  <span>
                    <strong>{itemName(item)}</strong>
                    <small>{item.product.sku}</small>
                  </span>
                </span>
                <div className="qty-stepper">
                  <button
                    type="button"
                    aria-label={`ลดจำนวน ${itemName(item)}`}
                    onClick={() =>
                      onChange({
                        ...value,
                        items: stepItem(value.items, item.product.id, -1),
                      })
                    }
                  >
                    −
                  </button>
                  <span className="qty-value" aria-live="polite">
                    {item.quantity}
                  </span>
                  <button
                    type="button"
                    aria-label={`เพิ่มจำนวน ${itemName(item)}`}
                    disabled={!canRaise(item)}
                    title={canRaise(item) ? undefined : 'เกินจำนวน Stock ที่มี'}
                    onClick={() =>
                      onChange({
                        ...value,
                        items: stepItem(value.items, item.product.id, 1),
                      })
                    }
                  >
                    +
                  </button>
                </div>
                <button
                  type="button"
                  className="chosen-item-remove"
                  aria-label={`ลบ ${itemName(item)}`}
                  onClick={() =>
                    onChange({
                      ...value,
                      items: value.items.filter(
                        (i) => i.product.id !== item.product.id,
                      ),
                    })
                  }
                >
                  <X size={16} />
                </button>
              </li>
            ))}
          </ul>
        )}
        {!formOpen && (
          <Button variant="secondary" onClick={() => setOpen(true)}>
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
              }}
            >
              <Plus size={16} />
              เพิ่มสินค้าหลัก
            </span>
          </Button>
        )}
      </fieldset>

      {formOpen && (
        <div className="product-dropdown-form">
          <div className="product-picker-header">
            <h4>
              <Plus size={16} />
              เลือกสินค้าหลัก
            </h4>
            {value.items.length > 0 && (
              <button
                type="button"
                className="close-picker-btn"
                onClick={() => {
                  handleResetForm();
                  setOpen(false);
                }}
                aria-label="ปิดการเลือกสินค้า"
              >
                <X size={16} />
              </button>
            )}
          </div>

          {catalog === null && !loadError && (
            <p className="muted">กำลังโหลดรายการสินค้า…</p>
          )}

          {catalog !== null && (
            <>
              <div className="product-picker-dropdowns">
                {/* 1. Device Category */}
                <div className="picker-field">
                  <label htmlFor="product-category-select">
                    ประเภทอุปกรณ์ <span className="required">*</span>
                  </label>
                  <select
                    id="product-category-select"
                    value={category}
                    onChange={(e) => handleCategoryChange(e.target.value)}
                  >
                    <option value="">-- เลือกประเภทอุปกรณ์ --</option>
                    {categoryTiles.map((cat) => {
                      const count = catalog.filter(
                        (p) => p.category === cat,
                      ).length;
                      return (
                        <option key={cat} value={cat} disabled={count === 0}>
                          {cat} {count === 0 ? '(ไม่มีสินค้า)' : ''}
                        </option>
                      );
                    })}
                  </select>
                </div>

                {/* 2. Model */}
                <div className="picker-field">
                  <label htmlFor="product-model-select">
                    รุ่น <span className="required">*</span>
                  </label>
                  <select
                    id="product-model-select"
                    value={modelKey}
                    onChange={(e) => handleModelChange(e.target.value)}
                    disabled={!category || availableModels.length === 0}
                  >
                    <option value="">
                      {!category
                        ? '-- กรุณาเลือกประเภทอุปกรณ์ก่อน --'
                        : availableModels.length === 0
                          ? '-- ไม่มีรุ่นสินค้าในหมวดนี้ --'
                          : '-- เลือกรุ่น --'}
                    </option>
                    {availableModels.map((m) => (
                      <option key={m.key} value={m.key}>
                        {m.displayName}
                      </option>
                    ))}
                  </select>
                </div>

                {/* 3. Storage / Capacity (Auto-skipped if not applicable) */}
                {hasStorage && (
                  <div className="picker-field">
                    <label htmlFor="product-storage-select">
                      ความจุ <span className="required">*</span>
                    </label>
                    <select
                      id="product-storage-select"
                      value={storage}
                      onChange={(e) => handleStorageChange(e.target.value)}
                      disabled={!modelKey}
                    >
                      <option value="">
                        {!modelKey
                          ? '-- กรุณาเลือกรุ่นก่อน --'
                          : '-- เลือกความจุ --'}
                      </option>
                      {availableStorages.map((st) => (
                        <option key={st} value={st}>
                          {st}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                {/* 4. Color */}
                <div className="picker-field">
                  <label htmlFor="product-color-select">
                    สี{' '}
                    {candidateSkus.length > 0 && (
                      <span className="required">*</span>
                    )}
                  </label>
                  <select
                    id="product-color-select"
                    value={skuId}
                    onChange={(e) => handleSkuChange(e.target.value)}
                    disabled={!modelKey || (hasStorage && !storage)}
                  >
                    <option value="">
                      {!modelKey
                        ? '-- กรุณาเลือกรุ่นก่อน --'
                        : hasStorage && !storage
                          ? '-- กรุณาเลือกความจุก่อน --'
                          : candidateSkus.length === 0
                            ? '-- ไม่มีตัวเลือกสี --'
                            : '-- เลือกสี --'}
                    </option>
                    {candidateSkus.map((s) => {
                      const out = isOutOfStock(s);
                      const optLabel = getSkuOptionLabel(s);
                      const stockText = getSkuStockText(s);
                      return (
                        <option key={s.id} value={s.id} disabled={out}>
                          {optLabel} ({stockText})
                        </option>
                      );
                    })}
                  </select>
                </div>
              </div>

              {/* Selected SKU summary preview */}
              {selectedSku && selectedModelObj && (
                <div className="picker-sku-summary">
                  <div className="picker-sku-info">
                    <div className="picker-sku-icon">
                      {getCategoryIcon(selectedModelObj.product.category, 22)}
                    </div>
                    <div className="picker-sku-details">
                      <div className="picker-sku-title">
                        <strong>{selectedModelObj.model.name}</strong>
                        <span className="picker-sku-specs">
                          {[selectedSku.storage, selectedSku.color]
                            .filter(Boolean)
                            .join(' · ')}
                        </span>
                      </div>
                      <div className="picker-sku-meta">
                        <span className="picker-sku-code">
                          {selectedSku.sku}
                        </span>
                        <StockBadge sku={selectedSku} />
                      </div>
                    </div>
                  </div>
                  {isOutOfStock(selectedSku) && (
                    <div className="picker-stock-warning">
                      สินค้ารายการนี้หมดในสต็อก ไม่สามารถเพิ่มลงรายการได้
                    </div>
                  )}
                </div>
              )}

              {/* Actions */}
              <div className="picker-actions">
                <Button
                  variant="primary"
                  disabled={!selectedSku || isOutOfStock(selectedSku)}
                  onClick={handleAddItem}
                >
                  <span
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '6px',
                    }}
                  >
                    <Plus size={16} />
                    เพิ่มลงรายการ
                  </span>
                </Button>
                {value.items.length > 0 && (
                  <Button
                    variant="secondary"
                    onClick={() => {
                      handleResetForm();
                      setOpen(false);
                    }}
                  >
                    ยกเลิก
                  </Button>
                )}
              </div>
            </>
          )}
        </div>
      )}

      <fieldset>
        <legend>Accessories</legend>
        <div className="accessory-list">
          {accessories.map((name) => {
            const selected = Object.hasOwn(value.accessories, name);
            const quantity = value.accessories[name] ?? '';
            const invalid = selected && !quantityIsValid(quantity);
            return (
              <div className="accessory-item" key={name}>
                <div className="accessory-row">
                  <label>
                    <input
                      type="checkbox"
                      checked={selected}
                      onChange={() =>
                        onChange({
                          ...value,
                          accessories: toggleAccessory(value.accessories, name),
                        })
                      }
                    />
                    {name}
                  </label>
                  {selected && (
                    <div className="qty-stepper">
                      <button
                        type="button"
                        aria-label={`ลดจำนวน ${name}`}
                        onClick={() =>
                          onChange({
                            ...value,
                            accessories: stepAccessory(
                              value.accessories,
                              name,
                              -1,
                            ),
                          })
                        }
                      >
                        −
                      </button>
                      <input
                        aria-label={`Quantity ${name}`}
                        aria-invalid={invalid}
                        aria-describedby={
                          invalid
                            ? `quantity-${name.replaceAll(/[^a-zA-Z]/g, '')}`
                            : undefined
                        }
                        type="text"
                        inputMode="numeric"
                        value={quantity}
                        onChange={(e) =>
                          onChange({
                            ...value,
                            accessories: {
                              ...value.accessories,
                              [name]: e.target.value,
                            },
                          })
                        }
                      />
                      <button
                        type="button"
                        aria-label={`เพิ่มจำนวน ${name}`}
                        onClick={() =>
                          onChange({
                            ...value,
                            accessories: stepAccessory(
                              value.accessories,
                              name,
                              1,
                            ),
                          })
                        }
                      >
                        +
                      </button>
                    </div>
                  )}
                </div>
                {invalid && (
                  <small
                    className="field-error"
                    id={`quantity-${name.replaceAll(/[^a-zA-Z]/g, '')}`}
                  >
                    กรอกจำนวนเต็มตั้งแต่ 1 ขึ้นไป
                  </small>
                )}
              </div>
            );
          })}
        </div>
        <Button
          variant="secondary"
          onClick={() => onChange({ ...value, accessories: {} })}
        >
          None / ล้างรายการ
        </Button>
      </fieldset>
      <MultiSelect
        label="Ontop"
        options={ontop}
        value={value.ontop}
        onChange={(ontop) => onChange({ ...value, ontop })}
      />
      <MultiSelect
        label="Points"
        options={points}
        value={value.points}
        onChange={(points) => onChange({ ...value, points })}
      />
      <MultiSelect
        label="Burn Point"
        options={points}
        value={value.burnPoints}
        onChange={(burnPoints) => onChange({ ...value, burnPoints })}
      />
      <MultiSelect
        label="Payment"
        none={false}
        options={[
          ...paymentNames,
          // a method that was switched off after it was picked on this session stays visible
          ...value.payments.filter((p) => !paymentNames.includes(p)),
        ]}
        value={value.payments}
        onChange={(payments) => onChange({ ...value, payments })}
      />
      <div className="actions">
        <Button disabled={reviewDisabled} onClick={onReview}>
          <span
            style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
          >
            ตรวจสอบรายการ
            <ArrowRight size={16} />
          </span>
        </Button>
      </div>

      {/* Mobile Sticky Action Bar */}
      <div className="mobile-sticky-bar">
        <div
          style={{
            flex: 1,
            minWidth: 0,
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
          }}
        >
          <strong
            style={{
              fontSize: '13px',
              color: '#103836',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {value.items.length > 0
              ? itemsText(value.items)
              : 'กรุณาเลือกสินค้าหลัก'}
          </strong>
          <span className="fine" style={{ color: '#007d79', fontSize: '11px' }}>
            {Object.keys(value.accessories).length > 0
              ? `+ ${Object.keys(value.accessories).length} อุปกรณ์เสริม`
              : 'ไม่มีอุปกรณ์เสริม'}
          </span>
        </div>
        <Button
          disabled={reviewDisabled}
          onClick={onReview}
          style={{ flexShrink: 0 }}
        >
          <span
            style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}
          >
            ถัดไป
            <ArrowRight size={15} />
          </span>
        </Button>
      </div>
    </>
  );
}
