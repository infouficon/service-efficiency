import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';
import { distinct } from './workflow';
import {
  getMacType,
  getSkuAttribute,
  isOutOfStock,
  isUnlimited,
  MAC_TYPES,
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
  options.length === 2 && options.every((opt) => opt.length <= 16);

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
}: {
  models: ModelChoice[];
  categorySpecs?: CategoryAttributeSpec[];
  categories?: Category[];
  onPick: (picked: Picked | null) => void;
  onComplete?: (picked: Picked) => void;
}) {
  const [modelKey, setModelKey] = useState('');
  const [selectedValues, setSelectedValues] = useState<Record<string, string>>({});
  const [skuId, setSkuId] = useState('');
  const [query, setQuery] = useState('');
  const [selectedMacType, setSelectedMacType] = useState<string>('');
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
      candidatesForStep: CatalogSku[];
    }[] = [];

    for (const spec of allSpecs) {
      const available = distinct(candidates.map((s) => getSkuAttribute(s, spec.key)));
      if (available.length > 0) {
        const val = selectedValues[spec.key] ?? '';
        computedSteps.push({
          spec,
          options: available,
          selectedValue: val,
          candidatesForStep: candidates,
        });
        if (val) {
          candidates = candidates.filter((s) => getSkuAttribute(s, spec.key) === val);
        }
      }
    }

    return { steps: computedSteps, remainingSkus: candidates };
  }, [modelSkus, allSpecs, selectedValues]);

  const isMac = useMemo(() => {
    return (
      (chosen?.product.category?.toLowerCase() === 'mac') ||
      models.some((m) => m.product.category?.toLowerCase() === 'mac')
    );
  }, [chosen, models]);

  const macFilteredModels = useMemo(() => {
    if (!isMac) return models;
    if (!selectedMacType) return [];
    return models.filter((m) => getMacType(m.model.name) === selectedMacType);
  }, [isMac, models, selectedMacType]);

  // Model search tokens
  const tokens = searchable(query).split(/\s+/).filter(Boolean);
  const shown = tokens.length === 0
    ? macFilteredModels
    : macFilteredModels.filter((m) => {
        const text = searchable(`${m.model.name} ${m.product.name}`);
        return tokens.every((t) => text.includes(t));
      });

  const pickModel = (choice: ModelChoice) => {
    setModelKey(choice.key);
    setQuery('');

    // Check if there are any applicable specs for this model
    const currentCategoryName = choice.product.category;
    let currentSpecs: CategoryAttributeSpec[] = [];
    if (categorySpecs && categorySpecs.length > 0) {
      currentSpecs = categorySpecs;
    } else {
      const fromCat = categories?.find(
        (c) => c.name.toLowerCase() === currentCategoryName.toLowerCase(),
      )?.attributes;
      currentSpecs = fromCat && fromCat.length > 0 ? fromCat : [];
    }
    if (choice.model.skus.some((s) => s.color) && !currentSpecs.some(isColorSpec)) {
      currentSpecs = [...currentSpecs, { key: 'color', label: 'สี', required: true }];
    }

    const hasAnySpecs = currentSpecs.some((spec) => {
      const available = distinct(choice.model.skus.map((s) => getSkuAttribute(s, spec.key)));
      return available.length > 0 && !(available.length === 1 && !available[0]);
    });

    // D147: Even if a spec step has only 1 choice (or model has 1 SKU with specs),
    // start unselected so staff must click every step manually.
    if (!hasAnySpecs && choice.model.skus.length === 1) {
      const single = choice.model.skus[0];
      setSkuId(single.id);
      setSelectedValues({});
      const pickedObj = { product: choice.product, model: choice.model, sku: single };
      onPick(pickedObj);
      if (!isOutOfStock(single)) {
        onComplete?.(pickedObj);
      }
    } else {
      setSelectedValues({});
      setSkuId('');
      onPick(null);
    }
  };

  const handleStepChange = (specKey: string, value: string) => {
    // Keep values of steps before specKey, and set specKey to value
    // Any step after specKey is cleared / reset so staff must choose them again
    const nextValues: Record<string, string> = {};
    for (const s of allSpecs) {
      if (s.key === specKey) {
        nextValues[s.key] = value;
        break;
      }
      if (selectedValues[s.key]) {
        nextValues[s.key] = selectedValues[s.key];
      }
    }

    setSelectedValues(nextValues);

    // Filter candidates based on nextValues and check if all applicable steps are filled
    let candidates = modelSkus;
    let allStepsFilled = true;

    for (const spec of allSpecs) {
      const available = distinct(candidates.map((s) => getSkuAttribute(s, spec.key)));
      const isApplicable = available.length > 0 && !(available.length === 1 && !available[0]);
      if (isApplicable) {
        const val = nextValues[spec.key];
        if (!val) {
          allStepsFilled = false;
          break;
        }
        candidates = candidates.filter((s) => getSkuAttribute(s, spec.key) === val);
      }
    }

    // Auto-complete only when all steps have been manually clicked down to 1 resolved SKU
    if (allStepsFilled && candidates.length === 1 && chosen) {
      const single = candidates[0];
      setSkuId(single.id);
      const pickedObj = { product: chosen.product, model: chosen.model, sku: single };
      onPick(pickedObj);
      if (!isOutOfStock(single)) {
        onComplete?.(pickedObj);
      }
    } else {
      setSkuId('');
      onPick(null);
    }
  };

  const singleResolvedSku = remainingSkus.length === 1 && skuId === remainingSkus[0].id ? remainingSkus[0] : null;

  return (
    <div className="sku-picker" ref={rootRef}>
      {/* 1. MODEL SELECTION VIEW (when no model selected yet) */}
      {!chosen ? (
        <div className="picker-field">
          {isMac && (
            <div style={{ marginBottom: '14px' }}>
              <span className="picker-label" style={{ marginBottom: '8px' }}>
                เลือกประเภท Mac <span className="required">*</span>
              </span>
              <div className="mac-type-chips" role="group" aria-label="ประเภท Mac">
                {MAC_TYPES.map((type) => {
                  const isSelected = selectedMacType === type;
                  return (
                    <button
                      key={type}
                      type="button"
                      className={`mac-type-chip${isSelected ? ' selected' : ''}`}
                      aria-pressed={isSelected}
                      onClick={() => {
                        setSelectedMacType(type);
                        setQuery('');
                      }}
                    >
                      <strong>{type}</strong>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <span className="picker-label" id={labelId}>
            เลือกรุ่นสินค้า <span className="required">*</span>
          </span>
          {models.length === 0 ? (
            <p className="muted">ไม่มีรุ่นสินค้าในหมวดนี้</p>
          ) : isMac && !selectedMacType ? (
            <p className="muted picker-hint">เลือกประเภท Mac ด้านบนก่อน</p>
          ) : (
            <>
              {macFilteredModels.length > 8 && (
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
                {shown.map((m) => (
                  <button type="button" key={m.key} className="model-option" onClick={() => pickModel(m)}>
                    <strong>{m.model.name}</strong>
                    {m.sub && <small>{m.sub}</small>}
                  </button>
                ))}
                {shown.length === 0 && <p className="muted">ไม่พบรุ่นที่ค้นหา</p>}
              </div>
            </>
          )}
        </div>
      ) : (
        /* 2. APPLE-STORE STYLE CONFIGURATOR CARD (D144) */
        <div className="spec-config-box">
          {/* Header: Model Name & Change Button */}
          <div className="spec-config-header">
            <div>
              <h3 className="spec-config-title">{chosen.model.name}</h3>
              {chosen.sub && <p className="muted" style={{ margin: 0, fontSize: '0.8rem' }}>{chosen.sub}</p>}
            </div>
            <button
              type="button"
              className="picked-model-change"
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

          {/* Dynamic Specification Steps */}
          {steps.map((st, idx) => {
            const prevStepsDone = steps.slice(0, idx).every((prev) => !!prev.selectedValue);
            if (!prevStepsDone) return null;

            const isColor = isColorSpec(st.spec);
            const cols2 = isTwoColumns(st.options);

            return (
              <div key={st.spec.key} className="spec-config-section">
                {/* Section Title: e.g. "ตัวเรือน - อะลูมิเนียม" or "สี - Jet Black" */}
                <div className="spec-config-section-label">
                  <span>{st.spec.label}</span>
                  {st.selectedValue && (
                    <span className="spec-config-selected-val"> - {st.selectedValue}</span>
                  )}
                </div>

                {/* Option Content: Circular Color Swatches or Option Cards */}
                {isColor ? (
                  <div className="spec-swatch-row">
                    {st.options.map((opt) => {
                      const matchingSkus = st.candidatesForStep.filter(
                        (s) => getSkuAttribute(s, st.spec.key) === opt,
                      );
                      const stockInfo = getOptionStockText(matchingSkus);
                      const hex = colorMap[opt] || colorMap[opt.toLowerCase()] || '#d1d5db';
                      const isSelected = st.selectedValue === opt;

                      const isImg =
                        typeof hex === 'string' &&
                        (/^https?:\/\/.+/i.test(hex) || /^data:image\/.+/i.test(hex));

                      return (
                        <button
                          type="button"
                          key={opt}
                          disabled={stockInfo.outOfStock}
                          className={`spec-swatch-btn ${isSelected ? 'selected' : ''}`}
                          onClick={() => handleStepChange(st.spec.key, opt)}
                          title={`${opt} · ${stockInfo.text}`}
                        >
                          {isSelected && <span className="spec-swatch-ring" />}
                          <span
                            className="spec-swatch-circle"
                            style={{
                              backgroundColor: isImg ? 'transparent' : hex,
                              backgroundImage: isImg ? `url("${hex}")` : undefined,
                              backgroundSize: 'cover',
                              backgroundPosition: 'center',
                              backgroundRepeat: 'no-repeat',
                              opacity: stockInfo.outOfStock ? 0.35 : 1,
                            }}
                          />
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <div className={`spec-card-grid ${cols2 ? 'cols-2' : 'cols-1'}`}>
                    {st.options.map((opt) => {
                      const matchingSkus = st.candidatesForStep.filter(
                        (s) => getSkuAttribute(s, st.spec.key) === opt,
                      );
                      const stockInfo = getOptionStockText(matchingSkus);
                      const isSelected = st.selectedValue === opt;

                      return (
                        <button
                          type="button"
                          key={opt}
                          disabled={stockInfo.outOfStock}
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
                    disabled={isOutOfStock(s)}
                    className={`spec-option-card ${s.id === skuId ? 'selected' : ''}`}
                    onClick={() => {
                      setSkuId(s.id);
                      const pickedObj = { product: chosen.product, model: chosen.model, sku: s };
                      onPick(pickedObj);
                      if (!isOutOfStock(s)) onComplete?.(pickedObj);
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
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '0.85rem', color: '#64748b' }}>รหัส SKU:</span>
                <code style={{ fontSize: '0.9rem', fontWeight: 600 }}>{singleResolvedSku.sku}</code>
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
