import { useCallback, useEffect, useState } from 'react';
import { ArrowDown, ArrowUp, GripVertical, Plus } from 'lucide-react';
import { Button, Notice, Panel } from '../../components/ui';
import { useToast } from '../../components/Toast';
import {
  createPaymentMethodApi,
  fetchPaymentMethodsApi,
  movePaymentMethodApi,
  reorderPaymentMethodsApi,
  setPaymentMethodActiveApi,
} from '../../services/sessionApi';
import type { PaymentMethod } from '../../types/session';

/**
 * Back-office list of payment methods (F6). New ones are added here, with no deploy. A name is what sessions store, so a
 * method is switched off, never renamed or deleted; the order here is the order staff see.
 */
export function PaymentMethodsPanel() {
  const toast = useToast();
  const [methods, setMethods] = useState<PaymentMethod[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [name, setName] = useState('');
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [canDrag, setCanDrag] = useState(false);

  const load = useCallback(async () => {
    try {
      setMethods(await fetchPaymentMethodsApi(true));
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'โหลดข้อมูลไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    fetchPaymentMethodsApi(true)
      .then((list) => {
        if (active) setMethods(list);
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
      if (done) toast.success(done);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'บันทึกไม่สำเร็จ';
      setError(message);
      toast.error(message);
    } finally {
      setBusy(false);
    }
  };

  const handleReorder = async (sourceIndex: number, targetIndex: number) => {
    if (sourceIndex === targetIndex || busy) return;
    const previous = [...methods];
    const updated = [...methods];
    const [moved] = updated.splice(sourceIndex, 1);
    updated.splice(targetIndex, 0, moved);
    setMethods(updated);
    setBusy(true);
    try {
      const result = await reorderPaymentMethodsApi(updated.map((m) => m.id));
      setMethods(result);
      toast.success('บันทึกลำดับช่องทางชำระเงินเรียบร้อย');
      setError('');
    } catch (err) {
      setMethods(previous);
      const message =
        err instanceof Error ? err.message : 'บันทึกลำดับไม่สำเร็จ';
      setError(message);
      toast.error(message);
    } finally {
      setBusy(false);
      setDraggedIndex(null);
      setDragOverIndex(null);
      setCanDrag(false);
    }
  };

  return (
    <>
      {error && <Notice error>{error}</Notice>}
      <Panel title="ช่องทางชำระเงิน (Payment Methods)">
        <p className="muted" style={{ marginTop: 0 }}>
          เพิ่มช่องทางใหม่ได้ที่นี่ทันที (ไม่ต้อง deploy)
          ชื่อใช้บันทึกในรายการขาย จึงแก้ชื่อหรือลบไม่ได้ ทำได้เพียงปิดใช้งาน
          สามารถคลิกค้างที่ไอคอน ⠿ เพื่อลากจัดลำดับ หรือใช้ปุ่มลูกศร
          ลำดับในตารางคือลำดับที่พนักงานเห็น
        </p>
        <form
          className="payment-add-form"
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              await createPaymentMethodApi(name.trim());
              setName('');
            }, 'เพิ่มช่องทางชำระเงินเรียบร้อย');
          }}
        >
          <input
            required
            maxLength={64}
            placeholder="ชื่อช่องทางใหม่ เช่น LINE Pay"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <Button type="submit" disabled={busy || !name.trim()}>
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
              }}
            >
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
                  <th style={{ width: '40px', textAlign: 'center' }}></th>
                  <th style={{ width: '70px' }}>ลำดับ</th>
                  <th>ชื่อช่องทาง</th>
                  <th>สถานะ</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {methods.map((method, index) => {
                  const isDragging = draggedIndex === index;
                  const isOver =
                    dragOverIndex === index && draggedIndex !== index;
                  return (
                    <tr
                      key={method.id}
                      draggable={canDrag && !busy}
                      onDragStart={(e) => {
                        e.dataTransfer.setData('text/plain', String(index));
                        e.dataTransfer.effectAllowed = 'move';
                        setDraggedIndex(index);
                      }}
                      onDragOver={(e) => {
                        e.preventDefault();
                        e.dataTransfer.dropEffect = 'move';
                        if (dragOverIndex !== index) {
                          setDragOverIndex(index);
                        }
                      }}
                      onDragLeave={() => {
                        if (dragOverIndex === index) {
                          setDragOverIndex(null);
                        }
                      }}
                      onDragEnd={() => {
                        setDraggedIndex(null);
                        setDragOverIndex(null);
                        setCanDrag(false);
                      }}
                      onDrop={(e) => {
                        e.preventDefault();
                        if (draggedIndex !== null && draggedIndex !== index) {
                          void handleReorder(draggedIndex, index);
                        } else {
                          setDraggedIndex(null);
                          setDragOverIndex(null);
                          setCanDrag(false);
                        }
                      }}
                      style={{
                        opacity: isDragging ? 0.35 : 1,
                        backgroundColor: isOver ? '#f0fdfa' : undefined,
                        boxShadow: isOver
                          ? draggedIndex !== null && draggedIndex < index
                            ? 'inset 0 -2px 0 0 #0abab5'
                            : 'inset 0 2px 0 0 #0abab5'
                          : undefined,
                        transition:
                          'background-color 0.15s ease, opacity 0.15s ease',
                      }}
                    >
                      <td
                        style={{
                          textAlign: 'center',
                          cursor: busy ? 'default' : 'grab',
                          color: '#94a3b8',
                          userSelect: 'none',
                        }}
                        onMouseEnter={() => setCanDrag(true)}
                        onMouseLeave={() => {
                          if (draggedIndex === null) setCanDrag(false);
                        }}
                        onMouseDown={() => setCanDrag(true)}
                        title="คลิกค้างแล้วลากเพื่อจัดอันดับ"
                      >
                        <GripVertical size={16} />
                      </td>
                      <td>{index + 1}</td>
                      <td>
                        <strong>{method.name}</strong>
                      </td>
                      <td>
                        <span
                          className={`status-tag ${method.active ? 'status-found' : 'status-outcome'}`}
                        >
                          {method.active ? 'ใช้งาน' : 'ปิดใช้งาน'}
                        </span>
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: '6px' }}>
                          <Button
                            variant="secondary"
                            size="sm"
                            disabled={busy || index === 0}
                            aria-label={`เลื่อน ${method.name} ขึ้น`}
                            onClick={() =>
                              void run(() =>
                                movePaymentMethodApi(method.id, 'up'),
                              )
                            }
                          >
                            <ArrowUp size={14} />
                          </Button>
                          <Button
                            variant="secondary"
                            size="sm"
                            disabled={busy || index === methods.length - 1}
                            aria-label={`เลื่อน ${method.name} ลง`}
                            onClick={() =>
                              void run(() =>
                                movePaymentMethodApi(method.id, 'down'),
                              )
                            }
                          >
                            <ArrowDown size={14} />
                          </Button>
                          <Button
                            variant="secondary"
                            size="sm"
                            disabled={busy}
                            onClick={() =>
                              void run(
                                () =>
                                  setPaymentMethodActiveApi(
                                    method.id,
                                    !method.active,
                                  ),
                                method.active
                                  ? 'ปิดใช้งานแล้ว'
                                  : 'เปิดใช้งานแล้ว',
                              )
                            }
                          >
                            {method.active ? 'ปิดใช้งาน' : 'เปิดใช้งาน'}
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </>
  );
}
