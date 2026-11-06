import { useEffect, useMemo, useState } from 'react';
import iphoneIcon from '../../assets/category-icons/iphone.png';
import ipadIcon from '../../assets/category-icons/ipad.png';
import macIcon from '../../assets/category-icons/mac.png';
import watchIcon from '../../assets/category-icons/watch.png';
import accessoriesIcon from '../../assets/category-icons/accessories.png';
import batteryIcon from '../../assets/category-icons/battery.png';
import {
  Smartphone,
  Tablet,
  Laptop,
  Watch,
  Box,
  ArrowRight,
  Headphones,
  BatteryCharging,
  Plus,
  X,
} from 'lucide-react';
import {
  accessories,
  deviceCategories,
  fmpPaymentTypeOther,
  ontop,
  payments,
  points,
} from '../../constants/options';
import type { Category, Product, Selection } from '../../types/session';
import { Choices, MultiSelect, Button, Notice } from '../../components/ui';
import {
  addItem,
  itemName,
  itemsText,
  quantitiesAreValid,
  quantityIsValid,
  stepAccessory,
  stepItem,
  toggleAccessory,
  toggleOption,
} from './workflow';
import { SkuPicker } from './SkuPicker';
import {
  isOutOfStock,
  isUnlimited,
  modelChoices,
  toCatalog,
  type CatalogModel,
  type CatalogProduct,
  type CatalogSku,
  type Picked,
} from './catalog';
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
    case 'Battery':
      return <BatteryCharging size={size} />;
    default:
      return <Box size={size} />;
  }
}

/** Product pictures of the category tiles (Icons8, see D79 for the licence); a category without one gets a plain icon. */
const CATEGORY_PICTURES: Record<string, string> = {
  iPhone: iphoneIcon,
  iPad: ipadIcon,
  Mac: macIcon,
  Watch: watchIcon,
  Accessories: accessoriesIcon,
  Battery: batteryIcon,
};
function CategoryPicture({ cat, size = 48 }: { cat: string; size?: number }) {
  const src = CATEGORY_PICTURES[cat];
  return src ? (
    <img src={src} width={size} height={size} alt="" className="category-picture" />
  ) : (
    getCategoryIcon(cat, size * 0.7)
  );
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
  // F6: the payment methods ADMIN keeps; the built-in list (no FMP types known) is the fallback when they cannot be loaded
  const [paymentMethods, setPaymentMethods] = useState<{ name: string; fmpType: string | null }[]>(
    () => payments.map((name) => ({ name, fmpType: null })),
  );
  // D72: the categories ADMIN keeps; the four device lines are the fallback when they cannot be loaded
  const [categoryList, setCategoryList] = useState<Category[] | null>(null);
  const [open, setOpen] = useState(value.items.length === 0);
  // with nothing chosen the picker is always open
  const formOpen = open || value.items.length === 0;

  // The device line (tiles), then SkuPicker for model / RAM / capacity / colour; `pickerRun` starts the picker over
  const [category, setCategory] = useState<string>('');
  const [picked, setPicked] = useState<Picked | null>(null);
  const [pickerRun, setPickerRun] = useState(0);

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
        if (active && list.length > 0) setPaymentMethods(list);
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

  const models = useMemo(() => modelChoices(catalog, category), [catalog, category]);

  const handleResetForm = () => {
    setCategory('');
    setPicked(null);
    setPickerRun((n) => n + 1);
  };

  const handleCategoryChange = (cat: string) => {
    setCategory(cat);
    setPicked(null);
  };

  const handleAddItem = () => {
    if (!picked || isOutOfStock(picked.sku)) return;
    onChange({
      ...value,
      items: addItem(value.items, toProduct(picked.product, picked.model, picked.sku)),
    });
    handleResetForm();
    setOpen(false);
  };

  // The methods with an FMP type come first, the rest under the heading "ช่องทางอื่น", all always shown (D107; ADMIN moves one
  // up by giving it a type). A method switched off after it was picked on this session stays visible.
  const typed = (m: { fmpType: string | null }) => Boolean(m.fmpType) && m.fmpType !== fmpPaymentTypeOther;
  const anyTyped = paymentMethods.some(typed);
  const mainPayments = [
    ...paymentMethods.filter((m) => !anyTyped || typed(m)).map((m) => m.name),
    ...value.payments.filter((p) => !paymentMethods.some((m) => m.name === p)),
  ];
  const otherPayments = anyTyped ? paymentMethods.filter((m) => !typed(m)).map((m) => m.name) : [];

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
              {/* 1. Device category: one icon tile each (D78). A category without products is shown but cannot be picked. */}
              <div className="wizard-tiles picker-category-tiles" role="group" aria-label="ประเภทอุปกรณ์">
                {categoryTiles.map((cat) => {
                  const count = catalog.filter((p) => p.category === cat).length;
                  return (
                    <button
                      type="button"
                      key={cat}
                      className={`wizard-tile wizard-tile-category${category === cat ? ' selected' : ''}`}
                      aria-pressed={category === cat}
                      disabled={count === 0}
                      onClick={() => handleCategoryChange(cat)}
                    >
                      <CategoryPicture cat={cat} size={52} />
                      <strong>{cat}</strong>
                      {count === 0 && <small>ไม่มีสินค้า</small>}
                    </button>
                  );
                })}
              </div>
              {category ? (
                <SkuPicker key={`${category}:${pickerRun}`} models={models} onPick={setPicked} />
              ) : (
                <p className="muted picker-hint">เลือกประเภทอุปกรณ์ด้านบนก่อน</p>
              )}

              {/* Selected SKU summary preview */}
              {picked && (
                <div className="picker-sku-summary">
                  <div className="picker-sku-info">
                    <div className="picker-sku-icon">
                      <CategoryPicture cat={picked.product.category} size={40} />
                    </div>
                    <div className="picker-sku-details">
                      <div className="picker-sku-title">
                        <strong>{picked.model.name}</strong>
                        <span className="picker-sku-specs">
                          {[picked.sku.memory, picked.sku.storage, picked.sku.color]
                            .filter(Boolean)
                            .join(' · ')}
                        </span>
                      </div>
                      <div className="picker-sku-meta">
                        <span className="picker-sku-code">
                          {picked.sku.sku}
                        </span>
                        <StockBadge sku={picked.sku} />
                      </div>
                    </div>
                  </div>
                  {isOutOfStock(picked.sku) && (
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
                  disabled={!picked || isOutOfStock(picked.sku)}
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
      {/* Points earned and points burned use the same cards: one table, a row per card */}
      <fieldset>
        <legend>Points</legend>
        <table className="points-table">
          <thead>
            <tr>
              <th scope="col"><span className="visually-hidden">บัตร</span></th>
              <th scope="col">สะสม</th>
              <th scope="col">ใช้แต้ม (Burn)</th>
            </tr>
          </thead>
          <tbody>
            {points.map((card) => (
              <tr key={card}>
                <th scope="row">{card}</th>
                {(['points', 'burnPoints'] as const).map((field) => (
                  <td key={field}>
                    <label className={`points-cell${value[field].includes(card) ? ' selected' : ''}`}>
                      <input
                        type="checkbox"
                        aria-label={`${field === 'points' ? 'สะสมแต้ม' : 'ใช้แต้ม'} ${card}`}
                        checked={value[field].includes(card)}
                        onChange={() => onChange({ ...value, [field]: toggleOption(value[field], card) })}
                      />
                    </label>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </fieldset>
      <fieldset>
        <legend>
          Payment <small className="legend-note">(ไม่บังคับ)</small>
        </legend>
        {otherPayments.length > 0 && <p className="choice-group-title">ช่องทางหลัก</p>}
        <Choices
          options={mainPayments}
          value={value.payments}
          onChange={(payments) => onChange({ ...value, payments })}
        />
        {otherPayments.length > 0 && (
          <>
            <p className="choice-group-title">ช่องทางอื่น</p>
            <Choices
              options={otherPayments}
              value={value.payments}
              onChange={(payments) => onChange({ ...value, payments })}
            />
          </>
        )}
      </fieldset>
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
