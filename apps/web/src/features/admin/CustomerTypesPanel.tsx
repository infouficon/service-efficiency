import { useCallback, useEffect, useState } from 'react';
import { Edit2, Plus } from 'lucide-react';
import { Button, Modal, Notice, Panel } from '../../components/ui';
import { useToast } from '../../components/Toast';
import {
  fetchCustomerTypesApi,
  fetchPaymentMethodsApi,
  saveCustomerTypeApi,
} from '../../services/sessionApi';
import { ontop as ontopOptions, points as pointsOptions } from '../../constants/options';
import type { CustomerType, PaymentMethod } from '../../types/session';

interface TypeDraft {
  id?: string;
  letter: string;
  name: string;
  description: string;
  active: boolean;
  paymentMethods: string[];
  ontop: string[];
  points: string[];
  burnPoints: string[];
}

/**
 * Back-office list of customer types (D57, D69, D70). The letter is the queue letter ("A012") and the sort order; the owner
 * creates as many types as needed (A, B, C, ...). A letter never changes once created: queue numbers already given
 * out carry it. Types are switched off, never deleted, so history keeps its meaning.
 * Criteria (Payment, Ontop, Points, Burn Point) mapped to a type (D70) auto-classify a session into that type upon confirmation.
 */
export function CustomerTypesPanel() {
  const toast = useToast();
  const [types, setTypes] = useState<CustomerType[]>([]);
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [draft, setDraft] = useState<TypeDraft | null>(null);

  const load = useCallback(async () => {
    try {
      const [tList, pmList] = await Promise.all([
        fetchCustomerTypesApi(true),
        fetchPaymentMethodsApi(true),
      ]);
      setTypes(tList);
      setPaymentMethods(pmList.filter((p) => p.active));
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'โหลดข้อมูลไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    Promise.all([
      fetchCustomerTypesApi(true),
      fetchPaymentMethodsApi(true),
    ])
      .then(([tList, pmList]) => {
        if (active) {
          setTypes(tList);
          setPaymentMethods(pmList.filter((p) => p.active));
        }
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
          paymentMethods: draft.paymentMethods,
          ontop: draft.ontop,
          points: draft.points,
          burnPoints: draft.burnPoints,
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
      <Panel title="ประเภทลูกค้าและคิว (Customer Types)">
        <p className="muted" style={{ marginTop: 0 }}>
          ตัวอักษรของประเภทคือตัวอักษรหน้าเลขคิวเพื่อแบ่งประเภทลูกค้า (เช่น A001, B002, A003)
          เรียงจาก A-Z โดยตัวเลขคิวนับต่อเนื่องกันภายในสาขาและวันเดียวกัน
          (เริ่มใหม่ทุกเที่ยงคืนเวลาไทย) ตัวอักษรเปลี่ยนไม่ได้หลังสร้าง
          และลบประเภทไม่ได้ ทำได้เพียงปิดใช้งาน
        </p>
        <div className="panel-actions-top">
          <Button
            disabled={!nextLetter}
            onClick={() =>
              setDraft({
                letter: '',
                name: '',
                description: '',
                active: true,
                paymentMethods: [],
                ontop: [],
                points: [],
                burnPoints: [],
              })
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
                  <th>เงื่อนไขการจัดเข้าประเภทนี้ (Criteria)</th>
                  <th>สถานะ</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {types.map((type) => {
                  const pm = Array.isArray(type.paymentMethods) ? type.paymentMethods : [];
                  const ot = Array.isArray(type.ontop) ? type.ontop : [];
                  const pt = Array.isArray(type.points) ? type.points : [];
                  const bp = Array.isArray(type.burnPoints) ? type.burnPoints : [];
                  const hasAnyCriteria = pm.length > 0 || ot.length > 0 || pt.length > 0 || bp.length > 0;

                  return (
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
                        {hasAnyCriteria ? (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                            {pm.length > 0 && (
                              <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '4px' }}>
                                <span style={{ fontSize: '11px', color: '#64748b', fontWeight: 600 }}>ชำระเงิน:</span>
                                {pm.map((m) => (
                                  <span key={m} className="status-tag" style={{ background: '#f1f5f9', color: '#334155', padding: '1px 6px', fontSize: '11px' }}>
                                    {m}
                                  </span>
                                ))}
                              </div>
                            )}
                            {ot.length > 0 && (
                              <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '4px' }}>
                                <span style={{ fontSize: '11px', color: '#64748b', fontWeight: 600 }}>Ontop:</span>
                                {ot.map((o) => (
                                  <span key={o} className="status-tag" style={{ background: '#ecfdf5', color: '#047857', padding: '1px 6px', fontSize: '11px' }}>
                                    {o}
                                  </span>
                                ))}
                              </div>
                            )}
                            {pt.length > 0 && (
                              <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '4px' }}>
                                <span style={{ fontSize: '11px', color: '#64748b', fontWeight: 600 }}>Points:</span>
                                {pt.map((p) => (
                                  <span key={p} className="status-tag" style={{ background: '#eff6ff', color: '#1d4ed8', padding: '1px 6px', fontSize: '11px' }}>
                                    {p}
                                  </span>
                                ))}
                              </div>
                            )}
                            {bp.length > 0 && (
                              <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '4px' }}>
                                <span style={{ fontSize: '11px', color: '#64748b', fontWeight: 600 }}>Burn Point:</span>
                                {bp.map((b) => (
                                  <span key={b} className="status-tag" style={{ background: '#fef2f2', color: '#b91c1c', padding: '1px 6px', fontSize: '11px' }}>
                                    {b}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
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
                              paymentMethods: Array.isArray(type.paymentMethods)
                                ? (type.paymentMethods as string[])
                                : [],
                              ontop: Array.isArray(type.ontop)
                                ? (type.ontop as string[])
                                : [],
                              points: Array.isArray(type.points)
                                ? (type.points as string[])
                                : [],
                              burnPoints: Array.isArray(type.burnPoints)
                                ? (type.burnPoints as string[])
                                : [],
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
                  );
                })}
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

            {/* Criteria sections */}
            <div style={{ marginTop: '16px', marginBottom: '16px' }}>
              <div style={{ fontWeight: 600, fontSize: '14px', marginBottom: '4px' }}>
                เงื่อนไขการจัดเข้าประเภทนี้ (Auto-classify เมื่อตรวจสอบยืนยัน)
              </div>
              <p className="muted" style={{ fontSize: '13px', marginTop: 0, marginBottom: '12px' }}>
                หากออเดอร์มีรายการใดรายการหนึ่งตรงกับเงื่อนไขด้านล่างนี้ ระบบจะออกเลขคิวเป็นประเภทนี้ให้อัตโนมัติ (เช่น คิว B)
              </p>

              {/* 1. Payment Methods */}
              <div style={{ marginBottom: '12px' }}>
                <span style={{ fontSize: '13px', fontWeight: 600, color: '#334155', display: 'block', marginBottom: '6px' }}>
                  1. ช่องทางการชำระเงิน (Payment Methods)
                </span>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))',
                    gap: '6px',
                    maxHeight: '140px',
                    overflowY: 'auto',
                    padding: '8px',
                    border: '1px solid #e2e8f0',
                    borderRadius: '6px',
                    background: '#f8fafc',
                  }}
                >
                  {paymentMethods.map((pm) => {
                    const checked = draft.paymentMethods.includes(pm.name);
                    return (
                      <label
                        key={pm.id}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '6px',
                          fontSize: '13px',
                          cursor: 'pointer',
                          margin: 0,
                          userSelect: 'none',
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) => {
                            const isChecked = e.target.checked;
                            setDraft({
                              ...draft,
                              paymentMethods: isChecked
                                ? [...draft.paymentMethods, pm.name]
                                : draft.paymentMethods.filter((m) => m !== pm.name),
                            });
                          }}
                        />
                        {pm.name}
                      </label>
                    );
                  })}
                </div>
              </div>

              {/* 2. Ontop */}
              <div style={{ marginBottom: '12px' }}>
                <span style={{ fontSize: '13px', fontWeight: 600, color: '#334155', display: 'block', marginBottom: '6px' }}>
                  2. Ontop
                </span>
                <div
                  style={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: '12px',
                    padding: '8px',
                    border: '1px solid #e2e8f0',
                    borderRadius: '6px',
                    background: '#f8fafc',
                  }}
                >
                  {ontopOptions.map((item) => {
                    const checked = draft.ontop.includes(item);
                    return (
                      <label
                        key={item}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '6px',
                          fontSize: '13px',
                          cursor: 'pointer',
                          margin: 0,
                          userSelect: 'none',
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) => {
                            const isChecked = e.target.checked;
                            setDraft({
                              ...draft,
                              ontop: isChecked
                                ? [...draft.ontop, item]
                                : draft.ontop.filter((m) => m !== item),
                            });
                          }}
                        />
                        {item}
                      </label>
                    );
                  })}
                </div>
              </div>

              {/* 3. Points */}
              <div style={{ marginBottom: '12px' }}>
                <span style={{ fontSize: '13px', fontWeight: 600, color: '#334155', display: 'block', marginBottom: '6px' }}>
                  3. สะสมแต้ม (Points)
                </span>
                <div
                  style={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: '12px',
                    padding: '8px',
                    border: '1px solid #e2e8f0',
                    borderRadius: '6px',
                    background: '#f8fafc',
                  }}
                >
                  {pointsOptions.map((item) => {
                    const checked = draft.points.includes(item);
                    return (
                      <label
                        key={item}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '6px',
                          fontSize: '13px',
                          cursor: 'pointer',
                          margin: 0,
                          userSelect: 'none',
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) => {
                            const isChecked = e.target.checked;
                            setDraft({
                              ...draft,
                              points: isChecked
                                ? [...draft.points, item]
                                : draft.points.filter((m) => m !== item),
                            });
                          }}
                        />
                        {item}
                      </label>
                    );
                  })}
                </div>
              </div>

              {/* 4. Burn Points */}
              <div style={{ marginBottom: '12px' }}>
                <span style={{ fontSize: '13px', fontWeight: 600, color: '#334155', display: 'block', marginBottom: '6px' }}>
                  4. ตัดแต้ม (Burn Point)
                </span>
                <div
                  style={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: '12px',
                    padding: '8px',
                    border: '1px solid #e2e8f0',
                    borderRadius: '6px',
                    background: '#f8fafc',
                  }}
                >
                  {pointsOptions.map((item) => {
                    const checked = draft.burnPoints.includes(item);
                    return (
                      <label
                        key={item}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '6px',
                          fontSize: '13px',
                          cursor: 'pointer',
                          margin: 0,
                          userSelect: 'none',
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) => {
                            const isChecked = e.target.checked;
                            setDraft({
                              ...draft,
                              burnPoints: isChecked
                                ? [...draft.burnPoints, item]
                                : draft.burnPoints.filter((m) => m !== item),
                            });
                          }}
                        />
                        {item}
                      </label>
                    );
                  })}
                </div>
              </div>
            </div>

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
