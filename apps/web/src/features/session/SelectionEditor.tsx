import { useEffect, useState } from 'react';
import {
  Smartphone,
  Tablet,
  Laptop,
  Watch,
  Box,
  ArrowRight,
} from 'lucide-react';
import {
  accessories,
  categories,
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
    default:
      return <Box size={16} />;
  }
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
    value.product?.category ?? categories[0],
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
                    flattened.push({
                      id: s.id,
                      category: p.category,
                      product: p.name,
                      model: s.name || m.name,
                      sku: s.sku,
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
  return (
    <>
      <p className="muted">
        เลือกประเภทสินค้าและรุ่นที่ลูกค้าต้องการ
      </p>
      <div className="category-tabs">
        {categories.map((item) => (
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
      <div className="product-grid">
        {currentProducts
          .filter((p) => p.category === category)
          .map((p) => (
            <label
              key={p.id}
              className={`product-card ${value.product?.id === p.id ? 'selected' : ''}`}
            >
              <input
                type="radio"
                name="product"
                checked={value.product?.id === p.id}
                onChange={() => onChange({ ...value, product: p })}
              />
              {/* <span className="device" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {getCategoryIcon(p.category)}
              </span> */}
              <strong>{p.product}</strong>
              <span>{p.model}</span>
              <small>{p.sku}</small>
            </label>
          ))}
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
