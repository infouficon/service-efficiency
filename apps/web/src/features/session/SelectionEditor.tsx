import { useEffect, useState } from 'react';
import {
  Smartphone,
  Tablet,
  Laptop,
  Watch,
  Box,
  ArrowRight,
  Headphones,
} from 'lucide-react';
import {
  accessories,
  deviceCategories,
  ontop,
  payments,
  points,
} from '../../constants/options';
import { products } from '../../mocks/data';
import type { Product, Selection } from '../../types/session';
import { MultiSelect, Button } from '../../components/ui';
import {
  quantitiesAreValid,
  quantityIsValid,
  stepAccessory,
  toggleAccessory,
} from './workflow';
import { fetchProductsApi } from '../../services/sessionApi';

function getCategoryIcon(cat: string) {
  switch (cat) {
    case 'iPhone':
      return <Smartphone size={16} />;
    case 'iPad':
      return <Tablet size={16} />;
    case 'Mac':
      return <Laptop size={16} />;
    case 'Watch':
      return <Watch size={16} />;
    case 'Accessories':
      return <Headphones size={16} />;
    default:
      return <Box size={16} />;
  }
}

/**
 * The line above the product grid about how fresh the stock figures are (F16): "unlimited" while the ADMIN switch is
 * on (D59), else the time of the oldest warroom snapshot behind the shown numbers (warroom refreshes about every 3 hours).
 */
function stockInfoLine(list: Product[]): string {
  if (list.some((p) => p.stockSource === 'unlimited'))
    return 'Stock: ไม่จำกัด (โหมดชั่วคราว) เลือกสินค้าได้ทุกรายการ';
  const times = list
    .filter((p) => p.stockSource === 'erp' && p.erpAsOf)
    .map((p) => new Date(p.erpAsOf as string).getTime())
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

export function SelectionEditor({
  value,
  onChange,
  onReview,
}: {
  value: Selection;
  onChange: (selection: Selection) => void;
  onReview: () => void;
}) {
  const [productCatalog, setProductCatalog] = useState<Product[]>([]);
  const [category, setCategory] = useState(
    value.product?.category ?? deviceCategories[0],
  );

  useEffect(() => {
    let active = true;
    fetchProductsApi()
      .then((data: unknown) => {
        if (active && Array.isArray(data) && data.length > 0) {
          const flattened: Product[] = [];
          for (const p of data as Array<{
            id: string;
            category: string;
            name: string;
            active: boolean;
            models?: Array<{
              id: string;
              name: string;
              active: boolean;
              skus?: Array<{
                id: string;
                sku: string;
                name: string;
                active: boolean;
                stock?: number;
                stockSource?: 'unlimited' | 'erp' | 'manual';
                erpAsOf?: string | null;
                branchActive?: boolean;
              }>;
            }>;
          }>) {
            if (!p.active) continue;
            if (Array.isArray(p.models)) {
              for (const m of p.models) {
                if (!m.active) continue;
                if (Array.isArray(m.skus)) {
                  for (const s of m.skus) {
                    if (!s.active) continue;
                    if (s.branchActive === false) continue;
                    flattened.push({
                      id: s.id,
                      category: p.category,
                      product: p.name,
                      model: s.name || m.name,
                      sku: s.sku,
                      stock: s.stock,
                      stockSource: s.stockSource,
                      erpAsOf: s.erpAsOf,
                      branchActive: s.branchActive,
                    });
                  }
                }
              }
            }
          }
          if (flattened.length > 0) {
            setProductCatalog(flattened);
          }
        }
      })
      .catch(() => {
        // Fallback to static mock products
      });

    return () => {
      active = false;
    };
  }, []);

  const currentProducts = productCatalog.length > 0 ? productCatalog : products;
  const inCategory = currentProducts.filter((p) => p.category === category);
  const stockInfo = stockInfoLine(inCategory);
  return (
    <>
      <p className="muted">
        เลือกประเภทสินค้าและรุ่นที่ลูกค้าต้องการ
      </p>
      <div className="category-tabs">
        {deviceCategories.map((item) => (
          <button
            type="button"
            className={item === category ? 'active' : ''}
            key={item}
            onClick={() => {
              setCategory(item);
              onChange({ ...value, product: null });
            }}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
          >
            {getCategoryIcon(item)}
            {item}
          </button>
        ))}
      </div>
      {stockInfo && <p className="fine stock-info-line">{stockInfo}</p>}
      <div className="product-grid">
        {inCategory
          .map((p) => {
            // D59: while the ADMIN switch "stock unlimited" is on, no stock figure blocks a product
            const unlimited = p.stockSource === 'unlimited';
            const isOutOfStock =
              !unlimited && typeof p.stock === 'number' && p.stock <= 0;
            return (
              <label
                key={p.id}
                className={`product-card ${value.product?.id === p.id ? 'selected' : ''} ${isOutOfStock ? 'out-of-stock' : ''}`}
                style={isOutOfStock ? { opacity: 0.6, cursor: 'not-allowed', borderColor: '#fca5a5' } : {}}
              >
                <input
                  type="radio"
                  name="product"
                  disabled={isOutOfStock}
                  checked={value.product?.id === p.id}
                  onChange={() => {
                    if (!isOutOfStock) {
                      onChange({ ...value, product: p });
                    }
                  }}
                />
                <strong>{p.product}</strong>
                <span>{p.model}</span>
                <small>{p.sku}</small>
                {(unlimited || typeof p.stock === 'number') && (
                  <span
                    style={{
                      marginTop: '6px',
                      display: 'inline-block',
                      fontSize: '11px',
                      fontWeight: 600,
                      padding: '2px 6px',
                      borderRadius: '4px',
                      backgroundColor: unlimited ? '#eff6ff' : isOutOfStock ? '#fee2e2' : '#ecfdf5',
                      color: unlimited ? '#1d4ed8' : isOutOfStock ? '#b91c1c' : '#047857',
                    }}
                  >
                    {unlimited
                      ? 'Stock ไม่จำกัด'
                      : isOutOfStock
                        ? 'สินค้าหมด (0 ชิ้น)'
                        : `คงเหลือ ${p.stock} ชิ้น`}
                  </span>
                )}
              </label>
            );
          })}
      </div>
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
                            accessories: stepAccessory(value.accessories, name, -1),
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
                            accessories: stepAccessory(value.accessories, name, 1),
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
        <Button
          disabled={!value.product || !quantitiesAreValid(value.accessories)}
          onClick={onReview}
        >
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
            ตรวจสอบรายการ
            <ArrowRight size={16} />
          </span>
        </Button>
      </div>

      {/* Mobile Sticky Action Bar */}
      <div className="mobile-sticky-bar">
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
          <strong style={{ fontSize: '13px', color: '#103836', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {value.product ? value.product.model : 'กรุณาเลือกรุ่นสินค้า'}
          </strong>
          <span className="fine" style={{ color: '#007d79', fontSize: '11px' }}>
            {Object.keys(value.accessories).length > 0
              ? `+ ${Object.keys(value.accessories).length} อุปกรณ์เสริม`
              : 'ไม่มีอุปกรณ์เสริม'}
          </span>
        </div>
        <Button
          disabled={!value.product || !quantitiesAreValid(value.accessories)}
          onClick={onReview}
          style={{ flexShrink: 0 }}
        >
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
            ถัดไป
            <ArrowRight size={15} />
          </span>
        </Button>
      </div>
    </>
  );
}
