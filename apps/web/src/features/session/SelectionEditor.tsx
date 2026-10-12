import { useEffect, useMemo, useState } from 'react';
import {
  Smartphone,
  Tablet,
  Laptop,
  Watch,
  Box,
  ArrowRight,
  ArrowLeft,
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
import type { Product, Selection } from '../../types/session';
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
import { fetchProductsApi } from '../../services/sessionApi';

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

type WizardStep = 'category' | 'product' | 'model' | 'sku';

/**
 * Choosing the main products (F2, F3): a step-by-step picker like the trade-in app (big tiles: category → product →
 * model → capacity / colour; a step with a single choice is skipped) that adds to a list, each product with a `−` / `+`
 * quantity. Several main products can be added.
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
  const [open, setOpen] = useState(value.items.length === 0);
  // with nothing chosen the picker is always open
  const wizardOpen = open || value.items.length === 0;
  const [category, setCategory] = useState<string | null>(null);
  const [productId, setProductId] = useState<string | null>(null);
  const [modelId, setModelId] = useState<string | null>(null);

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

  const products = useMemo(
    () => (catalog ?? []).filter((p) => p.category === category),
    [catalog, category],
  );
  const product = products.find((p) => p.id === productId) ?? null;
  const model = product?.models.find((m) => m.id === modelId) ?? null;
  const step: WizardStep = !category
    ? 'category'
    : !product
      ? 'product'
      : !model
        ? 'model'
        : 'sku';

  const resetWizard = () => {
    setCategory(null);
    setProductId(null);
    setModelId(null);
  };
  // a step with a single choice is skipped: a product with one model goes straight to its SKUs,
  // a category with one product goes straight to that product
  const chooseProduct = (next: CatalogProduct) => {
    setProductId(next.id);
    setModelId(next.models.length === 1 ? next.models[0].id : null);
  };
  const chooseCategory = (next: string) => {
    setCategory(next);
    const inCategory = (catalog ?? []).filter((p) => p.category === next);
    if (inCategory.length === 1) chooseProduct(inCategory[0]);
    else {
      setProductId(null);
      setModelId(null);
    }
  };
  /** One step back (over the steps that were skipped); at the first step the wizard closes when something is already chosen. */
  const back = () => {
    if (step === 'sku' && (product?.models.length ?? 0) > 1) setModelId(null);
    else if (step === 'sku' || step === 'model') {
      setModelId(null);
      if (products.length > 1) setProductId(null);
      else resetWizard();
    } else if (step === 'product') resetWizard();
    else if (value.items.length > 0) setOpen(false);
  };
  const pick = (sku: CatalogSku) => {
    if (!product || !model) return;
    onChange({
      ...value,
      items: addItem(value.items, toProduct(product, model, sku)),
    });
    resetWizard();
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

  const crumbs = [
    { label: 'หมวดหมู่', done: Boolean(category) },
    { label: 'รุ่น', done: Boolean(product) },
    { label: 'ตัวเลือก', done: Boolean(model) },
  ];
  const currentCrumb = crumbs.findIndex((c) => !c.done);

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
        {!wizardOpen && (
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

      {wizardOpen && (
        <div className="wizard">
          <ol className="wizard-crumbs">
            {crumbs.map((crumb, index) => (
              <li
                key={crumb.label}
                className={
                  crumb.done ? 'done' : index === currentCrumb ? 'current' : ''
                }
              >
                {crumb.label}
              </li>
            ))}
          </ol>
          {(step !== 'category' || value.items.length > 0) && (
            <button type="button" className="wizard-back" onClick={back}>
              <ArrowLeft size={14} />{' '}
              {step === 'category' ? 'ปิดการเลือกสินค้า' : 'ย้อนกลับ'}
            </button>
          )}

          {catalog === null && !loadError && (
            <p className="muted">กำลังโหลดรายการสินค้า…</p>
          )}

          {catalog !== null && step === 'category' && (
            <div className="wizard-tiles">
              {deviceCategories.map((item) => {
                const count = catalog.filter((p) => p.category === item).length;
                return (
                  <button
                    type="button"
                    key={item}
                    className="wizard-tile wizard-tile-category"
                    disabled={count === 0}
                    onClick={() => chooseCategory(item)}
                  >
                    {getCategoryIcon(item, 34)}
                    <strong>{item}</strong>
                    {count === 0 && <small>ไม่มีสินค้า</small>}
                  </button>
                );
              })}
            </div>
          )}

          {step === 'product' && (
            <div className="wizard-tiles">
              {products.map((p) => (
                <button
                  type="button"
                  key={p.id}
                  className="wizard-tile"
                  onClick={() => chooseProduct(p)}
                >
                  <strong>{p.name}</strong>
                </button>
              ))}
            </div>
          )}

          {step === 'model' && product && (
            <div className="wizard-tiles">
              {product.models.map((m) => (
                <button
                  type="button"
                  key={m.id}
                  className="wizard-tile"
                  onClick={() => setModelId(m.id)}
                >
                  <strong>{m.name}</strong>
                </button>
              ))}
            </div>
          )}

          {step === 'sku' && model && (
            <div className="wizard-tiles">
              {model.skus.map((s) => {
                const out = isOutOfStock(s);
                return (
                  <button
                    type="button"
                    key={s.id}
                    className={`wizard-tile ${out ? 'out-of-stock' : ''}`}
                    disabled={out}
                    onClick={() => pick(s)}
                  >
                    <strong>{s.name || model.name}</strong>
                    <span className="wizard-tile-options">
                      {[s.storage, s.color].filter(Boolean).join(' · ')}
                    </span>
                    <small>{s.sku}</small>
                    <StockBadge sku={s} />
                  </button>
                );
              })}
            </div>
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
        options={payments}
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
