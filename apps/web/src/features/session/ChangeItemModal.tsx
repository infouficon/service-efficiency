import { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  Box,
  Check,
  Headphones,
  Laptop,
  Smartphone,
  Tablet,
  Watch,
} from 'lucide-react';
import { Button, Modal, Notice } from '../../components/ui';
import { deviceCategories } from '../../constants/options';
import {
  fetchCategoriesApi,
  fetchProductsApi,
} from '../../services/sessionApi';
import type { Category, MockSession } from '../../types/session';

function getCategoryIcon(cat: string, size = 16) {
  switch (cat) {
    case 'iPhone':
      return <Smartphone size={size} />;
    case 'iPad':
      return <Tablet size={size} />;
    case 'Mac':
      return <Laptop size={size} />;
    case 'Watch':
      return <Watch size={size} />;
    case 'Accessories':
      return <Headphones size={size} />;
    default:
      return <Box size={size} />;
  }
}

interface CatalogSku {
  id: string;
  sku: string;
  name: string;
  color?: string | null;
  storage?: string | null;
  stock?: number;
  stockSource?: 'unlimited' | 'erp' | 'manual';
  erpAsOf?: string | null;
}

interface CatalogModel {
  id: string;
  name: string;
  skus: CatalogSku[];
}

interface CatalogProduct {
  id: string;
  category: string;
  name: string;
  models: CatalogModel[];
}

function toCatalog(data: unknown): CatalogProduct[] {
  if (!Array.isArray(data)) return [];
  const out: CatalogProduct[] = [];
  for (const p of data as Array<{
    id: string;
    category: string;
    name: string;
    active: boolean;
    models?: Array<{
      id: string;
      name: string;
      active: boolean;
      skus?: Array<CatalogSku & { active: boolean; branchActive?: boolean }>;
    }>;
  }>) {
    if (!p.active) continue;
    const models: CatalogModel[] = [];
    for (const m of p.models ?? []) {
      if (!m.active) continue;
      const skus = (m.skus ?? []).filter(
        (s) => s.active && s.branchActive !== false,
      );
      if (skus.length > 0) models.push({ id: m.id, name: m.name, skus });
    }
    if (models.length > 0)
      out.push({ id: p.id, category: p.category, name: p.name, models });
  }
  return out;
}

const isUnlimited = (s: { stockSource?: string }) =>
  s.stockSource === 'unlimited';
const isOutOfStock = (s: CatalogSku) =>
  !isUnlimited(s) && typeof s.stock === 'number' && s.stock <= 0;

const CHANGE_REASONS = [
  'ลูกค้าเปลี่ยนใจ (ความจุ/สี/รุ่น)',
  'แนะนำรุ่นอื่น/โปรโมชั่น',
  'สินค้าไม่ตรงตามต้องการ',
  'อื่น ๆ',
];

export function ChangeItemModal({
  session,
  isOpen = true,
  onClose,
  onSubmit,
}: {
  session: MockSession;
  isOpen?: boolean;
  onClose: () => void;
  onSubmit: (
    oldItemId: string,
    newSkuId: string,
    reason: string,
    note?: string,
  ) => Promise<void>;
}) {
  const [catalog, setCatalog] = useState<CatalogProduct[] | null>(null);
  const [categoryList, setCategoryList] = useState<Category[] | null>(null);
  const [loadError, setLoadError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');

  // Selected item to replace
  const mainItems = session.selection.items;
  const [selectedItemId, setSelectedItemId] = useState<string>(
    mainItems[0]?.product.id || '',
  );

  // Cascading dropdown states for replacement SKU
  const [category, setCategory] = useState<string>('');
  const [modelKey, setModelKey] = useState<string>('');
  const [storage, setStorage] = useState<string>('');
  const [skuId, setSkuId] = useState<string>('');

  // Reason & Note
  const [reason, setReason] = useState<string>(CHANGE_REASONS[0]);
  const [note, setNote] = useState<string>('');

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

  // Available models for selected category
  const availableModels = useMemo(() => {
    if (!catalog || !category) return [];
    const list: {
      key: string;
      product: CatalogProduct;
      model: CatalogModel;
      displayName: string;
    }[] = [];
    for (const p of catalog) {
      if (p.category !== category) continue;
      for (const m of p.models) {
        if (!m.skus || m.skus.length === 0) continue;
        const displayName =
          p.name === m.name || m.name.toLowerCase().includes(p.name.toLowerCase())
            ? m.name
            : `${p.name} - ${m.name}`;
        list.push({
          key: `${p.id}::${m.id}`,
          product: p,
          model: m,
          displayName,
        });
      }
    }
    return list;
  }, [catalog, category]);

  const selectedModelObj = useMemo(() => {
    return availableModels.find((m) => m.key === modelKey) ?? null;
  }, [availableModels, modelKey]);

  const availableStorages = useMemo(() => {
    if (!selectedModelObj) return [];
    const set = new Set<string>();
    for (const s of selectedModelObj.model.skus) {
      const st = s.storage?.trim();
      if (st) set.add(st);
    }
    return Array.from(set);
  }, [selectedModelObj]);

  const hasStorage = availableStorages.length > 0;

  const candidateSkus = useMemo(() => {
    if (!selectedModelObj) return [];
    if (hasStorage && !storage) return [];
    if (hasStorage) {
      return selectedModelObj.model.skus.filter(
        (s) => (s.storage?.trim() || '') === storage,
      );
    }
    return selectedModelObj.model.skus;
  }, [selectedModelObj, hasStorage, storage]);

  const selectedSku = useMemo(() => {
    if (!selectedModelObj || !skuId) return null;
    return selectedModelObj.model.skus.find((s) => s.id === skuId) ?? null;
  }, [selectedModelObj, skuId]);

  const handleCategoryChange = (cat: string) => {
    setCategory(cat);
    setModelKey('');
    setStorage('');
    setSkuId('');
  };

  const handleModelChange = (key: string) => {
    setModelKey(key);
    setStorage('');
    setSkuId('');
    if (!key) return;
    const target = availableModels.find((m) => m.key === key);
    if (!target) return;
    const storages = Array.from(
      new Set(
        target.model.skus
          .map((s) => s.storage?.trim())
          .filter((st): st is string => Boolean(st)),
      ),
    );
    if (storages.length === 0) {
      if (target.model.skus.length === 1) {
        setSkuId(target.model.skus[0].id);
      }
    } else if (storages.length === 1) {
      setStorage(storages[0]);
      const matchingSkus = target.model.skus.filter(
        (s) => (s.storage?.trim() || '') === storages[0],
      );
      if (matchingSkus.length === 1) {
        setSkuId(matchingSkus[0].id);
      }
    }
  };

  const handleStorageChange = (newStorage: string) => {
    setStorage(newStorage);
    setSkuId('');
    if (!selectedModelObj || !newStorage) return;
    const matchingSkus = selectedModelObj.model.skus.filter(
      (s) => (s.storage?.trim() || '') === newStorage,
    );
    if (matchingSkus.length === 1) {
      setSkuId(matchingSkus[0].id);
    }
  };

  // Find currently selected old item
  const selectedOldItem = mainItems.find(
    (it) => it.product.id === selectedItemId,
  );

  // Check if identical SKU
  const isIdenticalSku =
    selectedOldItem &&
    selectedSku &&
    (selectedOldItem.product.id === selectedSku.id ||
      selectedOldItem.product.sku === selectedSku.sku);

  const outOfStock = selectedSku ? isOutOfStock(selectedSku) : false;

  const canSubmit =
    Boolean(selectedItemId) &&
    Boolean(selectedSku) &&
    !isIdenticalSku &&
    !outOfStock &&
    Boolean(reason.trim()) &&
    !submitting;

  const handleSubmit = async () => {
    if (!canSubmit || !selectedSku) return;
    setSubmitError('');
    setSubmitting(true);
    try {
      await onSubmit(selectedItemId, selectedSku.id, reason, note);
      onClose();
    } catch (err) {
      setSubmitError(
        err instanceof Error ? err.message : 'เปลี่ยนสินค้าไม่สำเร็จ กรุณาลองใหม่',
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      title={
        <span>
          เปลี่ยนสินค้า (รุ่น/สี/ความจุ) — คิว <strong>{session.queue}</strong>
        </span>
      }
      isOpen={isOpen}
      onClose={onClose}
      maxWidth="680px"
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        {submitError && <Notice error>{submitError}</Notice>}
        {loadError && <Notice error>{loadError}</Notice>}

        {/* 1. Pick old item to replace */}
        <div>
          <label style={{ fontWeight: 600, display: 'block', marginBottom: '8px' }}>
            1. เลือกสินค้าเดิมในออเดอร์ที่ต้องการเปลี่ยน <span style={{ color: '#dc2626' }}>*</span>
          </label>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {mainItems.map((item) => {
              const isSelected = item.product.id === selectedItemId;
              const name = `${item.product.product || ''} ${item.product.model || ''}`.trim() || item.product.sku;
              return (
                <label
                  key={item.product.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '12px',
                    padding: '10px 14px',
                    borderRadius: '8px',
                    border: `1.5px solid ${isSelected ? '#2563eb' : '#e5e7eb'}`,
                    background: isSelected ? '#eff6ff' : '#ffffff',
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
                  }}
                >
                  <input
                    type="radio"
                    name="oldItemRadio"
                    checked={isSelected}
                    onChange={() => setSelectedItemId(item.product.id)}
                    style={{ cursor: 'pointer' }}
                  />
                  <span style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1 }}>
                    <span style={{ color: '#4b5563' }}>
                      {getCategoryIcon(item.product.category, 16)}
                    </span>
                    <span>
                      <strong style={{ display: 'block', color: '#111827' }}>
                        {name}
                      </strong>
                      <small style={{ color: '#6b7280' }}>
                        รหัส SKU: {item.product.sku} (จำนวน: {item.quantity} ชิ้น)
                      </small>
                    </span>
                  </span>
                </label>
              );
            })}
          </div>
        </div>

        {/* 2. Pick replacement SKU with Cascading Dropdowns */}
        <div>
          <label style={{ fontWeight: 600, display: 'block', marginBottom: '8px' }}>
            2. เลือกสินค้าชิ้นใหม่ที่ต้องการเปลี่ยน <span style={{ color: '#dc2626' }}>*</span>
          </label>

          {catalog === null && !loadError ? (
            <p className="muted">กำลังโหลดรายการสินค้า…</p>
          ) : (
            <div className="product-picker-dropdowns" style={{ margin: 0 }}>
              {/* Category */}
              <div className="picker-field">
                <label htmlFor="change-category-select">
                  ประเภทอุปกรณ์ <span className="required">*</span>
                </label>
                <select
                  id="change-category-select"
                  value={category}
                  onChange={(e) => handleCategoryChange(e.target.value)}
                >
                  <option value="">-- เลือกประเภทอุปกรณ์ --</option>
                  {categoryTiles.map((cat) => {
                    const count = (catalog ?? []).filter(
                      (p) => p.category === cat,
                    ).length;
                    return (
                      <option key={cat} value={cat} disabled={count === 0}>
                        {cat} {count === 0 ? '(ไม่มีสินค้า)' : ''}
                      </option>
                    );
                  })}
                </select>
              </div>

              {/* Model */}
              <div className="picker-field">
                <label htmlFor="change-model-select">
                  รุ่น <span className="required">*</span>
                </label>
                <select
                  id="change-model-select"
                  value={modelKey}
                  onChange={(e) => handleModelChange(e.target.value)}
                  disabled={!category || availableModels.length === 0}
                >
                  <option value="">
                    {!category
                      ? '-- กรุณาเลือกประเภทอุปกรณ์ก่อน --'
                      : availableModels.length === 0
                        ? '-- ไม่มีรุ่นสินค้าในหมวดนี้ --'
                        : '-- เลือกรุ่น --'}
                  </option>
                  {availableModels.map((m) => (
                    <option key={m.key} value={m.key}>
                      {m.displayName}
                    </option>
                  ))}
                </select>
              </div>

              {/* Storage */}
              {hasStorage && (
                <div className="picker-field">
                  <label htmlFor="change-storage-select">
                    ความจุ <span className="required">*</span>
                  </label>
                  <select
                    id="change-storage-select"
                    value={storage}
                    onChange={(e) => handleStorageChange(e.target.value)}
                    disabled={!modelKey}
                  >
                    <option value="">
                      {!modelKey ? '-- กรุณาเลือกรุ่นก่อน --' : '-- เลือกความจุ --'}
                    </option>
                    {availableStorages.map((st) => (
                      <option key={st} value={st}>
                        {st}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* Color */}
              <div className="picker-field">
                <label htmlFor="change-color-select">
                  สี{' '}
                  {candidateSkus.length > 0 && (
                    <span className="required">*</span>
                  )}
                </label>
                <select
                  id="change-color-select"
                  value={skuId}
                  onChange={(e) => setSkuId(e.target.value)}
                  disabled={!modelKey || (hasStorage && !storage)}
                >
                  <option value="">
                    {!modelKey
                      ? '-- กรุณาเลือกรุ่นก่อน --'
                      : hasStorage && !storage
                        ? '-- กรุณาเลือกความจุก่อน --'
                        : candidateSkus.length === 0
                          ? '-- ไม่มีตัวเลือกสี --'
                          : '-- เลือกสี --'}
                  </option>
                  {candidateSkus.map((s) => {
                    const out = isOutOfStock(s);
                    const label = s.color || s.name || s.sku;
                    const stockText = isUnlimited(s)
                      ? 'Stock ไม่จำกัด'
                      : typeof s.stock === 'number'
                        ? s.stock > 0
                          ? `คงเหลือ ${s.stock}`
                          : 'หมด'
                        : 'มีสต็อก';
                    return (
                      <option key={s.id} value={s.id} disabled={out}>
                        {label} ({stockText})
                      </option>
                    );
                  })}
                </select>
              </div>
            </div>
          )}

          {/* New SKU preview & warnings */}
          {selectedSku && selectedModelObj && (
            <div
              style={{
                marginTop: '12px',
                padding: '12px 14px',
                borderRadius: '8px',
                background: '#f8fafc',
                border: '1px solid #e2e8f0',
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
              }}
            >
              <div style={{ color: '#475569' }}>
                {getCategoryIcon(selectedModelObj.product.category, 20)}
              </div>
              <div style={{ flex: 1 }}>
                <strong style={{ display: 'block', color: '#0f172a' }}>
                  {selectedModelObj.model.name}{' '}
                  {[selectedSku.storage, selectedSku.color].filter(Boolean).join(' · ')}
                </strong>
                <small style={{ color: '#64748b' }}>
                  รหัส SKU: {selectedSku.sku} ·{' '}
                  {isUnlimited(selectedSku)
                    ? 'สต็อก: ไม่จำกัด'
                    : typeof selectedSku.stock === 'number'
                      ? `คงเหลือ: ${selectedSku.stock} ชิ้น`
                      : 'มีสต็อก'}
                </small>
              </div>
            </div>
          )}

          {isIdenticalSku && (
            <div style={{ marginTop: '8px', color: '#b91c1c', fontSize: '13px', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <AlertCircle size={15} />
              สินค้าชิ้นใหม่เป็นรายการเดิม กรุณาเลือกรุ่น สี หรือความจุอื่น
            </div>
          )}
          {outOfStock && (
            <div style={{ marginTop: '8px', color: '#b91c1c', fontSize: '13px', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <AlertCircle size={15} />
              สินค้ารายการนี้หมดในสต็อก ไม่สามารถเปลี่ยนเป็นรายการนี้ได้
            </div>
          )}
        </div>

        {/* 3. Reason & Note */}
        <div>
          <label style={{ fontWeight: 600, display: 'block', marginBottom: '8px' }}>
            3. เหตุผลในการเปลี่ยนสินค้า <span style={{ color: '#dc2626' }}>*</span>
          </label>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <select
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              style={{
                width: '100%',
                padding: '8px 12px',
                borderRadius: '6px',
                border: '1px solid #d1d5db',
                fontSize: '14px',
              }}
            >
              {CHANGE_REASONS.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
            <input
              type="text"
              placeholder="หมายเหตุเพิ่มเติม (ถ้ามี)"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              style={{
                width: '100%',
                padding: '8px 12px',
                borderRadius: '6px',
                border: '1px solid #d1d5db',
                fontSize: '14px',
                boxSizing: 'border-box',
              }}
            />
          </div>
        </div>

        {/* Info notice about flow */}
        <div
          style={{
            padding: '10px 14px',
            borderRadius: '8px',
            background: '#fffbeb',
            border: '1px solid #fef3c7',
            color: '#92400e',
            fontSize: '13px',
            display: 'flex',
            alignItems: 'flex-start',
            gap: '8px',
          }}
        >
          <AlertCircle size={16} style={{ flexShrink: 0, marginTop: '2px' }} />
          <div>
            <strong>ผลของการเปลี่ยนสินค้า:</strong>{' '}
            {session.state === 'STOCK_REQUESTED'
              ? 'รายการสินค้าในคิวนี้จะถูกอัปเดตและแจ้งเตือนฝ่าย Stock โดยคิวยังคงอยู่ในสถานะรอค้นหา (STOCK_REQUESTED) ตามเดิม'
              : 'คิวนี้จะถูกส่งกลับไปยังฝ่าย Stock (สถานะกำลังค้นหา) ทันที เพื่อนำเครื่องเดิมคืนคลัง และหยิบเครื่องใหม่มาส่งให้'}
          </div>
        </div>

        {/* Actions */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '10px' }}>
          <Button variant="secondary" onClick={onClose} disabled={submitting}>
            ยกเลิก
          </Button>
          <Button
            variant="primary"
            onClick={handleSubmit}
            disabled={!canSubmit}
          >
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
              <Check size={16} />
              {submitting ? 'กำลังบันทึก…' : 'ยืนยันเปลี่ยนสินค้าและส่งให้ Stock'}
            </span>
          </Button>
        </div>
      </div>
    </Modal>
  );
}
