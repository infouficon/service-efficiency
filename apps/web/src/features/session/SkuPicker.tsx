import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';
import { distinct } from './workflow';
import {
  formatPrice,
  getSkuAttribute,
  isOutOfStock,
  isUnlimited,
  type CatalogSku,
  type ModelChoice,
  type Picked,
} from './catalog';
import type { Category, CategoryAttributeSpec } from '../../types/session';
import { api } from '../../services/api';

function stockText(s: CatalogSku): string {
  if (isUnlimited(s)) return 'มีจำหน่าย';
  if (isOutOfStock(s)) return 'หมด';
  if (typeof s.stock === 'number') return `เหลือ ${s.stock}`;
  return 'พร้อมขาย';
}

function getOptionStockText(skusForOption: CatalogSku[]): { text: string; outOfStock: boolean } {
  if (skusForOption.length === 0) return { text: '', outOfStock: true };
  if (skusForOption.every(isOutOfStock)) return { text: 'สินค้าหมด', outOfStock: true };
  if (skusForOption.some(isUnlimited)) return { text: 'มีจำหน่าย', outOfStock: false };

  const totalStock = skusForOption.reduce(
    (sum, s) => sum + (typeof s.stock === 'number' ? s.stock : 0),
    0,
  );
  if (totalStock > 0) return { text: `เหลือ ${totalStock} ชิ้น`, outOfStock: false };
  return { text: 'พร้อมขาย', outOfStock: false };
}

const isColorSpec = (spec: CategoryAttributeSpec) =>
  spec.key.toLowerCase() === 'color' || spec.label.trim() === 'สี';

const isTwoColumns = (options: string[]) =>
  options.length <= 2 && options.every((opt) => opt.length <= 16);

/** "wi-fi", "WiFi" and "wifi" are the same to someone typing on a phone. */
const searchable = (text: string) => text.toLowerCase().replaceAll('-', '');

/**
 * Pick one SKU of a category (D78, D79, D142, D144):
 * Clean Apple Store-style configurator layout in the system's teal theme.
 * Displays Model header, then step-by-step option cards and circular color swatches.
 */
export function SkuPicker({
  models,
  categorySpecs,
  categories,
  onPick,
  onComplete,
  allowOutOfStock = false,
}: {
  models: ModelChoice[];
  categorySpecs?: CategoryAttributeSpec[];
  categories?: Category[];
  onPick: (picked: Picked | null) => void;
  onComplete?: (picked: Picked) => void;
  allowOutOfStock?: boolean;
}) {
  const [modelKey, setModelKey] = useState('');
  const [selectedValues, setSelectedValues] = useState<Record<string, string>>({});
  const [skuId, setSkuId] = useState('');
  const [query, setQuery] = useState('');
  const [colorMap, setColorMap] = useState<Record<string, string>>({});
  const rootRef = useRef<HTMLDivElement>(null);
  const labelId = useId();

  // Load color palette mapping for color swatches
  useEffect(() => {
    let active = true;
    api<Record<string, string>>('/colors/map')
      .then((m) => {
        if (active && m) setColorMap(m);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  const chosen = models.find((m) => m.key === modelKey) ?? null;
  const modelSkus = useMemo(() => chosen?.model.skus ?? [], [chosen]);

  // Resolve category specifications template (D142, D144)
  const categoryName = chosen?.product.category ?? '';
  const resolvedSpecs = useMemo<CategoryAttributeSpec[]>(() => {
    if (!chosen) return [];
    if (categorySpecs && categorySpecs.length > 0) return categorySpecs;
    if (categoryName) {
      const fromCat = categories?.find(
        (c) => c.name.toLowerCase() === categoryName.toLowerCase(),
      )?.attributes;
      if (fromCat && fromCat.length > 0) return fromCat;
    }
    // Dynamic fallback when no template: check if memory or storage or color exist in SKUs
    const fallback: CategoryAttributeSpec[] = [];
    if (modelSkus.some((s) => s.memory)) {
      fallback.push({ key: 'memory', label: 'RAM', required: true });
    }
    if (modelSkus.some((s) => s.storage)) {
      fallback.push({ key: 'storage', label: 'ความจุ', required: true });
    }
    if (modelSkus.some((s) => s.color)) {
      fallback.push({ key: 'color', label: 'สี', required: true });
    }
    return fallback;
  }, [chosen, categorySpecs, categories, categoryName, modelSkus]);

  // Ensure color is present in specs if SKUs have colors
  const allSpecs = useMemo<CategoryAttributeSpec[]>(() => {
    const list = [...resolvedSpecs];
    if (modelSkus.some((s) => s.color) && !list.some(isColorSpec)) {
      list.push({ key: 'color', label: 'สี', required: true });
    }
    return list;
  }, [resolvedSpecs, modelSkus]);

  // Compute available choices and candidate SKUs for each step
  const { steps, remainingSkus } = useMemo(() => {
    let candidates = modelSkus;
    const computedSteps: {
      spec: CategoryAttributeSpec;
      options: string[];
      selectedValue: string;
      skusAtStep: CatalogSku[];
    }[] = [];

    for (const spec of allSpecs) {
      const options = distinct(candidates.map((s) => getSkuAttribute(s, spec.key)).filter(Boolean));
      if (options.length === 0) continue;

      const currentVal = selectedValues[spec.key] || '';
      computedSteps.push({
        spec,
        options,
        selectedValue: currentVal,
        skusAtStep: candidates,
      });

      if (currentVal) {
        candidates = candidates.filter((s) => getSkuAttribute(s, spec.key) === currentVal);
      } else {
        break; // Pause further spec evaluation until current step is selected
      }
    }

    return { steps: computedSteps, remainingSkus: candidates };
  }, [allSpecs, modelSkus, selectedValues]);

  // Helper to cascade-select single choices automatically
  const resolveAutoChoices = (
    skus: CatalogSku[],
    specs: CategoryAttributeSpec[],
    currentVals: Record<string, string>,
  ) => {
    let candidates = skus;
    const nextValues: Record<string, string> = { ...currentVals };

    for (const spec of specs) {
      const options = distinct(candidates.map((s) => getSkuAttribute(s, spec.key)).filter(Boolean));
      if (options.length === 1) {
        nextValues[spec.key] = options[0];
        candidates = candidates.filter((s) => getSkuAttribute(s, spec.key) === options[0]);
      } else if (nextValues[spec.key] && options.includes(nextValues[spec.key])) {
        candidates = candidates.filter((s) => getSkuAttribute(s, spec.key) === nextValues[spec.key]);
      } else {
        delete nextValues[spec.key];
        break;
      }
    }
    return { nextValues, remainingSkus: candidates };
  };

  const pickModel = (m: ModelChoice) => {
    setModelKey(m.key);
    // Auto-resolve single choices for this model
    const mSkus = m.model.skus;
    const catName = m.product.category ?? '';
    let specs = categorySpecs && categorySpecs.length > 0 ? categorySpecs : [];
    if (specs.length === 0 && catName) {
      specs = categories?.find((c) => c.name.toLowerCase() === catName.toLowerCase())?.attributes ?? [];
    }
    const { nextValues, remainingSkus: rem } = resolveAutoChoices(mSkus, specs, {});
    setSelectedValues(nextValues);

    if (rem.length === 1) {
      const single = rem[0];
      setSkuId(single.id);
      const pickedObj = { product: m.product, model: m.model, sku: single };
      onPick(pickedObj);
      if (allowOutOfStock || !isOutOfStock(single)) {
        onComplete?.(pickedObj);
      }
    } else {
      setSkuId('');
      onPick(null);
    }
  };

  const handleStepChange = (specKey: string, value: string) => {
    const initial: Record<string, string> = {};
    for (const s of allSpecs) {
      if (s.key === specKey) {
        initial[s.key] = value;
        break;
      }
      if (selectedValues[s.key]) {
        initial[s.key] = selectedValues[s.key];
      }
    }

    const { nextValues, remainingSkus: nextRemaining } = resolveAutoChoices(modelSkus, allSpecs, initial);
    setSelectedValues(nextValues);

    if (nextRemaining.length === 1 && chosen) {
      const single = nextRemaining[0];
      setSkuId(single.id);
      const pickedObj = { product: chosen.product, model: chosen.model, sku: single };
      onPick(pickedObj);
      if (allowOutOfStock || !isOutOfStock(single)) {
        onComplete?.(pickedObj);
      }
    } else {
      setSkuId('');
      onPick(null);
    }
  };

  const singleResolvedSku = remainingSkus.length === 1 && skuId === remainingSkus[0].id ? remainingSkus[0] : null;

  // Filter models by query
  const shown = useMemo(() => {
    const q = searchable(query.trim());
    if (!q) return models;
    return models.filter((m) => searchable(m.model.name).includes(q));
  }, [models, query]);

  return (
    <div className="sku-picker" ref={rootRef}>
      {/* 1. MODEL SELECTION VIEW (when no model selected yet) */}
      {!chosen ? (
        <div className="picker-field">
          <span className="picker-label" id={labelId}>
            เลือกรุ่นสินค้า <span className="required">*</span>
          </span>
          {models.length === 0 ? (
            <p className="muted">ไม่มีรุ่นสินค้าในหมวดนี้</p>
          ) : (
            <>
              {models.length > 8 && (
                <label className="model-search">
                  <Search size={16} aria-hidden="true" />
                  <input
                    type="search"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="ค้นหารุ่น เช่น 13 m4"
                    aria-label="ค้นหารุ่น"
                    enterKeyHint="search"
                  />
                  {query && (
                    <button type="button" aria-label="ล้างคำค้น" onClick={() => setQuery('')}>
                      <X size={14} />
                    </button>
                  )}
                </label>
              )}
              <div className="model-list" role="group" aria-labelledby={labelId}>
                {shown.map((m) => {
                  const prices = m.model.skus
                    .map((s) => (s.price != null ? Number(s.price) : null))
                    .filter((p): p is number => p != null && !Number.isNaN(p));
                  const minPrice = prices.length > 0 ? Math.min(...prices) : null;
                  const priceText = minPrice != null ? formatPrice(minPrice) : m.sub || '';
                  return (
                    <button type="button" key={m.key} className="model-option" onClick={() => pickModel(m)}>
                      <strong>{m.model.name}</strong>
                      {priceText && <small>{priceText}</small>}
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </div>
      ) : (
        /* 2. APPLE STORE STYLE CONFIGURATOR CARD (when model is chosen) */
        <div className="spec-config-box">
          {/* Card Header: Chosen Model & Change Button */}
          <div className="spec-config-header">
            <h3 className="spec-config-title">{chosen.model.name}</h3>
            <button
              type="button"
              className="btn btn-secondary"
              style={{ fontSize: '0.85rem', padding: '6px 14px' }}
              onClick={() => {
                setModelKey('');
                setSelectedValues({});
                setSkuId('');
                onPick(null);
              }}
            >
              เปลี่ยนรุ่น
            </button>
          </div>

          {/* Sequential Specification Steps */}
          {steps.map((st) => {
            const isColor = isColorSpec(st.spec);
            const gridColsClass = isTwoColumns(st.options) ? 'cols-2' : 'cols-1';

            return (
              <div key={st.spec.key} className="spec-config-section">
                <div className="spec-config-section-label">
                  <span>{st.spec.label}</span>
                  {st.selectedValue && (
                    <span className="spec-config-selected-val"> - {st.selectedValue}</span>
                  )}
                </div>

                {isColor ? (
                  /* Color Step: Circular Swatches */
                  <div className="spec-swatch-row" role="radiogroup" aria-label={st.spec.label}>
                    {st.options.map((opt) => {
                      const matchingSkus = st.skusAtStep.filter(
                        (s) => getSkuAttribute(s, st.spec.key) === opt,
                      );
                      const stockInfo = getOptionStockText(matchingSkus);
                      const isSelected = st.selectedValue === opt;
                      const hex = colorMap[opt.toLowerCase()] || '#cbd5e1';

                      return (
                        <button
                          type="button"
                          role="radio"
                          key={opt}
                          aria-checked={isSelected}
                          aria-label={`${opt} (${stockInfo.text})`}
                          title={`${opt} — ${stockInfo.text}`}
                          disabled={!allowOutOfStock && stockInfo.outOfStock}
                          className={`spec-swatch-btn ${isSelected ? 'selected' : ''}`}
                          onClick={() => handleStepChange(st.spec.key, opt)}
                        >
                          <span
                            className="spec-swatch-circle"
                            style={{
                              backgroundColor: hex,
                              opacity: !allowOutOfStock && stockInfo.outOfStock ? 0.35 : 1,
                            }}
                          />
                          {isSelected && <span className="spec-swatch-ring" />}
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  /* Option Cards (Grid 1-col or 2-col) */
                  <div className={`spec-card-grid ${gridColsClass}`}>
                    {st.options.map((opt) => {
                      const matchingSkus = st.skusAtStep.filter(
                        (s) => getSkuAttribute(s, st.spec.key) === opt,
                      );
                      const stockInfo = getOptionStockText(matchingSkus);
                      const isSelected = st.selectedValue === opt;

                      return (
                        <button
                          type="button"
                          key={opt}
                          disabled={!allowOutOfStock && stockInfo.outOfStock}
                          className={`spec-option-card ${isSelected ? 'selected' : ''}`}
                          onClick={() => handleStepChange(st.spec.key, opt)}
                        >
                          <span className="spec-option-title">{opt}</span>
                          <span className={`spec-option-sub ${stockInfo.outOfStock ? 'out-of-stock' : ''}`}>
                            {stockInfo.text}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}

          {/* Fallback SKU choice if multiple SKUs remain after all steps */}
          {steps.every((s) => !!s.selectedValue) && remainingSkus.length > 1 && (
            <div className="spec-config-section">
              <div className="spec-config-section-label">
                <span>รายการสินค้า</span>
                {skuId && (
                  <span className="spec-config-selected-val">
                    {' '}
                    - {modelSkus.find((s) => s.id === skuId)?.name}
                  </span>
                )}
              </div>
              <div className="spec-card-grid cols-1">
                {remainingSkus.map((s) => (
                  <button
                    type="button"
                    key={s.id}
                    disabled={!allowOutOfStock && isOutOfStock(s)}
                    className={`spec-option-card ${s.id === skuId ? 'selected' : ''}`}
                    onClick={() => {
                      setSkuId(s.id);
                      const pickedObj = { product: chosen.product, model: chosen.model, sku: s };
                      onPick(pickedObj);
                      if (allowOutOfStock || !isOutOfStock(s)) onComplete?.(pickedObj);
                    }}
                  >
                    <span className="spec-option-title">{s.name} ({s.sku})</span>
                    <span className={`spec-option-sub ${isOutOfStock(s) ? 'out-of-stock' : ''}`}>
                      {stockText(s)}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Footer: Resolved SKU Summary */}
          {singleResolvedSku && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '12px 20px',
                background: 'var(--primary-subtle, #f0fdfa)',
                borderTop: '1px solid var(--border-color, #e5e7eb)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <span style={{ fontSize: '0.85rem', color: '#64748b' }}>รหัส SKU:</span>
                <code style={{ fontSize: '0.9rem', fontWeight: 600 }}>{singleResolvedSku.sku}</code>
                {singleResolvedSku.price != null && (
                  <span style={{ color: '#0f766e', fontWeight: 700, fontSize: '0.95rem' }}>
                    ฿{Number(singleResolvedSku.price).toLocaleString('th-TH')}
                  </span>
                )}
              </div>
              <span
                className={`status-tag ${isOutOfStock(singleResolvedSku) ? 'status-danger' : 'status-success'}`}
                style={{ fontSize: '0.8rem', padding: '3px 8px', borderRadius: '6px' }}
              >
                {stockText(singleResolvedSku)}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Legacy chip button group for backward compatibility where imported */
export function Chips({
  label,
  required = false,
  options,
  value,
  onChange,
}: {
  label: string;
  required?: boolean;
  options: { value: string; label: string; sub?: string; disabled?: boolean }[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="picker-field">
      <span className="picker-label">
        {label} {required && <span className="required">*</span>}
      </span>
      <div className="chip-row" role="radiogroup" aria-label={label}>
        {options.map((o) => (
          <button
            type="button"
            role="radio"
            key={o.value}
            aria-checked={o.value === value}
            className={`chip${o.value === value ? ' selected' : ''}`}
            disabled={o.disabled}
            onClick={() => onChange(o.value)}
          >
            <span>{o.label}</span>
            {o.sub && <small>{o.sub}</small>}
          </button>
        ))}
      </div>
    </div>
  );
}

interface SpecOption {
  value: string;
  label: string;
  sub?: string;
  disabled?: boolean;
}

export function SpecGrid({
  label,
  required = false,
  options,
  value,
  onChange,
}: {
  label: string;
  required?: boolean;
  options: SpecOption[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div style={{ marginTop: '14px' }}>
      <div
        style={{
          fontSize: '13.5px',
          fontWeight: 700,
          color: '#0f172a',
          marginBottom: '8px',
        }}
      >
        {label} {required && <span style={{ color: '#dc2626' }}>*</span>}
      </div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
          gap: '8px',
        }}
        role="radiogroup"
        aria-label={label}
      >
        {options.map((o) => {
          const isSelected = o.value === value;
          return (
            <button
              type="button"
              role="radio"
              key={o.value}
              aria-checked={isSelected}
              disabled={o.disabled}
              onClick={(e) => {
                e.stopPropagation();
                onChange(o.value);
              }}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                minHeight: '48px',
                padding: '8px 12px',
                borderRadius: '10px',
                border: isSelected
                  ? '2px solid #0abab5'
                  : '1.5px solid #cbd5e1',
                background: isSelected ? '#0abab5' : '#ffffff',
                color: isSelected ? '#ffffff' : '#0f172a',
                cursor: o.disabled ? 'not-allowed' : 'pointer',
                opacity: o.disabled ? 0.45 : 1,
                textDecoration: o.disabled ? 'line-through' : 'none',
                boxShadow: isSelected
                  ? '0 2px 4px rgba(10, 186, 181, 0.25)'
                  : 'none',
                transition: 'all 0.15s ease',
              }}
            >
              <span
                style={{
                  fontSize: '14px',
                  fontWeight: 700,
                  textAlign: 'center',
                }}
              >
                {o.label}
              </span>
              {o.sub && (
                <span
                  style={{
                    fontSize: '11px',
                    fontWeight: 500,
                    marginTop: '2px',
                    color: isSelected ? 'rgba(255, 255, 255, 0.9)' : '#64748b',
                  }}
                >
                  {o.sub}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
