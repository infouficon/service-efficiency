import { useCallback, useEffect, useState } from 'react';
import { Edit2, Plus } from 'lucide-react';
import { Button, Modal, Notice, Panel } from '../../components/ui';
import { useToast } from '../../components/Toast';
import {
  fetchCustomerTypesApi,
  saveCustomerTypeApi,
} from '../../services/sessionApi';
import type { CustomerType } from '../../types/session';

interface TypeDraft {
  id?: string;
  letter: string;
  name: string;
  description: string;
  active: boolean;
}

/**
 * Back-office list of customer types (D57). The letter is the queue letter ("คิว A012") and the sort order; the owner
 * creates as many types as needed (A, B, C, ...). A letter never changes once created: queue numbers already given
 * out carry it. Types are switched off, never deleted, so history keeps its meaning.
 */
export function CustomerTypesPanel() {
  const toast = useToast();
  const [types, setTypes] = useState<CustomerType[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [draft, setDraft] = useState<TypeDraft | null>(null);

  const load = useCallback(async () => {
    try {
      setTypes(await fetchCustomerTypesApi(true));
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'โหลดข้อมูลไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    fetchCustomerTypesApi(true)
      .then((list) => {
        if (active) setTypes(list);
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

  const save = async () => {
    if (!draft) return;
    setBusy(true);
    try {
      await saveCustomerTypeApi(
        {
          letter: draft.letter,
          name: draft.name,
          description: draft.description,
          active: draft.active,
        },
        draft.id,
      );
      setDraft(null);
      await load();
      toast.success('บันทึกประเภทลูกค้าเรียบร้อย');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'บันทึกไม่สำเร็จ';
      setError(message);
      toast.error(message);
    } finally {
      setBusy(false);
    }
  };

  const used = new Set(types.map((t) => t.letter));
  const nextLetter = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'].find(
    (l) => !used.has(l),
  );

  return (
    <>
      {error && <Notice error>{error}</Notice>}
      <Panel title="ประเภทลูกค้า (Customer Types)">
        <p className="muted" style={{ marginTop: 0 }}>
          ตัวอักษรของประเภทคือตัวอักษรหน้าเลขคิว (เช่น ประเภท B → คิว B001)
          เรียงจาก A-Z เลขคิวนับแยกตามสาขา ประเภท และวัน
          (เริ่มใหม่ทุกเที่ยงคืนเวลาไทย) ตัวอักษรเปลี่ยนไม่ได้หลังสร้าง
          และลบประเภทไม่ได้ ทำได้เพียงปิดใช้งาน
        </p>
        <div className="panel-actions-top">
          <Button
            disabled={!nextLetter}
            onClick={() =>
              setDraft({ letter: '', name: '', description: '', active: true })
            }
          >
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
              }}
            >
              <Plus size={16} />
              เพิ่มประเภท
            </span>
          </Button>
        </div>
        {loading ? (
          <Notice>กำลังโหลด…</Notice>
        ) : (
          <div className="table-responsive">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>ตัวอักษรคิว</th>
                  <th>ชื่อประเภท</th>
                  <th>คำอธิบาย</th>
                  <th>สถานะ</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {types.map((type) => (
                  <tr key={type.id}>
                    <td>
                      <strong
                        style={{
                          fontFamily: 'ui-monospace, monospace',
                          fontSize: '18px',
                        }}
                      >
                        {type.letter}
                      </strong>
                    </td>
                    <td>{type.name}</td>
                    <td>{type.description || '—'}</td>
                    <td>
                      <span
                        className={`status-tag ${type.active ? 'status-found' : 'status-outcome'}`}
                      >
                        {type.active ? 'ใช้งาน' : 'ปิดใช้งาน'}
                      </span>
                    </td>
                    <td>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() =>
                          setDraft({
                            id: type.id,
                            letter: type.letter,
                            name: type.name,
                            description: type.description ?? '',
                            active: type.active,
                          })
                        }
                      >
                        <span
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '4px',
                          }}
                        >
                          <Edit2 size={13} />
                          แก้ไข
                        </span>
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
      {draft && (
        <Modal
          title={
            draft.id ? `แก้ไขประเภทลูกค้า ${draft.letter}` : 'เพิ่มประเภทลูกค้า'
          }
          isOpen
          onClose={() => setDraft(null)}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            <label>
              ตัวอักษรคิว (A-Z)
              <input
                disabled={Boolean(draft.id)}
                maxLength={1}
                placeholder={
                  nextLetter ? `ว่างไว้ = ตัวถัดไป (${nextLetter})` : ''
                }
                value={draft.letter}
                onChange={(e) =>
                  setDraft({ ...draft, letter: e.target.value.toUpperCase() })
                }
              />
            </label>
            <label>
              ชื่อประเภท
              <input
                required
                maxLength={64}
                placeholder="เช่น ลูกค้าใช้เวลานาน"
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              />
            </label>
            <label>
              คำอธิบาย (ไม่บังคับ)
              <input
                maxLength={191}
                value={draft.description}
                onChange={(e) =>
                  setDraft({ ...draft, description: e.target.value })
                }
              />
            </label>
            {draft.id && (
              <label>
                <input
                  type="checkbox"
                  checked={draft.active}
                  onChange={(e) =>
                    setDraft({ ...draft, active: e.target.checked })
                  }
                />{' '}
                ใช้งานประเภทนี้
              </label>
            )}
            <div className="actions">
              <Button type="submit" disabled={busy || !draft.name.trim()}>
                บันทึก
              </Button>
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() => setDraft(null)}
              >
                ยกเลิก
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
