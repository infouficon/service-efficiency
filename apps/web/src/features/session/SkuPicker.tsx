import { useId, useMemo, useRef, useState } from 'react';
import { Check, Search, X } from 'lucide-react';
import { distinct, settleChoice } from './workflow';
import {
  formatPrice,
  isOutOfStock,
  isUnlimited,
  type CatalogSku,
  type ModelChoice,
  type Picked,
} from './catalog';

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
 * Pick one SKU of a category (D78, D79, D145): models displayed as rounded cards with in-place expansion,
 * and 2-column grid sub-options for RAM, capacity, and colour.
 */
export function SkuPicker({
  models,
  onPick,
  onComplete,
  allowOutOfStock = false,
}: {
  models: ModelChoice[];
  onPick: (picked: Picked | null) => void;
  onComplete?: (picked: Picked) => void;
  allowOutOfStock?: boolean;
}) {
  const [modelKey, setModelKey] = useState('');
  const [memory, setMemory] = useState('');
  const [storage, setStorage] = useState('');
  const [skuId, setSkuId] = useState('');
  const [query, setQuery] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);
  const memoryRef = useRef<HTMLDivElement>(null);
  const storageRef = useRef<HTMLDivElement>(null);
  const colourRef = useRef<HTMLDivElement>(null);
  const labelId = useId();

  const chosen = models.find((m) => m.key === modelKey) ?? null;
  const modelSkus = useMemo(() => chosen?.model.skus ?? [], [chosen]);
  const pickedSku = useMemo(
    () => modelSkus.find((s) => s.id === skuId),
    [modelSkus, skuId],
  );

  const memories = useMemo(
    () => distinct(modelSkus.map((s) => s.memory)),
    [modelSkus],
  );
  const memorySkus =
    memories.length > 0
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
    labels.filter((l) => l === labels[i]).length > 1
      ? `${labels[i]} · ${s.sku}`
      : labels[i],
  );

  const tokens = searchable(query).split(/\s+/).filter(Boolean);
  const shown =
    tokens.length === 0
      ? models
      : models.filter((m) => {
          const text = searchable(`${m.model.name} ${m.product.name}`);
          return tokens.every((t) => text.includes(t));
        });

  /** Keep the state and tell the parent which SKU (if any) it now stands for. */
  const settle = (
    choice: ModelChoice | null,
    mem: string,
    st: string,
    triggerComplete = false,
  ) => {
    // D133: Always require explicit colour selection; do not auto-pick skuId
    const next = choice
      ? settleChoice(choice.model.skus, mem, st, false)
      : { memory: '', storage: '', skuId: '' };
    setMemory(next.memory);
    setStorage(next.storage);
    setSkuId(next.skuId);
    const sku = choice?.model.skus.find((s) => s.id === next.skuId);
    const pickedObj =
      choice && sku
        ? { product: choice.product, model: choice.model, sku }
        : null;
    onPick(pickedObj);
    if (
      triggerComplete &&
      pickedObj &&
      (allowOutOfStock || !isOutOfStock(pickedObj.sku)) &&
      next.skuId
    ) {
      onComplete?.(pickedObj);
    }
  };

  const pickModel = (choice: ModelChoice) => {
    setModelKey(choice.key);
    setQuery('');
    settle(choice, '', '', false);
  };

  const handleMemoryChange = (mem: string) => {
    settle(chosen, mem, '');
  };

  const handleStorageChange = (st: string) => {
    settle(chosen, memory, st, false);
  };

  const pickColour = (id: string) => {
    const sku = modelSkus.find((s) => s.id === id);
    if (!chosen || !sku || (!allowOutOfStock && isOutOfStock(sku))) return;
    setSkuId(id);
    const pickedObj = { product: chosen.product, model: chosen.model, sku };
    onPick(pickedObj);
    onComplete?.(pickedObj);
  };

  return (
    <div className="sku-picker" ref={rootRef}>
      <div className="picker-field">
        <span className="picker-label" id={labelId}>
          เลือกรุ่นสินค้า <span className="required">*</span>
        </span>

        {models.length === 0 ? (
          <p className="muted">ไม่มีรุ่นสินค้าในหมวดนี้</p>
        ) : (
          <>
            {models.length > 6 && (
              <label className="model-search" style={{ marginBottom: '12px' }}>
                <Search size={16} aria-hidden="true" />
                <input
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="ค้นหารุ่น เช่น 13 m4, pro"
                  aria-label="ค้นหารุ่น"
                  enterKeyHint="search"
                />
                {query && (
                  <button
                    type="button"
                    aria-label="ล้างคำค้น"
                    onClick={() => setQuery('')}
                  >
                    <X size={14} />
                  </button>
                )}
              </label>
            )}

            <div
              style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}
              role="group"
              aria-labelledby={labelId}
            >
              {shown.map((m) => {
                const isSelected = m.key === modelKey;
                const formattedPriceVal =
                  isSelected && pickedSku?.price != null
                    ? formatPrice(pickedSku.price)
                    : m.minPrice != null
                      ? `เริ่มต้น ${formatPrice(m.minPrice)}`
                      : null;
                const priceText = formattedPriceVal || m.sub || '';

                return (
                  <div
                    key={m.key}
                    onClick={() => {
                      if (!isSelected) {
                        pickModel(m);
                      }
                    }}
                    style={{
                      borderRadius: '14px',
                      border: isSelected
                        ? '2px solid #0abab5'
                        : '1.5px solid #e2e8f0',
                      background: isSelected ? '#f8fafc' : '#ffffff',
                      padding: '16px',
                      cursor: isSelected ? 'default' : 'pointer',
                      boxShadow: isSelected
                        ? '0 4px 14px rgba(10, 186, 181, 0.12)'
                        : '0 1px 3px rgba(0, 0, 0, 0.04)',
                      transition: 'all 0.15s ease',
                    }}
                  >
                    {/* Top Row: Model Name & Price & Checkmark */}
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: '12px',
                      }}
                    >
                      <div>
                        <div
                          style={{
                            fontSize: '16px',
                            fontWeight: 700,
                            color: '#0f172a',
                            lineHeight: 1.3,
                          }}
                        >
                          {m.model.name}
                        </div>
                        {priceText && (
                          <div
                            style={{
                              fontSize:
                                isSelected && pickedSku?.price != null
                                  ? '15px'
                                  : '13.5px',
                              color:
                                isSelected && pickedSku?.price != null
                                  ? '#0f766e'
                                  : '#64748b',
                              fontWeight:
                                isSelected && pickedSku?.price != null
                                  ? 700
                                  : 500,
                              marginTop: '3px',
                            }}
                          >
                            {priceText}
                          </div>
                        )}
                      </div>

                      {/* Checkmark Button to collapse/deselect when selected */}
                      {isSelected && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setModelKey('');
                            settle(null, '', '', false);
                          }}
                          style={{
                            width: '28px',
                            height: '28px',
                            minWidth: '28px',
                            maxWidth: '28px',
                            minHeight: '28px',
                            maxHeight: '28px',
                            borderRadius: '50%',
                            backgroundColor: '#0abab5',
                            border: 'none',
                            padding: 0,
                            margin: 0,
                            display: 'inline-flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            color: '#ffffff',
                            flexShrink: 0,
                            cursor: 'pointer',
                            boxSizing: 'border-box',
                            lineHeight: 1,
                            boxShadow: '0 1px 4px rgba(10, 186, 181, 0.4)',
                            transition: 'all 0.15s ease',
                          }}
                          title="แตะเพื่อยกเลิกการเลือก"
                          aria-label="แตะเพื่อยกเลิกการเลือก"
                        >
                          <Check size={18} strokeWidth={2.8} />
                        </button>
                      )}
                    </div>

                    {/* In-place Expanded Sub-options */}
                    {isSelected && (
                      <div
                        style={{
                          borderTop: '1px solid #e2e8f0',
                          marginTop: '14px',
                          paddingTop: '2px',
                        }}
                      >
                        {/* RAM */}
                        {memories.length > 0 && (
                          <div ref={memoryRef}>
                            <SpecGrid
                              label="RAM"
                              required
                              options={memories.map((mem) => ({
                                value: mem,
                                label: mem,
                              }))}
                              value={memory}
                              onChange={handleMemoryChange}
                            />
                          </div>
                        )}

                        {/* ความจุ */}
                        {storages.length > 0 && (
                          <div ref={storageRef}>
                            <SpecGrid
                              label="ความจุ"
                              required
                              options={storages.map((st) => ({
                                value: st,
                                label: st,
                              }))}
                              value={storage}
                              onChange={handleStorageChange}
                            />
                          </div>
                        )}

                        {/* สี */}
                        {colourSkus.length > 0 && (
                          <div ref={colourRef}>
                            <SpecGrid
                              label="สี"
                              required
                              options={colourSkus.map((s, i) => ({
                                value: s.id,
                                label: colourLabels[i],
                                sub: stockText(s),
                                disabled: !allowOutOfStock && isOutOfStock(s),
                              }))}
                              value={skuId}
                              onChange={pickColour}
                            />
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}

              {shown.length === 0 && <p className="muted">ไม่พบรุ่นที่ค้นหา</p>}
            </div>
          </>
        )}
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

/** Legacy Chips component preserved for compatibility */
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
