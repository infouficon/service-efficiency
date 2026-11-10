import { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  Check,
} from 'lucide-react';
import { CategoryIcon } from '../../components/CategoryIcon';
import { Button, Modal, Notice } from '../../components/ui';
import { deviceCategories } from '../../constants/options';
import {
  fetchCategoriesApi,
  fetchProductsApi,
} from '../../services/sessionApi';
import type { Category, MockSession } from '../../types/session';
import { Chips, SkuPicker } from './SkuPicker';
import {
  isOutOfStock,
  isUnlimited,
  modelChoices,
  toCatalog,
  type CatalogProduct,
  type Picked,
} from './catalog';

const CHANGE_REASONS = [
  'สินค้ามีปัญหา',
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

  // The replacement: a device line, then SkuPicker for model / RAM / capacity / colour
  const [category, setCategory] = useState<string>('');
  const [picked, setPicked] = useState<Picked | null>(null);
  const selectedSku = picked?.sku ?? null;

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

  const models = useMemo(() => modelChoices(catalog, category), [catalog, category]);

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
                      <CategoryIcon category={item.product.category} size={16} />
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

        {/* 2. Pick the replacement SKU */}
        <div>
          <label style={{ fontWeight: 600, display: 'block', marginBottom: '8px' }}>
            2. เลือกสินค้าชิ้นใหม่ที่ต้องการเปลี่ยน <span style={{ color: '#dc2626' }}>*</span>
          </label>

          {catalog === null && !loadError ? (
            <p className="muted">กำลังโหลดรายการสินค้า…</p>
          ) : (
            <div className="change-item-picker">
              <Chips
                label="ประเภทอุปกรณ์"
                required
                options={categoryTiles.map((cat) => ({
                  value: cat,
                  label: cat,
                  disabled: !(catalog ?? []).some((p) => p.category === cat),
                }))}
                value={category}
                onChange={(cat) => {
                  setCategory(cat);
                  setPicked(null);
                }}
              />
              {category && <SkuPicker key={category} models={models} onPick={setPicked} />}
            </div>
          )}

          {/* New SKU preview & warnings */}
          {selectedSku && picked && (
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
                <CategoryIcon category={picked.product.category} size={20} />
              </div>
              <div style={{ flex: 1 }}>
                <strong style={{ display: 'block', color: '#0f172a' }}>
                  {picked.model.name}{' '}
                  {[selectedSku.memory, selectedSku.storage, selectedSku.color].filter(Boolean).join(' · ')}
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
