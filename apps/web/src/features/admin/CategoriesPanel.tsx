import { useCallback, useEffect, useState } from 'react';
import { ArrowDown, ArrowUp, Plus, SlidersHorizontal, Trash2 } from 'lucide-react';
import { Button, Modal, Notice, Panel } from '../../components/ui';
import { useToast } from '../../components/Toast';
import {
  createCategoryApi,
  fetchCategoriesApi,
  moveCategoryApi,
  saveCategoryApi,
} from '../../services/sessionApi';
import type { Category, CategoryAttributeSpec } from '../../types/session';

/**
 * Back-office list of product categories (D72). The warroom sync adds the categories it finds (switched off), and new
 * ones can be added here without a deploy. Products store the name, so a category is switched on or off, never renamed
 * or deleted. Staff only see products of an active category; accessory-like categories are not offered as a main
 * product (accessories have their own step).
 */
export function CategoriesPanel() {
  const toast = useToast();
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [name, setName] = useState('');
  const [isAccessory, setIsAccessory] = useState(false);

  // Specs Modal state (D142)
  const [specsModalCategory, setSpecsModalCategory] = useState<Category | null>(null);
  const [specsList, setSpecsList] = useState<CategoryAttributeSpec[]>([]);
  const [newSpecKey, setNewSpecKey] = useState('');
  const [newSpecLabel, setNewSpecLabel] = useState('');
  const [newSpecRequired, setNewSpecRequired] = useState(false);

  const openSpecsModal = (cat: Category) => {
    setSpecsModalCategory(cat);
    const existing = cat.attributes && cat.attributes.length > 0 ? cat.attributes : [];
    setSpecsList([...existing]);
    setNewSpecKey('');
    setNewSpecLabel('');
    setNewSpecRequired(false);
  };

  const handleAddSpec = () => {
    const k = newSpecKey.trim().toLowerCase().replace(/\s+/g, '_');
    const l = newSpecLabel.trim();
    if (!k || !l) {
      toast.error('กรุณาระบุรหัสสเปก (Key) และชื่อแสดงผล (Label)');
      return;
    }
    if (specsList.some((s) => s.key === k)) {
      toast.error(`มีรหัสสเปก "${k}" อยู่แล้ว`);
      return;
    }
    setSpecsList([
      ...specsList,
      {
        key: k,
        label: l,
        required: newSpecRequired,
      },
    ]);
    setNewSpecKey('');
    setNewSpecLabel('');
    setNewSpecRequired(false);
  };

  const handleRemoveSpec = (index: number) => {
    setSpecsList(specsList.filter((_, i) => i !== index));
  };

  const handleMoveSpec = (index: number, dir: 'up' | 'down') => {
    const next = [...specsList];
    const target = dir === 'up' ? index - 1 : index + 1;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    setSpecsList(next);
  };

  const handleSaveSpecs = async () => {
    if (!specsModalCategory) return;
    await run(async () => {
      await saveCategoryApi(specsModalCategory.id, { attributes: specsList });
      setSpecsModalCategory(null);
    }, `บันทึกคุณลักษณะของหมวด ${specsModalCategory.name} เรียบร้อย`);
  };

  const load = useCallback(async () => {
    try {
      setCategories(await fetchCategoriesApi(true));
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'โหลดข้อมูลไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    fetchCategoriesApi(true)
      .then((list) => {
        if (active) setCategories(list);
      })
      .catch((err: unknown) => {
        if (active)
          setError(err instanceof Error ? err.message : 'โหลดข้อมูลไม่สำเร็จ');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const run = async (work: () => Promise<unknown>, done?: string) => {
    setBusy(true);
    try {
      await work();
      await load();
      if (done) toast.success(done, 6000);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'บันทึกไม่สำเร็จ';
      setError(message);
      toast.error(message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {error && <Notice error>{error}</Notice>}
      <Panel title="หมวดหมู่สินค้า (Categories)">
        <p className="muted" style={{ marginTop: 0 }}>
          หมวดที่ซิงก์จาก warroom เข้ามาใหม่จะ<strong>ปิดไว้ก่อน</strong>
          พนักงานจึงไม่เห็น เปิดหมวดที่ต้องการแล้วไปกด “ซิงก์ตอนนี้” ที่เมนู ซิงก์
          ERP สินค้าของหมวดนั้นจะถูกสร้างให้ (หมวด Apple เปิดอยู่แล้ว)
          เพิ่มหมวดเองได้ที่นี่โดยไม่ต้อง deploy ชื่อหมวดใช้อ้างอิงสินค้า
          จึงแก้ชื่อหรือลบไม่ได้ ทำได้เพียงเปิด/ปิด
        </p>
        <form
          className="payment-add-form"
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              await createCategoryApi(name.trim(), isAccessory);
              setName('');
              setIsAccessory(false);
            }, 'เพิ่มหมวดหมู่เรียบร้อย');
          }}
        >
          <input
            required
            maxLength={100}
            placeholder="ชื่อหมวดใหม่ เช่น HUAWEI Phone"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', whiteSpace: 'nowrap' }}>
            <input
              type="checkbox"
              checked={isAccessory}
              onChange={(e) => setIsAccessory(e.target.checked)}
            />
            อุปกรณ์เสริม
          </label>
          <Button type="submit" disabled={busy || !name.trim()}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
              <Plus size={16} />
              เพิ่ม
            </span>
          </Button>
        </form>
        {loading ? (
          <Notice>กำลังโหลด…</Notice>
        ) : (
          <div className="table-responsive">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>ลำดับ</th>
                  <th>ชื่อหมวด</th>
                  <th>ประเภท</th>
                  <th>จำนวนสินค้า</th>
                  <th>ที่มา</th>
                  <th>สถานะ</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {categories.map((category, index) => (
                  <tr key={category.id}>
                    <td>{index + 1}</td>
                    <td>
                      <strong>{category.name}</strong>
                    </td>
                    <td>{category.isAccessory ? 'อุปกรณ์เสริม' : 'สินค้าหลัก'}</td>
                    <td>{(category.productCount ?? 0).toLocaleString('th-TH')}</td>
                    <td>{category.erpManaged ? 'warroom' : 'ระบบ / เพิ่มเอง'}</td>
                    <td>
                      <span
                        className={`status-tag ${category.active ? 'status-found' : 'status-outcome'}`}
                      >
                        {category.active ? 'เปิด' : 'ปิด'}
                      </span>
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                        <Button
                          variant="secondary"
                          size="sm"
                          disabled={busy || index === 0}
                          aria-label={`เลื่อน ${category.name} ขึ้น`}
                          onClick={() => void run(() => moveCategoryApi(category.id, 'up'))}
                        >
                          <ArrowUp size={14} />
                        </Button>
                        <Button
                          variant="secondary"
                          size="sm"
                          disabled={busy || index === categories.length - 1}
                          aria-label={`เลื่อน ${category.name} ลง`}
                          onClick={() => void run(() => moveCategoryApi(category.id, 'down'))}
                        >
                          <ArrowDown size={14} />
                        </Button>
                        <Button
                          variant="secondary"
                          size="sm"
                          disabled={busy}
                          onClick={() =>
                            void run(
                              () => saveCategoryApi(category.id, { active: !category.active }),
                              category.active
                                ? 'ปิดหมวดแล้ว พนักงานจะไม่เห็นสินค้าของหมวดนี้'
                                : category.erpManaged && (category.productCount ?? 0) === 0
                                  ? 'เปิดหมวดแล้ว ไปกด “ซิงก์ตอนนี้” ที่เมนู ซิงก์ ERP เพื่อนำสินค้าของหมวดนี้เข้า'
                                  : 'เปิดหมวดแล้ว',
                            )
                          }
                        >
                          {category.active ? 'ปิด' : 'เปิด'}
                        </Button>
                        <Button
                          variant="secondary"
                          size="sm"
                          disabled={busy}
                          title="ตั้งค่าคุณลักษณะสินค้า (Specs Template)"
                          onClick={() => openSpecsModal(category)}
                        >
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                            <SlidersHorizontal size={14} />
                            สเปก
                          </span>
                        </Button>
                        <Button
                          variant="secondary"
                          size="sm"
                          disabled={busy}
                          title="อุปกรณ์เสริมจะไม่แสดงเป็นสินค้าหลักในหน้าเลือกสินค้า"
                          onClick={() =>
                            void run(() =>
                              saveCategoryApi(category.id, { isAccessory: !category.isAccessory }),
                            )
                          }
                        >
                          {category.isAccessory ? 'ทำเป็นสินค้าหลัก' : 'ทำเป็นอุปกรณ์เสริม'}
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {/* SPECS TEMPLATE MODAL (D142) */}
      {specsModalCategory && (
        <Modal
          title={`ตั้งค่าคุณลักษณะสินค้า: ${specsModalCategory.name}`}
          isOpen={!!specsModalCategory}
          onClose={() => setSpecsModalCategory(null)}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <p className="muted" style={{ margin: 0, fontSize: '0.9rem' }}>
              กำหนดขั้นตอนและคุณลักษณะของสินค้าในหมวด <strong>{specsModalCategory.name}</strong>
            </p>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <strong>รายการคุณลักษณะ ({specsList.length})</strong>
            </div>

            {specsList.length === 0 ? (
              <p className="muted" style={{ fontStyle: 'italic' }}>
                หมวดนี้ยังไม่มีการกำหนดคุณลักษณะ (ใช้เพียงชื่อสินค้าทั่วไป)
              </p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {specsList.map((spec, idx) => (
                  <div
                    key={spec.key}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '8px 12px',
                      background: 'var(--bg-subtle, #f8f9fa)',
                      borderRadius: '6px',
                      border: '1px solid var(--border-color, #e5e7eb)',
                    }}
                  >
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span style={{ fontWeight: 600 }}>{idx + 1}. {spec.label}</span>
                        <code style={{ fontSize: '0.8rem', color: '#6b7280' }}>({spec.key})</code>
                        {spec.required && (
                          <span className="status-tag status-outcome" style={{ fontSize: '0.75rem', padding: '2px 6px' }}>
                            จำเป็น
                          </span>
                        )}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: '4px' }}>
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled={idx === 0}
                        onClick={() => handleMoveSpec(idx, 'up')}
                        aria-label="เลื่อนขึ้น"
                      >
                        <ArrowUp size={14} />
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled={idx === specsList.length - 1}
                        onClick={() => handleMoveSpec(idx, 'down')}
                        aria-label="เลื่อนลง"
                      >
                        <ArrowDown size={14} />
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => handleRemoveSpec(idx)}
                        aria-label="ลบ"
                      >
                        <Trash2 size={14} color="#ef4444" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* FORM TO ADD SPEC */}
            <div
              style={{
                marginTop: '0.5rem',
                padding: '12px',
                border: '1px dashed var(--border-color, #d1d5db)',
                borderRadius: '6px',
                display: 'flex',
                flexDirection: 'column',
                gap: '8px',
              }}
            >
              <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>+ เพิ่มคุณลักษณะใหม่</span>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                <input
                  placeholder="รหัส เช่น connectivity"
                  value={newSpecKey}
                  onChange={(e) => setNewSpecKey(e.target.value)}
                />
                <input
                  placeholder="ชื่อ เช่น การเชื่อมต่อ"
                  value={newSpecLabel}
                  onChange={(e) => setNewSpecLabel(e.target.value)}
                />
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '0.85rem' }}>
                  <input
                    type="checkbox"
                    checked={newSpecRequired}
                    onChange={(e) => setNewSpecRequired(e.target.checked)}
                  />
                  ต้องเลือก/ระบุเสมอ (Required)
                </label>
                <Button variant="secondary" size="sm" onClick={handleAddSpec}>
                  <Plus size={14} /> เพิ่มคุณลักษณะ
                </Button>
              </div>
            </div>

            <div className="actions" style={{ marginTop: '1rem', display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
              <Button onClick={() => void handleSaveSpecs()} disabled={busy}>
                {busy ? 'กำลังบันทึก…' : 'บันทึกคุณลักษณะ'}
              </Button>
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() => setSpecsModalCategory(null)}
              >
                ยกเลิก
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
