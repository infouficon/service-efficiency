import { useId, useMemo, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';
import { distinct } from './workflow';
import {
  getSkuAttribute,
  isOutOfStock,
  isUnlimited,
  type CatalogSku,
  type ModelChoice,
  type Picked,
} from './catalog';
import type { Category, CategoryAttributeSpec } from '../../types/session';

function stockText(s: CatalogSku): string {
  if (isUnlimited(s)) return 'มีจำหน่าย';
  if (isOutOfStock(s)) return 'หมด';
  if (typeof s.stock === 'number') return `เหลือ ${s.stock}`;
  return 'พร้อมขาย';
}

function colourLabel(s: CatalogSku): string {
  if (s.color && s.name) {
    if (s.name.toLowerCase().includes(s.color.toLowerCase())) return s.color;
    return `${s.name} (${s.color})`;
  }
  return s.color || s.name || 'มาตรฐาน';
}

/** "wi-fi", "WiFi" and "wifi" are the same to someone typing on a phone. */
const searchable = (text: string) => text.toLowerCase().replaceAll('-', '');

/**
 * Pick one SKU of a category (D78, D79, D142):
 * Models as a list of buttons, then step-by-step specification chips defined by the Category template
 * (e.g. for iPad: Connectivity [Wi-Fi / Cellular] -> Storage -> Color; for Mac: RAM -> Storage -> Color;
 * for Watch: Case Size -> Connectivity -> Color).
 * A step with a single choice is automatically taken for the user.
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
  const rootRef = useRef<HTMLDivElement>(null);
  const stepRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const colourRef = useRef<HTMLDivElement>(null);
  const labelId = useId();

  const chosen = models.find((m) => m.key === modelKey) ?? null;
  const modelSkus = useMemo(() => chosen?.model.skus ?? [], [chosen]);

  // Resolve category specifications template (D142)
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
    // Dynamic fallback when no template: check if memory or storage exist in SKUs
    const fallback: CategoryAttributeSpec[] = [];
    if (modelSkus.some((s) => s.memory)) {
      fallback.push({ key: 'memory', label: 'RAM', required: true });
    }
    if (modelSkus.some((s) => s.storage)) {
      fallback.push({ key: 'storage', label: 'ความจุ', required: true });
    }
    fallback.push({ key: 'color', label: 'สี', required: true });
    return fallback;
  }, [chosen, categorySpecs, categories, categoryName, modelSkus]);

  // Non-color filter steps
  const filterSpecs = useMemo(
    () => resolvedSpecs.filter((s) => s.key !== 'color'),
    [resolvedSpecs],
  );

  // Compute available choices and candidate SKUs for each step
  const { steps, finalSkus } = useMemo(() => {
    let candidates = modelSkus;
    const computedSteps: {
      spec: CategoryAttributeSpec;
      options: string[];
      selectedValue: string;
    }[] = [];

    for (const spec of filterSpecs) {
      const available = distinct(candidates.map((s) => getSkuAttribute(s, spec.key)));
      if (available.length > 0) {
        const val = selectedValues[spec.key] ?? '';
        computedSteps.push({
          spec,
          options: available,
          selectedValue: val,
        });
        if (val) {
          candidates = candidates.filter((s) => getSkuAttribute(s, spec.key) === val);
        }
      }
    }

    return { steps: computedSteps, finalSkus: candidates };
  }, [modelSkus, filterSpecs, selectedValues]);

  // Colour SKUs display labels
  const colourLabels = useMemo(() => {
    const labels = finalSkus.map(colourLabel);
    return finalSkus.map((s, i) =>
      labels.filter((l) => l === labels[i]).length > 1 ? `${labels[i]} · ${s.sku}` : labels[i],
    );
  }, [finalSkus]);

  // Model search tokens
  const tokens = searchable(query).split(/\s+/).filter(Boolean);
  const shown = tokens.length === 0
    ? models
    : models.filter((m) => {
        const text = searchable(`${m.model.name} ${m.product.name}`);
        return tokens.every((t) => text.includes(t));
      });

  /** Helper to cascade auto-select single options */
  const resolveAutoChoices = (
    skus: CatalogSku[],
    currentSpecs: CategoryAttributeSpec[],
    initialValues: Record<string, string>,
  ): { nextValues: Record<string, string>; remainingSkus: CatalogSku[] } => {
    const nextValues = { ...initialValues };
    let candidates = skus;
    for (const spec of currentSpecs) {
      const available = distinct(candidates.map((s) => getSkuAttribute(s, spec.key)));
      if (available.length === 1 && !nextValues[spec.key]) {
        nextValues[spec.key] = available[0];
      }
      const val = nextValues[spec.key];
      if (val) {
        candidates = candidates.filter((s) => getSkuAttribute(s, spec.key) === val);
      }
    }
    return { nextValues, remainingSkus: candidates };
  };

  const pickModel = (choice: ModelChoice) => {
    setModelKey(choice.key);
    setQuery('');

    // Pre-calculate auto choices
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
    const curFilterSpecs = currentSpecs.filter((s) => s.key !== 'color');
    const { nextValues, remainingSkus } = resolveAutoChoices(choice.model.skus, curFilterSpecs, {});
    setSelectedValues(nextValues);

    if (remainingSkus.length === 1) {
      const single = remainingSkus[0];
      setSkuId(single.id);
      const pickedObj = { product: choice.product, model: choice.model, sku: single };
      onPick(pickedObj);
      if (!isOutOfStock(single)) {
        onComplete?.(pickedObj);
      }
    } else {
      setSkuId('');
      onPick(null);
    }

    setTimeout(() => {
      colourRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 50);
  };

  const handleStepChange = (specKey: string, value: string) => {
    const initial: Record<string, string> = {};
    for (const s of filterSpecs) {
      if (s.key === specKey) {
        initial[s.key] = value;
        break;
      }
      if (selectedValues[s.key]) {
        initial[s.key] = selectedValues[s.key];
      }
    }

    const { nextValues, remainingSkus } = resolveAutoChoices(modelSkus, filterSpecs, initial);
    setSelectedValues(nextValues);

    if (remainingSkus.length === 1 && chosen) {
      const single = remainingSkus[0];
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

    setTimeout(() => {
      colourRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 50);
  };

  const pickColour = (id: string) => {
    const sku = modelSkus.find((s) => s.id === id);
    if (!chosen || !sku || isOutOfStock(sku)) return;
    setSkuId(id);
    const pickedObj = { product: chosen.product, model: chosen.model, sku };
    onPick(pickedObj);
    onComplete?.(pickedObj);
  };

  // Determine whether all non-color steps have been satisfied
  const allPriorStepsSatisfied = steps.every((st) => !!st.selectedValue);

  return (
    <div className="sku-picker" ref={rootRef}>
      <div className="picker-field">
        <span className="picker-label" id={labelId}>
          รุ่น <span className="required">*</span>
        </span>
        {chosen ? (
          <div className="picked-model">
            <span>
              <strong>{chosen.model.name}</strong>
              {chosen.sub && <small>{chosen.sub}</small>}
            </span>
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
              เปลี่ยน
            </button>
          </div>
        ) : models.length === 0 ? (
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

      {/* Dynamic Specification Steps (D142) */}
      {chosen &&
        steps.map((st, idx) => {
          // Render this step only if previous steps have been selected
          const prevStepsDone = steps.slice(0, idx).every((prev) => !!prev.selectedValue);
          if (!prevStepsDone) return null;

          return (
            <div
              key={st.spec.key}
              ref={(el) => {
                stepRefs.current[st.spec.key] = el;
              }}
            >
              <Chips
                label={st.spec.label}
                required={st.spec.required}
                options={st.options.map((opt) => ({ value: opt, label: opt }))}
                value={st.selectedValue}
                onChange={(val) => handleStepChange(st.spec.key, val)}
              />
            </div>
          );
        })}

      {/* Final Step: Colour / SKU selection with stock availability */}
      {chosen && allPriorStepsSatisfied && finalSkus.length > 0 && (
        <div ref={colourRef}>
          <Chips
            label="สี"
            required
            options={finalSkus.map((s, i) => ({
              value: s.id,
              label: colourLabels[i],
              sub: stockText(s),
              disabled: isOutOfStock(s),
            }))}
            value={skuId}
            onChange={pickColour}
          />
        </div>
      )}
    </div>
  );
}

/** One choice out of a few, as buttons big enough for a thumb (a native dropdown is tiny on a phone). */
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
