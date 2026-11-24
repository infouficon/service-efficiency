import { useState, useMemo, useEffect, useRef } from 'react';
import {
  ArrowRight,
  Trash2,
  CheckCircle2,
  Smartphone,
  AlertCircle,
} from 'lucide-react';
import { Button } from '../../components/ui';
import { deviceCategories } from '../../constants/options';
import { SkuPicker } from './SkuPicker';
import { CategoryPicture, StockBadge } from './SelectionEditor';
import {
  formatPrice,
  isOutOfStock,
  modelChoices,
  toCatalog,
  type CatalogProduct,
  type Picked,
} from './catalog';
import {
  fetchCategoriesApi,
  fetchProductsApi,
} from '../../services/sessionApi';
import type { Category } from '../../types/session';

/** Format SKU specifications for display (D142) */
function formatSkuSpecs(sku: {
  memory?: string | null;
  storage?: string | null;
  color?: string | null;
  attributes?: Record<string, string> | null;
}): string {
  const parts: string[] = [];
  if (sku.attributes && Object.keys(sku.attributes).length > 0) {
    for (const val of Object.values(sku.attributes)) {
      if (val && val.trim() && !parts.includes(val.trim())) {
        parts.push(val.trim());
      }
    }
  }
  if (sku.memory && sku.memory.trim() && !parts.includes(sku.memory.trim())) {
    parts.unshift(sku.memory.trim());
  }
  if (sku.storage && sku.storage.trim() && !parts.includes(sku.storage.trim())) {
    parts.push(sku.storage.trim());
  }
  if (sku.color && sku.color.trim() && !parts.includes(sku.color.trim())) {
    parts.push(sku.color.trim());
  }
  return parts.join(' · ');
}

/**
 * Step 1 of staff workflow (D131, D132, D133):
 * "ลูกค้าสนใจอะไร" - Pick up to 3 distinct main products of interest (even if out of stock).
 * Colors are always shown and must be explicitly clicked.
 * Clicking "ถัดไป" creates the session with reference SES-YYYYMMDD-000001 and moves to Step 2.
 */
export function WalkInForm({
  busy,
  onSubmit,
}: {
  busy: boolean;
  onSubmit: (pickedItems: Picked[]) => void;
}) {
  const [catalog, setCatalog] = useState<CatalogProduct[] | null>(null);
  const [categoryList, setCategoryList] = useState<Category[] | null>(null);
  const [category, setCategory] = useState<string>('');
  const [selectedItems, setSelectedItems] = useState<Picked[]>([]);
  const [pickerRun, setPickerRun] = useState(0);
  const [loadError, setLoadError] = useState('');
  const [duplicateWarning, setDuplicateWarning] = useState('');
  const categorySectionRef = useRef<HTMLDivElement>(null);
  const skuPickerSectionRef = useRef<HTMLDivElement>(null);

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
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  const categoryTiles = useMemo<readonly string[]>(
    () =>
      categoryList
        ? categoryList.filter((c) => !c.isAccessory).map((c) => c.name)
        : deviceCategories,
    [categoryList],
  );

  const models = useMemo(
    () => modelChoices(catalog, category),
    [catalog, category],
  );

  const handleCategoryChange = (cat: string) => {
    setCategory(cat);
    setDuplicateWarning('');
    setPickerRun((n) => n + 1);
    setTimeout(() => {
      skuPickerSectionRef.current?.scrollIntoView({
        behavior: 'smooth',
        block: 'start',
      });
    }, 50);
  };

  /**
   * Auto-add to interested list immediately upon completing selection (D132, D133)
   * Out of stock products are allowed in this step to track customer interest.
   */
  const handleCompletePick = (pickedObj: Picked) => {
    if (!pickedObj) return;
    if (selectedItems.length >= 3) return;

    // Disallow duplicate SKU
    const isDup = selectedItems.some(
      (item) => item.sku.id === pickedObj.sku.id,
    );
    if (isDup) {
      const specsText = formatSkuSpecs(pickedObj.sku);
      setDuplicateWarning(
        `สินค้ารายการนี้ (${pickedObj.model.name}${specsText ? ` · ${specsText}` : ''}) อยู่ในรายการที่เลือกไว้แล้ว`,
      );
      return;
    }

    setDuplicateWarning('');
    setSelectedItems((prev) => [...prev, pickedObj]);
    // Reset picker back to the 8 category tiles
    setCategory('');
    setPickerRun((n) => n + 1);

    if (typeof window !== 'undefined') {
      setTimeout(() => {
        const mainEl = document.querySelector('main');
        if (mainEl && mainEl.scrollTop > 0) {
          mainEl.scrollTo({ top: 0, behavior: 'smooth' });
        }
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }, 50);
    }
  };

  const handleRemoveItem = (skuId: string) => {
    setSelectedItems((prev) => prev.filter((item) => item.sku.id !== skuId));
    setDuplicateWarning('');
  };

  return (
    <div className="walkin-product-flow">
      {/* Top Section: Product Picker */}
      <div
        style={{
          background: '#ffffff',
          borderRadius: '12px',
          border: '1px solid #e2e8f0',
          boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
          padding: '18px 20px',
          marginBottom: '20px',
        }}
      >
        {selectedItems.length >= 3 ? (
          <div
            style={{
              padding: '18px 16px',
              borderRadius: '8px',
              background: '#f0fdf4',
              border: '1px solid #bbf7d0',
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
              color: '#166534',
            }}
          >
            <CheckCircle2
              size={24}
              style={{ flexShrink: 0, color: '#16a34a' }}
            />
            <div>
              <div style={{ fontWeight: 600 }}>
                เลือกสินค้าที่สนใจครบ 3 รายการแล้ว
              </div>
            </div>
          </div>
        ) : (
          <>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: '12px',
              }}
            >
              <span
                style={{
                  fontWeight: 600,
                  fontSize: '0.95rem',
                  color: '#1e293b',
                }}
              >
                {selectedItems.length === 0
                  ? 'เลือกหมวดหมู่และสเปกสินค้าที่ลูกค้าสนใจ'
                  : `เลือกสินค้าที่ ${selectedItems.length + 1} เพิ่มเติม (ไม่บังคับ)`}
              </span>
              <span style={{ fontSize: '0.82rem', color: '#64748b' }}>
                เลือกได้อีก {3 - selectedItems.length} รายการ
              </span>
            </div>

            {duplicateWarning && (
              <div
                style={{
                  marginBottom: '12px',
                  padding: '10px 14px',
                  borderRadius: '8px',
                  background: '#fffbeb',
                  border: '1px solid #fde68a',
                  color: '#b45309',
                  fontSize: '0.88rem',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                }}
              >
                <AlertCircle size={18} style={{ flexShrink: 0 }} />
                <span>{duplicateWarning}</span>
              </div>
            )}

            {loadError && <p className="field-error">{loadError}</p>}

            {/* 8 Categories grid: 4 columns on desktop/tablet, 3 on mobile */}
            <div
              ref={categorySectionRef}
              className="wizard-tiles picker-category-tiles"
              role="group"
              aria-label="ประเภทอุปกรณ์"
              style={{ scrollMarginTop: '16px' }}
            >
              {categoryTiles.map((cat) => {
                const active = category === cat;
                const count = (catalog ?? []).filter(
                  (p) => p.category === cat,
                ).length;
                return (
                  <button
                    key={cat}
                    type="button"
                    className={`wizard-tile wizard-tile-category${active ? ' selected' : ''}`}
                    aria-pressed={active}
                    disabled={count === 0}
                    onClick={() => handleCategoryChange(cat)}
                  >
                    <CategoryPicture cat={cat} size={64} />
                    <strong>{cat}</strong>
                    {count === 0 && (
                      <span className="no-stock-label">ไม่มีสินค้า</span>
                    )}
                  </button>
                );
              })}
            </div>

            <div
              ref={skuPickerSectionRef}
              style={{ marginTop: '16px', scrollMarginTop: '16px' }}
            >
              {category ? (
                <SkuPicker
                  key={`${category}:${pickerRun}`}
                  models={models}
                  categories={categoryList ?? undefined}
                  onPick={() => {}}
                  onComplete={handleCompletePick}
                  allowOutOfStock={true}
                />
              ) : (
                <p className="muted picker-hint" style={{ marginTop: '16px' }}>
                  เลือกหมวดสินค้าที่ลูกค้าสนใจ
                  (สูงสุด 3 รายการ)
                </p>
              )}
            </div>
          </>
        )}
      </div>

      {/* Bottom Section: Selected Interested Products (Up to 3) */}
      <div
        style={{
          background: '#ffffff',
          borderRadius: '12px',
          border: '1px solid #e2e8f0',
          boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
          padding: '18px 20px',
          marginBottom: '20px',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: selectedItems.length > 0 ? '14px' : '0',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span
              style={{ fontWeight: 700, fontSize: '1rem', color: '#0f172a' }}
            >
              สินค้าที่สนใจ
            </span>
            <span
              style={{
                fontSize: '0.8rem',
                fontWeight: 600,
                padding: '2px 8px',
                borderRadius: '12px',
                background: selectedItems.length === 3 ? '#ecfdf5' : '#f1f5f9',
                color: selectedItems.length === 3 ? '#047857' : '#475569',
              }}
            >
              {selectedItems.length} / 3 รายการ
            </span>
          </div>
          {selectedItems.length === 3 && (
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px',
                fontSize: '0.82rem',
                fontWeight: 600,
                color: '#059669',
              }}
            >
              <CheckCircle2 size={15} />
              เลือกครบ 3 รายการแล้ว
            </span>
          )}
        </div>

        {selectedItems.length === 0 ? (
          <div
            style={{
              marginTop: '12px',
              padding: '24px 16px',
              borderRadius: '8px',
              background: '#f8fafc',
              border: '1.5px dashed #cbd5e1',
              textAlign: 'center',
              color: '#64748b',
            }}
          >
            <Smartphone
              size={28}
              style={{ margin: '0 auto 8px', color: '#94a3b8' }}
            />
            <div
              style={{ fontWeight: 600, fontSize: '0.95rem', color: '#334155' }}
            >
              ยังไม่มีสินค้าในรายการ
            </div>
            <div style={{ fontSize: '0.85rem', marginTop: '4px' }}>
              เลือกสินค้าที่ลูกค้าสนใจ (สูงสุด 3 รายการ)
            </div>
          </div>
        ) : (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
              gap: '10px',
            }}
          >
            {selectedItems.map((item, idx) => {
              const outOfStock = isOutOfStock(item.sku);
              return (
                <div
                  key={item.sku.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '10px 12px',
                    borderRadius: '8px',
                    background: outOfStock ? '#fef2f2' : '#f8fafc',
                    border: outOfStock
                      ? '1px solid #fecaca'
                      : '1px solid #e2e8f0',
                    gap: '10px',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '10px',
                      minWidth: 0,
                    }}
                  >
                    <div
                      style={{
                        width: '20px',
                        height: '20px',
                        borderRadius: '50%',
                        background: outOfStock ? '#ef4444' : '#0abab5',
                        color: '#fff',
                        fontSize: '0.75rem',
                        fontWeight: 700,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0,
                      }}
                    >
                      {idx + 1}
                    </div>
                    <CategoryPicture cat={item.product.category} size={36} />
                    <div style={{ minWidth: 0 }}>
                      <div
                        style={{
                          fontWeight: 600,
                          fontSize: '0.88rem',
                          color: '#0f172a',
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                        }}
                        title={item.model.name}
                      >
                        {item.model.name}
                      </div>
                      <div
                        style={{
                          fontSize: '0.78rem',
                          color: '#64748b',
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                        }}
                      >
                        {formatSkuSpecs(item.sku)}
                      </div>
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '6px',
                          marginTop: '2px',
                        }}
                      >
                        {item.sku.price != null && (
                          <span
                            style={{
                              fontSize: '12px',
                              fontWeight: 700,
                              color: '#0f766e',
                            }}
                          >
                            {formatPrice(item.sku.price)}
                          </span>
                        )}
                        <StockBadge sku={item.sku} />
                      </div>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleRemoveItem(item.sku.id)}
                    title="ลบรายการนี้"
                    aria-label="ลบรายการนี้"
                    disabled={busy}
                    style={{
                      background: 'transparent',
                      border: 'none',
                      color: '#94a3b8',
                      cursor: 'pointer',
                      padding: '6px',
                      borderRadius: '6px',
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      transition: 'color 0.15s, background 0.15s',
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.color = '#ef4444';
                      e.currentTarget.style.background = '#fee2e2';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.color = '#94a3b8';
                      e.currentTarget.style.background = 'transparent';
                    }}
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Desktop Footer Navigation Bar */}
      <div
        className="desktop-actions"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingTop: '6px',
        }}
      >
        <div style={{ fontSize: '0.9rem', color: '#64748b' }}>
          {selectedItems.length > 0 ? (
            <span>
              พร้อมเริ่มบริการด้วย <strong>{selectedItems.length}</strong>{' '}
              รายการสินค้า
            </span>
          ) : (
            <span>กรุณาเลือกสินค้าอย่างน้อย 1 รายการเพื่อดำเนินการต่อ</span>
          )}
        </div>
        <Button
          type="button"
          size="lg"
          disabled={selectedItems.length === 0 || busy}
          onClick={() => onSubmit(selectedItems)}
        >
          <span
            style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
          >
            ถัดไป{' '}
            {selectedItems.length > 0 ? `(${selectedItems.length} รายการ)` : ''}
            <ArrowRight size={18} />
          </span>
        </Button>
      </div>

      {/* Mobile Sticky Navigation Bar */}
      <div className="mobile-sticky-bar">
        <Button
          type="button"
          size="lg"
          disabled={selectedItems.length === 0 || busy}
          onClick={() => onSubmit(selectedItems)}
          style={{ width: '100%', height: '48px', fontSize: '15px' }}
        >
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px',
              width: '100%',
            }}
          >
            ถัดไป{' '}
            {selectedItems.length > 0 ? `(${selectedItems.length} รายการ)` : ''}
            <ArrowRight size={18} />
          </span>
        </Button>
      </div>
    </div>
  );
}
