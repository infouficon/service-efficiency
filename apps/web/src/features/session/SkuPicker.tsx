import { useId, useMemo, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';
import { distinct, settleChoice } from './workflow';
import { isOutOfStock, isUnlimited, type CatalogSku, type ModelChoice, type Picked } from './catalog';

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
 * Pick one SKU of a category (D78, D79): the models as a list of buttons (with a search box when there are many), then
 * RAM, capacity and colour as chips. A step with a single choice is taken for the user. Tells the parent the SKU once one
 * is chosen, and `null` when the choice is undone. Remount it (`key`) to start over.
 */
export function SkuPicker({
  models,
  onPick,
}: {
  models: ModelChoice[];
  onPick: (picked: Picked | null) => void;
}) {
  const [modelKey, setModelKey] = useState('');
  const [memory, setMemory] = useState('');
  const [storage, setStorage] = useState('');
  const [skuId, setSkuId] = useState('');
  const [query, setQuery] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);
  const labelId = useId();

  const chosen = models.find((m) => m.key === modelKey) ?? null;
  const modelSkus = useMemo(() => chosen?.model.skus ?? [], [chosen]);
  const memories = useMemo(() => distinct(modelSkus.map((s) => s.memory)), [modelSkus]);
  const memorySkus = memories.length > 0
    ? modelSkus.filter((s) => (s.memory?.trim() || '') === memory)
    : modelSkus;
  const storages = distinct(memorySkus.map((s) => s.storage));
  const colourSkus =
    (memories.length > 0 && !memory) || (storages.length > 0 && !storage)
      ? []
      : storages.length > 0
        ? memorySkus.filter((s) => (s.storage?.trim() || '') === storage)
        : memorySkus;
  // two colours of one model can have the same label (a keyboard layout only in the part): the part number tells them apart
  const labels = colourSkus.map(colourLabel);
  const colourLabels = colourSkus.map((s, i) =>
    labels.filter((l) => l === labels[i]).length > 1 ? `${labels[i]} · ${s.sku}` : labels[i],
  );

  const tokens = searchable(query).split(/\s+/).filter(Boolean);
  const shown = tokens.length === 0
    ? models
    : models.filter((m) => {
        const text = searchable(`${m.model.name} ${m.product.name}`);
        return tokens.every((t) => text.includes(t));
      });

  /** Keep the state and tell the parent which SKU (if any) it now stands for. */
  const settle = (choice: ModelChoice | null, mem: string, st: string) => {
    const next = choice ? settleChoice(choice.model.skus, mem, st) : { memory: '', storage: '', skuId: '' };
    setMemory(next.memory);
    setStorage(next.storage);
    setSkuId(next.skuId);
    const sku = choice?.model.skus.find((s) => s.id === next.skuId);
    // a single SKU taken for the user can be out of stock: the parent says so and does not let it be added
    onPick(choice && sku ? { product: choice.product, model: choice.model, sku } : null);
  };

  const pickModel = (choice: ModelChoice) => {
    setModelKey(choice.key);
    setQuery('');
    settle(choice, '', '');
    // the list folds into one row: bring the next choices into view on a phone
    requestAnimationFrame(() => rootRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }));
  };

  const pickColour = (id: string) => {
    const sku = modelSkus.find((s) => s.id === id);
    if (!chosen || !sku || isOutOfStock(sku)) return;
    setSkuId(id);
    onPick({ product: chosen.product, model: chosen.model, sku });
  };

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
                settle(null, '', '');
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

      {chosen && memories.length > 0 && (
        <Chips
          label="RAM"
          required
          options={memories.map((m) => ({ value: m, label: m }))}
          value={memory}
          onChange={(m) => settle(chosen, m, '')}
        />
      )}
      {chosen && storages.length > 0 && (
        <Chips
          label="ความจุ"
          required
          options={storages.map((st) => ({ value: st, label: st }))}
          value={storage}
          onChange={(st) => settle(chosen, memory, st)}
        />
      )}
      {chosen && colourSkus.length > 0 && (
        <Chips
          label="สี"
          required
          options={colourSkus.map((s, i) => ({
            value: s.id,
            label: colourLabels[i],
            sub: stockText(s),
            disabled: isOutOfStock(s),
          }))}
          value={skuId}
          onChange={pickColour}
        />
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
