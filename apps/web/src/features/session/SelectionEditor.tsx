import { useEffect, useMemo, useRef, useState } from 'react';
import iphoneIcon from '../../assets/category-icons/iphone.avif';
import ipadIcon from '../../assets/category-icons/ipad.avif';
import macIcon from '../../assets/category-icons/macBook.webp';
import watchIcon from '../../assets/category-icons/watch.avif';
import airPodsIcon from '../../assets/category-icons/airPods.avif';
import appleTvIcon from '../../assets/category-icons/apple_TV.jpg';
import homePodIcon from '../../assets/category-icons/homePod.jpg';
import airTagIcon from '../../assets/category-icons/airTag.jpg';
import accessoriesIcon from '../../assets/category-icons/accessories.png';
import batteryIcon from '../../assets/category-icons/battery.png';
import {
  ArrowRight,
  ChevronDown,
  ChevronUp,
  CreditCard,
  Pencil,
  Plus,
  Search,
  ShoppingBag,
  X,
} from 'lucide-react';
import { CategoryIcon } from '../../components/CategoryIcon';
import {
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
  CUSTOMER_SOURCE_OPTIONS,
  customerSourceIsValid,
  DISCOUNT_TYPE_OPTIONS,
  discountTypeIsValid,
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
  formatAccessoryItemName,
  getSkuAttribute,
  isAccessoryFromProduct,
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
import { AccessoryCategoryPicker } from './AccessoryCategoryPicker';

/** Product pictures of the category tiles (Icons8, see D79 for the licence); a category without one gets a plain icon. */
const CATEGORY_PICTURES: Record<string, string> = {
  iPhone: iphoneIcon,
  iPad: ipadIcon,
  Mac: macIcon,
  Watch: watchIcon,
  AirPods: airPodsIcon,
  'Apple TV': appleTvIcon,
  HomePod: homePodIcon,
  AirTag: airTagIcon,
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
  const [cartModalOpen, setCartModalOpen] = useState(false);
  const [accessorySearch, setAccessorySearch] = useState('');
  const [expandedGroup, setExpandedGroup] = useState<string | null>(null);
  const [selectedModelPerGroup, setSelectedModelPerGroup] = useState<Record<string, string>>({});

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

  // D152: Accessories list dynamically derived from real catalog products marked as accessory
  const accessoryCategoryNames = useMemo<Set<string>>(() => {
    if (categoryList && categoryList.length > 0) {
      return new Set(categoryList.filter((c) => c.isAccessory).map((c) => c.name));
    }
    return new Set(['Accessories']);
  }, [categoryList]);

  const selectedAccessoryEntries = useMemo(
    () => Object.entries(value.accessories).filter(([, qty]) => Number(qty) > 0),
    [value.accessories],
  );

  const totalAccessoryCount = useMemo(
    () => selectedAccessoryEntries.reduce((sum, [, qty]) => sum + (Number(qty) || 0), 0),
    [selectedAccessoryEntries],
  );

  const defaultIPhoneModel = useMemo(() => {
    const item = value.items.find((i) => i.product.category?.toLowerCase().includes('iphone'));
    return item?.product.product || item?.product.model || '';
  }, [value.items]);

  const defaultIPadModel = useMemo(() => {
    const item = value.items.find((i) => i.product.category?.toLowerCase().includes('ipad'));
    return item?.product.product || item?.product.model || '';
  }, [value.items]);

  // D188: Extract accessory groups directly from catalog products marked as accessory (Image 2)
  const accessoryGroups = useMemo(() => {
    if (!catalog || catalog.length === 0) return [];

    const map = new Map<
      string,
      {
        id: string;
        name: string;
        category?: Category;
        products: CatalogProduct[];
      }
    >();

    for (const p of catalog) {
      const isAccy =
        accessoryCategoryNames.has(p.category) ||
        p.category.toLowerCase().includes('accy') ||
        p.category.toLowerCase().includes('accessories');
      if (!isAccy) continue;

      const groupName = p.name.trim();
      if (!groupName) continue;

      const key = groupName.toLowerCase();
      const existing = map.get(key);
      if (existing) {
        existing.products.push(p);
      } else {
        const matchingCat = categoryList?.find(
          (c) =>
            c.name.trim().toLowerCase() === key ||
            (key.startsWith('ipad case') && c.name.toLowerCase().startsWith('ipad case')) ||
            (c.isAccessory && c.name.trim().toLowerCase() === p.category.trim().toLowerCase()),
        );
        map.set(key, {
          id: p.id,
          name: groupName,
          category: matchingCat,
          products: [p],
        });
      }
    }

    const list = Array.from(map.values()).map((g) => {
      const modelNames = new Set<string>();
      let skusCount = 0;
      for (const prod of g.products) {
        for (const m of prod.models || []) {
          modelNames.add(m.name.trim().toLowerCase());
          skusCount += m.skus?.length || 0;
        }
      }
      return {
        ...g,
        modelsCount: modelNames.size,
        skusCount,
      };
    });

    return list.sort((a, b) => a.name.localeCompare(b.name, 'th'));
  }, [catalog, accessoryCategoryNames, categoryList]);

  const displayedAccessoryGroups = useMemo(() => {
    const q = accessorySearch.trim().toLowerCase();
    if (!q) return accessoryGroups;

    return accessoryGroups.filter((g) => {
      // 1. Group name matches
      if (g.name.toLowerCase().includes(q)) return true;

      // 2. Models or SKUs match
      for (const prod of g.products) {
        for (const m of prod.models || []) {
          if (m.name.toLowerCase().includes(q)) return true;
          for (const s of m.skus || []) {
            if (
              s.sku.toLowerCase().includes(q) ||
              s.name?.toLowerCase().includes(q) ||
              s.color?.toLowerCase().includes(q)
            ) {
              return true;
            }
          }
        }
      }
      return false;
    });
  }, [accessoryGroups, accessorySearch]);

  useEffect(() => {
    if (accessorySearch.trim() && displayedAccessoryGroups.length > 0) {
      setExpandedGroup(displayedAccessoryGroups[0].id);
    }
  }, [accessorySearch, displayedAccessoryGroups]);

  const handleAddAccessory = (itemKey: string) => {
    const inCartQty = Number(value.accessories[itemKey]) || 0;
    onChange({
      ...value,
      accessories: {
        ...value.accessories,
        [itemKey]: String(inCartQty + 1),
      },
    });
  };

  const models = useMemo(() => modelChoices(catalog, category), [catalog, category]);
  const skuPickerSectionRef = useRef<HTMLDivElement>(null);
  const chosenSectionRef = useRef<HTMLFieldSetElement>(null);
  const monthsSectionRef = useRef<HTMLDivElement>(null);

  const handleResetForm = () => {
    setCategory('');
    setPicked(null);
    setPickerRun((n) => n + 1);
  };

  const handleCategoryChange = (cat: string) => {
    setCategory(cat);
    setPicked(null);
    setTimeout(() => {
      skuPickerSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 50);
  };

  const handleAddPicked = (pickedObj: Picked) => {
    if (!pickedObj || isOutOfStock(pickedObj.sku)) return;
    onChange({
      ...value,
      items: addItem(value.items, toProduct(pickedObj.product, pickedObj.model, pickedObj.sku)),
    });
    handleResetForm();
    setOpen(false);
    setTimeout(() => {
      chosenSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 50);
  };

  const handleAddItem = () => {
    if (picked) handleAddPicked(picked);
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
  const discountValid = discountTypeIsValid(value.discountType);
  const customerSourceValid = customerSourceIsValid(value.customerSource);
  const reviewDisabled =
    value.items.length === 0 ||
    !quantitiesAreValid(value.accessories) ||
    !paymentsValid ||
    !receiptValid ||
    !discountValid ||
    !customerSourceValid;
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
    <div className="choices payment-choices">
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
      {stockInfo && <p className="fine stock-info-line">{stockInfo}</p>}
      {loadError && <Notice error>{loadError}</Notice>}

      <fieldset className="chosen-items" ref={chosenSectionRef}>
        <legend>สินค้าหลักที่เลือก</legend>
        {value.items.length === 0 ? (
          <p className="muted">ยังไม่ได้เลือกสินค้าหลัก</p>
        ) : (
          <ul>
            {value.items.map((item) => (
              <li key={item.product.id} className="chosen-item">
                <span className="chosen-item-name">
                  <span className="chosen-item-category">
                    <CategoryPicture cat={item.product.category} size={36} />
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
                      <CategoryPicture cat={cat} size={68} />
                      <strong>{cat}</strong>
                      {count === 0 && <small>ไม่มีสินค้า</small>}
                    </button>
                  );
                })}
              </div>
              <div ref={skuPickerSectionRef}>
                {category ? (
                  <SkuPicker
                    key={`${category}:${pickerRun}`}
                    models={models}
                    categories={categoryList ?? undefined}
                    onPick={setPicked}
                    onComplete={handleAddPicked}
                  />
                ) : (
                  <p className="muted picker-hint">เลือกประเภทอุปกรณ์ด้านบนก่อน</p>
                )}
              </div>

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
                          {picked.sku.attributes && Object.keys(picked.sku.attributes).length > 0
                            ? Object.values(picked.sku.attributes).filter(Boolean).join(' · ')
                            : [picked.sku.memory, picked.sku.storage, picked.sku.color]
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
        <legend>
          Accessories{' '}
          {selectedAccessoryEntries.length > 0 && (
            <small
              className="legend-note"
              style={{ color: 'var(--primary-dark, #007d79)', fontWeight: 600 }}
            >
              (เลือกแล้ว {selectedAccessoryEntries.length} รายการ)
            </small>
          )}
        </legend>

        {/* Selected accessories pinned list */}
        {selectedAccessoryEntries.length > 0 && (
          <div
            style={{
              background: 'var(--primary-subtle, #f0fdf4)',
              border: '1px solid var(--primary-border, #bbf7d0)',
              borderRadius: '8px',
              padding: '10px 12px',
              marginBottom: '12px',
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: '8px',
              }}
            >
              <span
                style={{
                  fontSize: '13px',
                  fontWeight: 600,
                  color: 'var(--primary-dark, #007d79)',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                }}
              >
                <ShoppingBag size={14} />
                รายการที่เลือก ({selectedAccessoryEntries.length} รายการ)
              </span>
              <button
                type="button"
                onClick={() => onChange({ ...value, accessories: {} })}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: '#dc2626',
                  fontSize: '11.5px',
                  cursor: 'pointer',
                  padding: '2px 4px',
                  fontWeight: 500,
                }}
              >
                ล้างทั้งหมด
              </button>
            </div>
            <div style={{ display: 'grid', gap: '6px' }}>
              {selectedAccessoryEntries.map(([name, qty]) => {
                const invalid = !quantityIsValid(qty);
                const fieldId = `sel-qty-${name.replaceAll(/[^\w\u0E00-\u0E7F]/g, '')}`;
                return (
                  <div
                    key={name}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      background: 'white',
                      padding: '6px 10px',
                      borderRadius: '6px',
                      border: '1px solid #d4e0d9',
                      gap: '8px',
                    }}
                  >
                    <span
                      style={{
                        fontSize: '12.5px',
                        fontWeight: 500,
                        color: 'var(--text-primary)',
                        flex: 1,
                        minWidth: 0,
                        wordBreak: 'break-word',
                      }}
                    >
                      {name}
                    </span>
                    <div className="qty-stepper" style={{ flexShrink: 0 }}>
                      <button
                        type="button"
                        aria-label={`ลดจำนวน ${name}`}
                        onClick={() =>
                          onChange({
                            ...value,
                            accessories: stepAccessory(value.accessories, name, -1),
                          })
                        }
                      >
                        −
                      </button>
                      <input
                        type="text"
                        inputMode="numeric"
                        value={qty}
                        aria-invalid={invalid}
                        aria-describedby={invalid ? fieldId : undefined}
                        style={{ width: '32px', textAlign: 'center' }}
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
                            accessories: stepAccessory(value.accessories, name, 1),
                          })
                        }
                      >
                        +
                      </button>
                      <button
                        type="button"
                        aria-label={`ลบ ${name}`}
                        title="ลบรายการนี้"
                        style={{
                          border: 'none',
                          background: 'transparent',
                          color: 'var(--text-muted, #737373)',
                          cursor: 'pointer',
                          marginLeft: '2px',
                          padding: '2px',
                          display: 'inline-flex',
                          alignItems: 'center',
                        }}
                        onClick={() => {
                          const next = { ...value.accessories };
                          delete next[name];
                          onChange({ ...value, accessories: next });
                        }}
                      >
                        <X size={14} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Search Bar */}
        <div
          style={{
            position: 'relative',
            marginBottom: '10px',
            marginTop: '4px',
          }}
        >
          <Search
            size={16}
            style={{
              position: 'absolute',
              left: '12px',
              top: '50%',
              transform: 'translateY(-50%)',
              color: 'var(--text-muted, #737373)',
              pointerEvents: 'none',
            }}
          />
          <input
            type="text"
            value={accessorySearch}
            onChange={(e) => setAccessorySearch(e.target.value)}
            placeholder="ค้นหาอุปกรณ์เสริม เช่น iPhone Case, Cable, Adapter..."
            style={{
              width: '100%',
              padding: '8px 34px 8px 36px',
              borderRadius: '8px',
              border: '1px solid var(--border-color, #d4e0d9)',
              fontSize: '13.5px',
              background: 'var(--bg-surface, #ffffff)',
              boxSizing: 'border-box',
            }}
          />
          {accessorySearch && (
            <button
              type="button"
              onClick={() => setAccessorySearch('')}
              aria-label="ล้างคำค้นหา"
              style={{
                position: 'absolute',
                right: '8px',
                top: '50%',
                transform: 'translateY(-50%)',
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                color: 'var(--text-muted, #737373)',
                padding: '4px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <X size={14} />
            </button>
          )}
        </div>

        {displayedAccessoryGroups.length === 0 ? (
          <p
            className="muted"
            style={{
              padding: '16px 0',
              fontSize: '13px',
              textAlign: 'center',
            }}
          >
            {accessorySearch.trim()
              ? `ไม่พบหมวดหมู่อุปกรณ์เสริมที่ตรงกับ "${accessorySearch}"`
              : 'ไม่มีรายการอุปกรณ์เสริมในขณะนี้'}
          </p>
        ) : (
          <div
            className="accessory-list"
            style={
              displayedAccessoryGroups.length > 6
                ? { maxHeight: '560px', overflowY: 'auto', paddingRight: '4px' }
                : undefined
            }
          >
            {displayedAccessoryGroups.map((group) => {
              const isExpanded = expandedGroup === group.id;
              const groupCartCount = selectedAccessoryEntries
                .filter(([k]) => group.products.some((p) => isAccessoryFromProduct(p, k)))
                .reduce((sum, [, q]) => sum + (Number(q) || 0), 0);

              return (
                <div
                  className={`accessory-item${isExpanded ? ' expanded' : ''}${groupCartCount > 0 ? ' selected' : ''}`}
                  key={group.id}
                  style={{
                    padding: '12px 14px',
                    borderRadius: '10px',
                    marginBottom: '8px',
                  }}
                >
                  <div
                    className="accessory-row"
                    style={{
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: '8px',
                    }}
                    onClick={() =>
                      setExpandedGroup(isExpanded ? null : group.id)
                    }
                  >
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        minWidth: 0,
                      }}
                    >
                      <strong
                        style={{
                          fontSize: '14.5px',
                          color: 'var(--text-primary)',
                        }}
                      >
                        {group.name}
                      </strong>
                      {groupCartCount > 0 && (
                        <span
                          style={{
                            fontSize: '11px',
                            fontWeight: 600,
                            color: '#0abab5',
                            background: 'rgba(10, 186, 181, 0.12)',
                            padding: '2px 8px',
                            borderRadius: '12px',
                          }}
                        >
                          เลือกแล้ว {groupCartCount} ชิ้น
                        </span>
                      )}
                    </div>
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                        flexShrink: 0,
                      }}
                    >
                      <span className="fine muted" style={{ fontSize: '13px' }}>
                        {group.modelsCount} รุ่น
                      </span>
                      <span
                        style={{
                          fontSize: '14px',
                          color: 'var(--text-muted, #737373)',
                          transform: isExpanded ? 'rotate(180deg)' : 'none',
                          transition: 'transform 0.2s ease',
                          display: 'inline-flex',
                        }}
                      >
                        <ChevronDown size={18} />
                      </span>
                    </div>
                  </div>

                  {isExpanded && (
                    <AccessoryCategoryPicker
                      category={
                        group.category || {
                          id: group.id,
                          name: group.name,
                          active: true,
                          position: 0,
                          isAccessory: true,
                          erpManaged: false,
                        }
                      }
                      products={group.products}
                      defaultIPhoneModel={defaultIPhoneModel}
                      defaultIPadModel={defaultIPadModel}
                      cartAccessories={value.accessories}
                      onAddAccessory={handleAddAccessory}
                    />
                  )}
                </div>
              );
            })}
          </div>
        )}
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
          Payment{' '}
          <span className="required">*</span>
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
                            if (isZeroPercent) {
                              setTimeout(() => {
                                monthsSectionRef.current?.scrollIntoView({
                                  behavior: 'smooth',
                                  block: 'nearest',
                                });
                              }, 60);
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
                    ref={monthsSectionRef}
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

                <div className="card-modal-footer">
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
          ประเภทใบเสร็จ{' '}
          <span className="required">*</span>
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
          ประเภทส่วนลด{' '}
          <span className="required">*</span>
        </legend>
        <div
          role="radiogroup"
          aria-label="ประเภทส่วนลด"
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
            gap: '8px',
            marginTop: '6px',
          }}
        >
          {DISCOUNT_TYPE_OPTIONS.map((opt) => {
            const selected = value.discountType === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => onChange({ ...value, discountType: opt.value })}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: '10px 14px',
                  border: `1.5px solid ${selected ? 'var(--primary)' : 'var(--border-color)'}`,
                  borderRadius: '8px',
                  background: selected ? 'var(--primary-subtle)' : 'var(--bg-surface)',
                  color: selected ? 'var(--primary-dark, var(--text-primary))' : 'var(--text-primary)',
                  fontWeight: selected ? 600 : 500,
                  fontSize: '14px',
                  cursor: 'pointer',
                  transition:
                    'border-color 150ms cubic-bezier(0.22, 1, 0.36, 1), background-color 150ms cubic-bezier(0.22, 1, 0.36, 1)',
                  userSelect: 'none',
                }}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      </fieldset>
      <fieldset>
        <legend>
          เอกสารภาษีเพิ่มเติม / VAT Refund
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
      <fieldset>
        <legend>
          ลูกค้ามาจากช่องทางใด {' '}
          <span className="required">*</span>
        </legend>
        <div
          role="radiogroup"
          aria-label="ลูกค้ามาจากช่องทางใด"
          className="customer-source-grid"
        >
          {CUSTOMER_SOURCE_OPTIONS.map((opt) => {
            const selected = value.customerSource === opt.value;
            return (
              <label
                key={opt.value}
                className={`customer-source-card ${selected ? 'selected' : ''}`}
              >
                <input
                  type="radio"
                  name="customerSource"
                  value={opt.value}
                  checked={selected}
                  onChange={() => onChange({ ...value, customerSource: opt.value })}
                  style={{
                    width: '18px',
                    height: '18px',
                    margin: 0,
                    cursor: 'pointer',
                    accentColor: 'var(--primary)',
                    flexShrink: 0,
                  }}
                />
                <span
                  style={{
                    fontSize: '13.5px',
                    fontWeight: selected ? 600 : 500,
                    color: selected ? 'var(--primary-dark, var(--text-primary))' : 'var(--text-primary)',
                    lineHeight: 1.35,
                  }}
                >
                  {opt.label}
                </span>
              </label>
            );
          })}
        </div>
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
          role={value.items.length > 0 ? 'button' : undefined}
          tabIndex={value.items.length > 0 ? 0 : undefined}
          aria-label={value.items.length > 0 ? 'ดูรายการสินค้าที่เลือก' : undefined}
          className={`mobile-sticky-summary${value.items.length > 0 ? ' interactive' : ''}`}
          onClick={() => {
            if (value.items.length > 0) setCartModalOpen(true);
          }}
          onKeyDown={(e) => {
            if (value.items.length > 0 && (e.key === 'Enter' || e.key === ' ')) {
              e.preventDefault();
              setCartModalOpen(true);
            }
          }}
          style={{
            flex: 1,
            minWidth: 0,
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            cursor: value.items.length > 0 ? 'pointer' : 'default',
            userSelect: 'none',
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

      {/* Cart Summary Modal */}
      {cartModalOpen && (() => {
        const totalMainQty = value.items.reduce((sum, item) => sum + item.quantity, 0);
        const accEntries = Object.entries(value.accessories).filter(([, qty]) => Number(qty) > 0);
        const totalAccQty = accEntries.reduce((sum, [, qty]) => sum + (Number(qty) || 0), 0);

        return (
          <Modal
            isOpen={true}
            onClose={() => setCartModalOpen(false)}
            title={
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
                <ShoppingBag size={20} color="#0abab5" />
                รายการสินค้าที่เลือก
              </span>
            }
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {/* Summary count banner */}
              <div
                style={{
                  background: 'var(--primary-subtle, #f0fdf4)',
                  border: '1px solid var(--primary-border, #bbf7d0)',
                  borderRadius: '8px',
                  padding: '10px 14px',
                  fontSize: '13px',
                  color: 'var(--primary-dark, #166534)',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  flexWrap: 'wrap',
                  gap: '6px',
                }}
              >
                <span>
                  รวมสินค้าหลัก <strong>{value.items.length}</strong> รายการ
                </span>
                <span>
                  อุปกรณ์เสริม <strong>{accEntries.length}</strong> รายการ
                </span>
              </div>

              {/* Main Items Section */}
              <div>
                <h4 style={{ margin: '0 0 10px', fontSize: '14px', color: 'var(--text-primary)' }}>
                  สินค้าหลัก ({value.items.length})
                </h4>
                <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: '8px' }}>
                  {value.items.map((item, idx) => (
                    <li
                      key={item.id ?? `${item.product.id}-${idx}`}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '12px',
                        padding: '10px 12px',
                        background: 'var(--bg-surface)',
                        border: '1px solid var(--border-color)',
                        borderRadius: '8px',
                      }}
                    >
                      <div
                        style={{
                          width: '40px',
                          height: '40px',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          background: 'var(--bg-app)',
                          borderRadius: '6px',
                          flexShrink: 0,
                          overflow: 'hidden',
                        }}
                      >
                        <CategoryPicture cat={item.product.category} size={32} />
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div
                          style={{
                            fontWeight: 600,
                            fontSize: '14px',
                            color: 'var(--text-primary)',
                            lineHeight: 1.3,
                            wordBreak: 'break-word',
                          }}
                        >
                          {itemName(item)}
                        </div>
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '6px',
                            marginTop: '2px',
                            fontSize: '12px',
                            color: 'var(--text-muted)',
                            fontFamily: 'ui-monospace, monospace',
                          }}
                        >
                          <span>{item.product.sku || '—'}</span>
                          {item.product.category && (
                            <span style={{ color: '#0abab5', fontWeight: 500 }}>
                              · {item.product.category}
                            </span>
                          )}
                        </div>
                      </div>
                      <div
                        style={{
                          flexShrink: 0,
                          fontSize: '14px',
                          fontWeight: 700,
                          color: '#0abab5',
                          padding: '4px 10px',
                          background: 'rgba(10, 186, 181, 0.1)',
                          borderRadius: '16px',
                        }}
                      >
                        × {item.quantity}
                      </div>
                    </li>
                  ))}
                </ul>
              </div>

              {/* Accessories Section */}
              <div>
                <h4 style={{ margin: '0 0 10px', fontSize: '14px', color: 'var(--text-primary)' }}>
                  อุปกรณ์เสริม ({accEntries.length})
                </h4>
                {accEntries.length > 0 ? (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                    {accEntries.map(([name, qty]) => (
                      <span key={name} className="accessory-chip-pill">
                        <strong>{name}</strong>
                        <span style={{ color: '#0abab5', fontWeight: 700 }}>
                          × {qty}
                        </span>
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="muted" style={{ margin: 0, fontSize: '13px' }}>
                    ไม่มีอุปกรณ์เสริม
                  </p>
                )}
              </div>

              {/* Close Button */}
              <div style={{ marginTop: '8px', display: 'flex', justifyContent: 'flex-end' }}>
                <Button variant="secondary" onClick={() => setCartModalOpen(false)} style={{ minWidth: '80px' }}>
                  ปิด
                </Button>
              </div>
            </div>
          </Modal>
        );
      })()}
    </>
  );
}
