import { useEffect, useMemo, useState } from 'react';
import iphoneIcon from '../../assets/category-icons/iphone.png';
import ipadIcon from '../../assets/category-icons/ipad.png';
import macIcon from '../../assets/category-icons/mac.png';
import watchIcon from '../../assets/category-icons/watch.png';
import accessoriesIcon from '../../assets/category-icons/accessories.png';
import batteryIcon from '../../assets/category-icons/battery.png';
import {
  ArrowRight,
  CreditCard,
  Pencil,
  Plus,
  X,
} from 'lucide-react';
import { CategoryIcon } from '../../components/CategoryIcon';
import {
  accessories,
  deviceCategories,
  fmpPaymentTypeOther,
  ontop,
  payments,
  points,
} from '../../constants/options';
import type { Category, PaymentDetail, PaymentMethod, Product, Selection } from '../../types/session';
import { MultiSelect, Button, Modal, Notice } from '../../components/ui';
import {
  addItem,
  formatPaymentLabel,
  itemName,
  itemsText,
  paymentsAreValid,
  quantitiesAreValid,
  quantityIsValid,
  RECEIPT_TYPE_OPTIONS,
  receiptTypeIsValid,
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
    <CategoryIcon category={cat} size={size * 0.7} />
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
  const [cardModalMethod, setCardModalMethod] = useState<
    'Full Credit Card' | '0% Credit Card' | null
  >(null);
  const [tempSelectedCard, setTempSelectedCard] = useState<string>('');
  const [tempSelectedMonths, setTempSelectedMonths] = useState<number | null>(
    null,
  );
  // F6: the payment methods ADMIN keeps; the built-in list (no FMP types known) is the fallback when they cannot be loaded
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>(
    () =>
      payments.map((name, i) => ({
        id: `p-${i}`,
        name,
        active: true,
        position: i,
        fmpType: null,
        cardOptions: [],
      })),
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
  const paymentsValid = paymentsAreValid(value.payments, value.paymentDetails);
  const receiptValid = receiptTypeIsValid(value.receiptType);
  const reviewDisabled =
    value.items.length === 0 ||
    !quantitiesAreValid(value.accessories) ||
    !paymentsValid ||
    !receiptValid;
  /** `+` stops at the stock figure unless nothing is blocked by stock (D59). */
  const canRaise = (item: Selection['items'][number]) =>
    isUnlimited(item.product) ||
    typeof item.product.stock !== 'number' ||
    item.quantity < item.product.stock;

  const handlePaymentsChange = (newPayments: string[]) => {
    // If Full Credit Card was just selected, open modal
    if (
      newPayments.includes('Full Credit Card') &&
      !value.payments.includes('Full Credit Card')
    ) {
      const current = value.paymentDetails?.find(
        (d) => d.method === 'Full Credit Card',
      );
      setTempSelectedCard(current?.cardType ?? '');
      setCardModalMethod('Full Credit Card');
      return;
    }
    // If 0% Credit Card was just selected, open modal
    if (
      newPayments.includes('0% Credit Card') &&
      !value.payments.includes('0% Credit Card')
    ) {
      const current = value.paymentDetails?.find(
        (d) => d.method === '0% Credit Card',
      );
      setTempSelectedCard(current?.cardType ?? '');
      setTempSelectedMonths(current?.installmentMonths ?? null);
      setCardModalMethod('0% Credit Card');
      return;
    }

    // Normal toggle (e.g. unchecking or toggling other payments)
    const existingDetails = value.paymentDetails ?? [];
    const updatedDetails: PaymentDetail[] = [];

    for (const method of newPayments) {
      const found = existingDetails.find((d) => d.method === method);
      if (found) {
        updatedDetails.push(found);
      } else {
        updatedDetails.push({ method });
      }
    }

    onChange({
      ...value,
      payments: newPayments,
      paymentDetails: updatedDetails,
    });
  };

  const handleOpenEditModal = (
    method: 'Full Credit Card' | '0% Credit Card',
  ) => {
    const current = value.paymentDetails?.find((d) => d.method === method);
    setTempSelectedCard(current?.cardType ?? '');
    setTempSelectedMonths(current?.installmentMonths ?? null);
    setCardModalMethod(method);
  };

  const handleConfirmModal = () => {
    if (!cardModalMethod) return;

    if (cardModalMethod === 'Full Credit Card') {
      if (!tempSelectedCard) return;
      const nextPayments = value.payments.includes('Full Credit Card')
        ? value.payments
        : [...value.payments, 'Full Credit Card'];
      const nextDetails = [
        ...(value.paymentDetails ?? []).filter(
          (d) => d.method !== 'Full Credit Card',
        ),
        { method: 'Full Credit Card', cardType: tempSelectedCard },
      ];
      onChange({
        ...value,
        payments: nextPayments,
        paymentDetails: nextDetails,
      });
    } else if (cardModalMethod === '0% Credit Card') {
      if (!tempSelectedCard || !tempSelectedMonths) return;
      const nextPayments = value.payments.includes('0% Credit Card')
        ? value.payments
        : [...value.payments, '0% Credit Card'];
      const nextDetails = [
        ...(value.paymentDetails ?? []).filter(
          (d) => d.method !== '0% Credit Card',
        ),
        {
          method: '0% Credit Card',
          cardType: tempSelectedCard,
          installmentMonths: tempSelectedMonths,
        },
      ];
      onChange({
        ...value,
        payments: nextPayments,
        paymentDetails: nextDetails,
      });
    }

    setCardModalMethod(null);
  };

  const handleCancelModal = () => {
    if (!cardModalMethod) return;

    // Check if it was already validly selected prior to opening modal
    const existing = value.paymentDetails?.find(
      (d) => d.method === cardModalMethod,
    );
    const wasValid =
      cardModalMethod === 'Full Credit Card'
        ? Boolean(existing?.cardType)
        : Boolean(existing?.cardType && existing?.installmentMonths);

    if (!wasValid) {
      // Remove it from selection since user didn't complete the modal
      onChange({
        ...value,
        payments: value.payments.filter((p) => p !== cardModalMethod),
        paymentDetails: (value.paymentDetails ?? []).filter(
          (d) => d.method !== cardModalMethod,
        ),
      });
    }

    setCardModalMethod(null);
  };

  const renderPaymentChoices = (optionsList: string[]) => (
    <div className="choices">
      {optionsList.map((option) => {
        const checked = value.payments.includes(option);
        const label = formatPaymentLabel(option, value.paymentDetails);
        const isCreditCard =
          option === 'Full Credit Card' || option === '0% Credit Card';

        return (
          <label
            className={`choice ${checked ? 'selected' : ''}`}
            key={option}
          >
            <input
              type="checkbox"
              checked={checked}
              onChange={() =>
                handlePaymentsChange(toggleOption(value.payments, option))
              }
            />
            <span>{label}</span>
            {checked && isCreditCard && (
              <button
                type="button"
                aria-label={`แก้ไข ${option}`}
                title="แก้ไขประเภทบัตร / เดือนผ่อน"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  handleOpenEditModal(option);
                }}
                style={{
                  border: 'none',
                  background: 'rgba(10, 186, 181, 0.15)',
                  color: '#007d79',
                  borderRadius: '4px',
                  padding: '2px 5px',
                  marginLeft: '4px',
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '3px',
                  fontSize: '11px',
                  fontWeight: 600,
                }}
              >
                <Pencil size={11} />
              </button>
            )}
          </label>
        );
      })}
    </div>
  );

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
                    <CategoryIcon category={item.product.category} size={15} />
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
        {renderPaymentChoices(mainPayments)}
        {otherPayments.length > 0 && (
          <>
            <p className="choice-group-title">ช่องทางอื่น</p>
            {renderPaymentChoices(otherPayments)}
          </>
        )}

        {/* D127: Modal for Full Credit Card & 0% Credit Card */}
        {cardModalMethod && (() => {
          const isZeroPercent = cardModalMethod === '0% Credit Card';
          const methodObj = paymentMethods.find(
            (m) => m.name === cardModalMethod,
          );
          const activeDbCards =
            methodObj?.cardOptions?.filter((c) => c.active) ?? [];

          // Cards list strictly from DB active card options
          const cards = activeDbCards.map((c) => ({
            name: c.name,
            installmentMonths:
              isZeroPercent && Array.isArray(c.installmentMonths)
                ? (c.installmentMonths as number[])
                : ([] as number[]),
          }));

          const selectedCardObj = cards.find(
            (c) => c.name === tempSelectedCard,
          );
          const availableMonths = selectedCardObj?.installmentMonths ?? [];

          const canConfirm = isZeroPercent
            ? Boolean(tempSelectedCard && tempSelectedMonths)
            : Boolean(tempSelectedCard);

          return (
            <Modal
              isOpen={true}
              title={
                <span
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                  }}
                >
                  <CreditCard size={18} />
                  {isZeroPercent
                    ? 'เลือกประเภทบัตรและจำนวนเดือนผ่อน (0% Credit Card)'
                    : 'เลือกประเภทบัตร (Full Credit Card)'}
                </span>
              }
              onClose={handleCancelModal}
              maxWidth="520px"
            >
              <div>
                <div
                  style={{
                    fontWeight: 600,
                    fontSize: '13px',
                    marginBottom: '10px',
                  }}
                >
                  1. เลือกประเภทบัตร <span style={{ color: '#ef4444' }}>*</span>
                </div>
                {cards.length === 0 ? (
                  <div style={{ marginBottom: '16px' }}>
                    <Notice error>
                      ยังไม่มีประเภทบัตรที่เปิดใช้งาน กรุณาตั้งค่าที่หน้า Admin → ช่องทางชำระเงิน
                    </Notice>
                  </div>
                ) : (
                  <div className="choices" style={{ marginBottom: '16px' }}>
                    {cards.map((card) => {
                      const selected = tempSelectedCard === card.name;
                      return (
                        <button
                          key={card.name}
                          type="button"
                          className={`choice ${selected ? 'selected' : ''}`}
                          style={{
                            padding: '10px 16px',
                            fontSize: '13px',
                            fontWeight: selected ? 600 : 500,
                            cursor: 'pointer',
                          }}
                          onClick={() => {
                            setTempSelectedCard(card.name);
                            if (
                              isZeroPercent &&
                              tempSelectedMonths &&
                              !card.installmentMonths.includes(tempSelectedMonths)
                            ) {
                              setTempSelectedMonths(null);
                            }
                          }}
                        >
                          {card.name}
                        </button>
                      );
                    })}
                  </div>
                )}

                {isZeroPercent && cards.length > 0 && (
                  <div
                    style={{
                      marginTop: '16px',
                      borderTop: '1px solid var(--border-color, #e2e8f0)',
                      paddingTop: '14px',
                    }}
                  >
                    <div
                      style={{
                        fontWeight: 600,
                        fontSize: '13px',
                        marginBottom: '10px',
                      }}
                    >
                      2. เลือกจำนวนเดือนที่ผ่อน{' '}
                      {tempSelectedCard ? `(${tempSelectedCard})` : ''}{' '}
                      <span style={{ color: '#ef4444' }}>*</span>
                    </div>
                    {!tempSelectedCard ? (
                      <p
                        className="muted"
                        style={{ margin: 0, fontSize: '12px' }}
                      >
                        กรุณาแตะเลือกประเภทบัตรด้านบนก่อน
                      </p>
                    ) : availableMonths.length === 0 ? (
                      <p
                        className="muted"
                        style={{ margin: 0, fontSize: '12px' }}
                      >
                        บัตรนี้ยังไม่มีการกำหนดเดือนผ่อน
                      </p>
                    ) : (
                      <div className="choices">
                        {availableMonths.map((months) => {
                          const selected = tempSelectedMonths === months;
                          return (
                            <button
                              key={months}
                              type="button"
                              className={`choice ${selected ? 'selected' : ''}`}
                              style={{
                                padding: '10px 18px',
                                fontSize: '13px',
                                fontWeight: selected ? 600 : 500,
                                cursor: 'pointer',
                              }}
                              onClick={() => setTempSelectedMonths(months)}
                            >
                              {months} เดือน
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}

                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'flex-end',
                    gap: '8px',
                    marginTop: '24px',
                    borderTop: '1px solid var(--border-color, #e2e8f0)',
                    paddingTop: '14px',
                  }}
                >
                  <Button variant="secondary" onClick={handleCancelModal}>
                    ยกเลิก
                  </Button>
                  <Button disabled={!canConfirm} onClick={handleConfirmModal}>
                    ยืนยัน
                  </Button>
                </div>
              </div>
            </Modal>
          );
        })()}
      </fieldset>
      <fieldset>
        <legend>
          ประเภทใบเสร็จ <small className="legend-note">(จำเป็น · เลือก 1 อย่าง)</small>
        </legend>
        <div
          role="radiogroup"
          aria-label="ประเภทใบเสร็จ"
          style={{ display: 'flex', flexDirection: 'column', marginTop: '6px' }}
        >
          {RECEIPT_TYPE_OPTIONS.map((opt) => {
            const selected = value.receiptType === opt.value;
            return (
              <label
                key={opt.value}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px',
                  padding: '12px 16px',
                  border: `1px solid ${selected ? 'var(--primary)' : 'var(--border-color)'}`,
                  borderRadius: '8px',
                  background: selected ? 'var(--primary-subtle)' : 'var(--bg-surface)',
                  cursor: 'pointer',
                  transition: 'border-color 150ms cubic-bezier(0.22, 1, 0.36, 1), background-color 150ms cubic-bezier(0.22, 1, 0.36, 1)',
                  userSelect: 'none',
                }}
              >
                <input
                  type="radio"
                  name="receiptType"
                  value={opt.value}
                  checked={selected}
                  onChange={() =>
                    onChange({
                      ...value,
                      receiptType: opt.value,
                      taxInvoice: opt.isTaxInvoice,
                    })
                  }
                  style={{ width: '18px', height: '18px', margin: 0, cursor: 'pointer', accentColor: 'var(--primary)' }}
                />
                <div>
                  <span style={{ display: 'block', fontWeight: 600, fontSize: '14px', color: 'var(--text-primary)' }}>
                    {opt.label}
                  </span>
                  <span style={{ display: 'block', fontSize: '12px', color: 'var(--text-secondary)', marginTop: '2px' }}>
                    {opt.description}
                  </span>
                </div>
              </label>
            );
          })}
        </div>
      </fieldset>
      <fieldset>
        <legend>
          เอกสารภาษีเพิ่มเติม / VAT Refund <small className="legend-note">(ไม่บังคับ)</small>
        </legend>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '6px' }}>
          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
              padding: '12px 16px',
              border: `1px solid ${value.vatRefund ? 'var(--primary)' : 'var(--border-color)'}`,
              borderRadius: '8px',
              background: value.vatRefund ? 'var(--primary-subtle)' : 'var(--bg-surface)',
              cursor: 'pointer',
              transition: 'border-color 150ms cubic-bezier(0.22, 1, 0.36, 1), background-color 150ms cubic-bezier(0.22, 1, 0.36, 1)',
              userSelect: 'none',
            }}
          >
            <input
              type="checkbox"
              checked={Boolean(value.vatRefund)}
              onChange={(e) => onChange({ ...value, vatRefund: e.target.checked })}
              style={{ width: '18px', height: '18px', margin: 0, cursor: 'pointer', accentColor: 'var(--primary)' }}
            />
            <div>
              <span style={{ display: 'block', fontWeight: 600, fontSize: '14px', color: 'var(--text-primary)' }}>
                ต้องการ VAT Refund
              </span>
              <span style={{ display: 'block', fontSize: '12px', color: 'var(--text-secondary)', marginTop: '2px' }}>
                ขอเอกสารคืนภาษีมูลค่าเพิ่มสำหรับนักท่องเที่ยวต่างชาติ (ภ.พ.10)
              </span>
            </div>
          </label>
        </div>
      </fieldset>
      {!paymentsValid && (
        <Notice error>
          กรุณาเลือกประเภทบัตร (และจำนวนเดือนผ่อนสำหรับ 0% Credit Card) ให้ครบถ้วนก่อนตรวจสอบรายการ
        </Notice>
      )}
      {!receiptValid && (
        <Notice error>
          กรุณาเลือกประเภทใบเสร็จก่อนตรวจสอบรายการ
        </Notice>
      )}
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
