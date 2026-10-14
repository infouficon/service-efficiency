import { useCallback, useEffect, useState } from 'react';
import { ArrowDown, ArrowUp, Plus } from 'lucide-react';
import { Button, Notice, Panel } from '../../components/ui';
import { useToast } from '../../components/Toast';
import {
  createCategoryApi,
  fetchCategoriesApi,
  moveCategoryApi,
  saveCategoryApi,
} from '../../services/sessionApi';
import type { Category } from '../../types/session';

/**
 * Back-office list of product categories (D68). The warroom sync adds the categories it finds (switched off), and new
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
    </>
  );
}
