import { useState } from 'react';
import {
  User as UserIcon,
  Plus,
  ClipboardList,
  Check,
  X,
  Package,
  CreditCard,
  ArrowLeft,
  ArrowRight,
} from 'lucide-react';
import { Button, Notice, Panel } from '../../components/ui';
import { cancelReasons, notBuyReasons, stages } from '../../constants/options';
import type { MockSession, MockUser, Selection } from '../../types/session';
import { SelectionEditor } from './SelectionEditor';
import { Summary } from './Summary';
import { ReasonForm } from './ReasonForm';
import {
  advance,
  confirmSelection,
  phoneIsValid,
  progressIndex,
  type StepAction,
} from './workflow';
import {
  advanceStepApi,
  cancelSessionApi,
  confirmPurchaseApi,
  createWalkInApi,
  recordNotBuyApi,
  updateSelectionApi,
} from '../../services/sessionApi';

const previewTime = () => new Date().toISOString();

interface StaffWorkspaceProps {
  user: MockUser;
  sessions: MockSession[];
  onAddSession: (session: MockSession) => void;
  onUpdateSession: (session: MockSession) => void;
}

type FormView = 'normal' | 'notBuy' | 'review' | 'cancel';

function isTodaySession(s: MockSession): boolean {
  const getLocalDateStr = (d: Date) => {
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  };

  const todayStr = getLocalDateStr(new Date());

  if (s.timestamps.customer_walk_in_at) {
    const d = new Date(s.timestamps.customer_walk_in_at);
    if (!Number.isNaN(d.getTime())) {
      return getLocalDateStr(d) === todayStr;
    }
  }

  if (s.events && s.events.length > 0 && s.events[0].createdAt) {
    const d = new Date(s.events[0].createdAt);
    if (!Number.isNaN(d.getTime())) {
      return getLocalDateStr(d) === todayStr;
    }
  }

  const match = s.reference.match(/^SES-(\d{4})(\d{2})(\d{2})-/);
  if (match) {
    const refDateStr = `${match[1]}-${match[2]}-${match[3]}`;
    return refDateStr === todayStr;
  }

  return false;
}

export function StaffWorkspace({
  user,
  sessions,
  onAddSession,
  onUpdateSession,
}: StaffWorkspaceProps) {
  const [activeSessionRef, setActiveSessionRef] = useState<string | null>(null);
  const [phoneDrafts, setPhoneDrafts] = useState<Record<string, string>>({});
  const [phoneAttempted, setPhoneAttempted] = useState<Record<string, boolean>>({});
  const [form, setForm] = useState<FormView>('normal');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // Filter staff's branch sessions for today
  const branchSessions = sessions.filter((s) => {
    const matchesBranch =
      user.roles.includes('ADMIN') || s.branchCode === (user.branchCode ?? '');
    return matchesBranch && isTodaySession(s);
  });

  const activeSession =
    branchSessions.find((s) => s.reference === activeSessionRef) || null;

  const currentPhone = activeSession
    ? (phoneDrafts[activeSession.reference] ?? activeSession.phone ?? '')
    : '';

  const finished = Boolean(
    activeSession?.outcome || activeSession?.state === 'COMPLETED',
  );

  const startNewWalkIn = async () => {
    setBusy(true);
    setError('');
    try {
      const newS = await createWalkInApi(user.branchCode);
      onAddSession(newS);
      setActiveSessionRef(newS.reference);
      setForm('normal');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'สร้าง Session ไม่สำเร็จ');
    } finally {
      setBusy(false);
    }
  };

  const handleStep = async (action: StepAction) => {
    if (!activeSession) return;
    setBusy(true);
    setError('');
    try {
      if (action === 'startSelection' && activeSession.id) {
        const phoneToSave = phoneDrafts[activeSession.reference] ?? activeSession.phone ?? '';
        await updateSelectionApi(activeSession.id, activeSession.selection, phoneToSave);
      }
      if (activeSession.id) {
        const updated = await advanceStepApi(activeSession.id, action);
        onUpdateSession(updated);
      } else {
        const updated = advance(activeSession, action, new Date().toISOString());
        onUpdateSession(updated);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'ดำเนินการไม่สำเร็จ');
    } finally {
      setBusy(false);
    }
  };

  const handleStartSelection = () => {
    if (!activeSession) return;
    if (!phoneIsValid(currentPhone)) {
      setPhoneAttempted((prev) => ({ ...prev, [activeSession.reference]: true }));
      return;
    }
    handleStep('startSelection');
  };

  const handleConfirm = async () => {
    if (!activeSession) return;
    setBusy(true);
    setError('');
    try {
      if (activeSession.id) {
        const updated = await confirmPurchaseApi(activeSession.id);
        onUpdateSession(updated);
      } else {
        const updated = confirmSelection(activeSession, new Date().toISOString());
        onUpdateSession(updated);
      }
      setForm('normal');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'ยืนยันการสั่งซื้อไม่สำเร็จ');
    } finally {
      setBusy(false);
    }
  };

  const handleCancelCurrent = async (reason: string, text: string) => {
    if (!activeSession) return;
    setBusy(true);
    setError('');
    try {
      if (activeSession.id) {
        const updated = await cancelSessionApi(activeSession.id, reason, text);
        onUpdateSession(updated);
      } else {
        const updated: MockSession = {
          ...activeSession,
          outcome: 'CUSTOMER_CANCELLED',
          reason,
          otherReason: text || undefined,
          cancelledBy: user.staffId,
          timestamps: {
            ...activeSession.timestamps,
            cancelled_at: new Date().toISOString(),
          },
        };
        onUpdateSession(updated);
      }
      setForm('normal');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'ยกเลิกไม่สำเร็จ');
    } finally {
      setBusy(false);
    }
  };

  const handleUpdateSelection = async (selection: Selection) => {
    if (!activeSession) return;
    onUpdateSession({ ...activeSession, selection });
    if (activeSession.id) {
      try {
        const updated = await updateSelectionApi(
          activeSession.id,
          selection,
          activeSession.phone,
        );
        onUpdateSession(updated);
      } catch {
        // Keep optimistic update
      }
    }
  };

  const handleUpdatePhone = async (rawInput: string) => {
    if (!activeSession) return;
    const cleanPhone = rawInput.replace(/\D/g, '').slice(0, 10);
    setPhoneDrafts((prev) => ({ ...prev, [activeSession.reference]: cleanPhone }));
    setPhoneAttempted((prev) => ({ ...prev, [activeSession.reference]: false }));
    onUpdateSession({ ...activeSession, phone: cleanPhone });
    if (activeSession.id && cleanPhone.length === 10) {
      try {
        const updated = await updateSelectionApi(
          activeSession.id,
          activeSession.selection,
          cleanPhone,
        );
        onUpdateSession(updated);
      } catch {
        // Ignored until submit
      }
    }
  };

  return (
    <div className="staff-workspace">
      <div className="workspace-header-bar">
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <UserIcon size={24} color="#0abab5" />
          <div>
            <h2 style={{ margin: 0 }}>พื้นที่บริการหน้าร้าน</h2>
            <p className="muted" style={{ margin: 0 }}>
              สาขา {user.branch}
            </p>
          </div>
        </div>
        <div>
          <Button onClick={startNewWalkIn} disabled={busy}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
              <Plus size={16} />
              {busy ? 'กำลังสร้าง…' : 'ลงทะเบียนลูกค้าใหม่'}
            </span>
          </Button>
        </div>
      </div>

      {error && (
        <div style={{ marginBottom: '1rem' }}>
          <Notice error>{error}</Notice>
        </div>
      )}

      <div className="staff-layout">
        <div className="staff-sessions-sidebar">
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '12px' }}>
            <ClipboardList size={18} color="#0abab5" />
            <h3 style={{ margin: 0 }}>Session หน้าร้าน ({branchSessions.length})</h3>
          </div>
          <div className="queue-card-list">
            {branchSessions.map((s) => (
              <div
                key={s.reference}
                className={`queue-card ${activeSessionRef === s.reference ? 'selected' : ''}`}
                onClick={() => {
                  setActiveSessionRef(s.reference);
                  setForm('normal');
                }}
              >
                <div className="card-top">
                  <span className="card-ref">{s.reference}</span>
                  <span
                    className={`status-tag ${s.outcome ? 'status-outcome' : `status-${s.state.toLowerCase()}`}`}
                  >
                    {s.outcome ?? s.state}
                  </span>
                </div>
                <div className="card-product">
                  {s.selection.product?.model || 'ยังไม่ระบุสินค้า'}
                </div>
                <div className="card-meta">
                  <span>ผู้ดูแล: {s.staffId}</span>
                  <span>{s.phone || 'ยังไม่มีเบอร์'}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="staff-main-panel">
          {!activeSession ? (
            <div className="content-grid">
              <Panel
                title="เริ่มต้อนรับลูกค้า (Walk-in)"
                eyebrow="01 / CUSTOMER ARRIVAL"
              >
                <p className="muted">
                  สร้าง Customer Session ทันทีที่ลูกค้าเดินเข้ามาในร้าน
                </p>
                <div style={{ marginTop: '1.5rem' }}>
                  <Button onClick={startNewWalkIn} disabled={busy}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                      <Plus size={16} />
                      {busy ? 'กำลังสร้าง Session…' : 'ลูกค้าเดินเข้าร้าน'}
                    </span>
                  </Button>
                </div>
                <p className="fine" style={{ marginTop: '1rem' }}>
                  * เบอร์โทรศัพท์จะถูกขอเมื่อลูกค้าตัดสินใจ "ซื้อ" เท่านั้น
                </p>
              </Panel>
            </div>
          ) : (
            <>
              <section className="session-strip">
                <div>
                  <button
                    type="button"
                    className="mobile-back-to-queue-btn"
                    onClick={() => setActiveSessionRef(null)}
                  >
                    <ArrowLeft size={14} /> รายการ Session ({branchSessions.length})
                  </button>
                  <span className="eyebrow">
                    SESSION REFERENCE · {activeSession.branchName}
                  </span>
                  <h2>{activeSession.reference}</h2>
                  <span className="muted">
                    Customer Phone ·{' '}
                    {activeSession.phone ||
                      'ยังไม่ได้เก็บเบอร์โทร (รอหลังตัดสินใจ BUY)'}
                  </span>
                </div>
                <span className={`state-pill ${finished ? 'terminal' : ''}`}>
                  {activeSession.outcome ?? activeSession.state}
                </span>
              </section>

              <ol className="progress">
                {stages.map((label, index) => (
                  <li
                    key={label}
                    className={
                      index === progressIndex(activeSession)
                        ? 'current'
                        : index < progressIndex(activeSession)
                          ? 'done'
                          : ''
                    }
                    aria-current={
                      index === progressIndex(activeSession)
                        ? 'step'
                        : undefined
                    }
                  >
                    <span>
                      {index < progressIndex(activeSession) ? <Check size={14} /> : index + 1}
                    </span>
                    {label}
                  </li>
                ))}
              </ol>

              <div className="content-grid">
                <div>
                  <Panel
                    title={
                      finished
                        ? 'สิ้นสุดการบริการ'
                        : form === 'review'
                          ? 'ตรวจสอบและยืนยันข้อมูลสั่งซื้อ'
                          : form === 'cancel'
                            ? 'ยืนยันการยกเลิกบริการ'
                            : 'ดำเนินการบริการ'
                    }
                    eyebrow="CURRENT STAGE"
                  >
                    {finished ? (
                      <>
                        <Notice>
                          {activeSession.outcome ?? 'COMPLETED'} · Session
                          นี้สิ้นสุดแล้ว
                        </Notice>
                        {(activeSession.reason ||
                          activeSession.otherReason) && (
                          <p>
                            สาเหตุ: {activeSession.reason}{' '}
                            {activeSession.otherReason}
                          </p>
                        )}
                        {activeSession.cancelledBy && (
                          <p>ผู้ยกเลิก: {activeSession.cancelledBy}</p>
                        )}
                        <Summary session={activeSession} />
                        <div style={{ marginTop: '1rem' }}>
                          <Button
                            onClick={() => {
                              setActiveSessionRef(null);
                              setForm('normal');
                            }}
                          >
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                              <ArrowLeft size={16} />
                              กลับหน้าหลัก / พร้อมรับลูกค้าใหม่
                            </span>
                          </Button>
                        </div>
                      </>
                    ) : form === 'cancel' ? (
                      <ReasonForm
                        options={cancelReasons}
                        onBack={() => setForm('normal')}
                        label="ยืนยัน"
                        onSubmit={handleCancelCurrent}
                      />
                    ) : (
                      <>
                        {activeSession.state === 'WALK_IN' && (
                          <>
                            <p className="muted">
                              เริ่มการสาธิตสินค้า (DEMO) โดย <strong>{user.staffId}</strong>
                            </p>
                            <Button onClick={() => handleStep('startDemo')}>
                              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                                Start DEMO
                                <ArrowRight size={16} />
                              </span>
                            </Button>
                          </>
                        )}

                        {activeSession.state === 'DEMO' && (
                          <>
                            <Notice>
                              กำลังสาธิตสินค้า (DEMO) โดย {user.staffId}
                            </Notice>
                            <p>
                              นำเสนอสินค้า ให้คำแนะนำ
                              และทดลองใช้งานร่วมกับลูกค้า
                            </p>
                            <Button onClick={() => handleStep('endDemo')}>
                              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                                End DEMO
                                <ArrowRight size={16} />
                              </span>
                            </Button>
                          </>
                        )}

                        {activeSession.state === 'DECISION' &&
                          (activeSession.timestamps.decision_at ? (
                            <>
                              <Notice>
                                Decision: BUY
                              </Notice>
                              <label>
                                หมายเลขโทรศัพท์ลูกค้า (Customer Phone Number)
                                <input
                                  type="tel"
                                  inputMode="numeric"
                                  aria-invalid={
                                    Boolean(phoneAttempted[activeSession.reference] && !phoneIsValid(currentPhone))
                                  }
                                  aria-describedby="phone-help"
                                  autoComplete="off"
                                  placeholder="เบอร์โทรศัพท์ 10 หลัก (0-9)"
                                  value={currentPhone}
                                  onChange={(e) =>
                                    handleUpdatePhone(e.target.value)
                                  }
                                />
                              </label>
                              <p
                                id="phone-help"
                                className={
                                  phoneIsValid(currentPhone)
                                    ? 'fine'
                                    : phoneAttempted[activeSession.reference]
                                      ? 'field-error'
                                      : 'fine'
                                }
                              >
                                {phoneIsValid(currentPhone) ? (
                                  ''
                                ) : phoneAttempted[activeSession.reference] ? (
                                  `กรุณากรอกตัวเลข 0–9 ให้ครบ 10 หลัก (ขณะนี้ ${currentPhone.length}/10)`
                                ) : (
                                  ''
                                )}
                              </p>
                              <div style={{ marginTop: '1.25rem' }}>
                                <Button
                                  onClick={handleStartSelection}
                                >
                                  เลือกสินค้า →
                                </Button>
                              </div>
                            </>
                          ) : form === 'notBuy' ? (
                            <ReasonForm
                              options={notBuyReasons}
                              label="ยืนยัน"
                              onBack={() => setForm('normal')}
                              onSubmit={async (reason, text) => {
                                if (activeSession.id) {
                                  try {
                                    const updated = await recordNotBuyApi(
                                      activeSession.id,
                                      reason,
                                      text,
                                    );
                                    onUpdateSession(updated);
                                    setForm('normal');
                                    return;
                                  } catch (err: unknown) {
                                    setError(
                                      err instanceof Error
                                        ? err.message
                                        : 'Failed to record NOT BUY',
                                    );
                                  }
                                }
                                const updated: MockSession = {
                                  ...activeSession,
                                  outcome: 'NOT_BUY',
                                  reason,
                                  otherReason: text || undefined,
                                  timestamps: {
                                    ...activeSession.timestamps,
                                    decision_at: previewTime(),
                                  },
                                };
                                onUpdateSession(updated);
                                setForm('normal');
                              }}
                            />
                          ) : (
                            <>
                              <h3>ลูกค้าตัดสินใจอย่างไร?</h3>
                              <p className="muted">
                                บันทึกผลการตัดสินใจหลังจากการ DEMO
                              </p>
                              <div className="actions">
                                <Button onClick={() => handleStep('buy')}>
                                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                                    <Check size={16} /> BUY
                                  </span>
                                </Button>
                                <Button
                                  variant="secondary"
                                  onClick={() => setForm('notBuy')}
                                >
                                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                                    <X size={16} /> NOT BUY
                                  </span>
                                </Button>
                              </div>
                            </>
                          ))}

                        {activeSession.state === 'PRODUCT_SELECTION' &&
                          (form === 'review' ? (
                            <>
                              <Summary session={activeSession} />
                              <div className="actions">
                                <Button
                                  variant="secondary"
                                  onClick={() => setForm('normal')}
                                >
                                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                                    <ArrowLeft size={16} /> กลับไปแก้ไข
                                  </span>
                                </Button>
                                <Button onClick={handleConfirm}>
                                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                                    <Check size={16} /> ยืนยันการสั่งซื้อ
                                  </span>
                                </Button>
                              </div>
                            </>
                          ) : (
                            <SelectionEditor
                              value={activeSession.selection}
                              onChange={handleUpdateSelection}
                              onReview={() => setForm('review')}
                            />
                          ))}

                        {['STOCK_REQUESTED', 'SEARCHING', 'FOUND'].includes(
                          activeSession.state,
                        ) && (
                          <>
                            <Notice>
                              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                                <Package size={16} />
                                คำขออยู่ในกระบวนการของฝ่าย Stock ({activeSession.state})
                              </span>
                            </Notice>
                            <p className="muted">
                              ฝ่ายคลังกำลังจัดเตรียมสินค้า สามารถสลับไปหน้า
                              "คลังสินค้า" เพื่ออัปเดตสถานะได้
                            </p>
                            <Summary session={activeSession} />
                          </>
                        )}

                        {[
                          'SENT_TO_CASHIER',
                          'CASHIER_RECEIVED',
                          'CASHIER_SCAN',
                          'BILL_OPENED',
                        ].includes(activeSession.state) && (
                          <>
                            <Notice>
                              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                                <CreditCard size={16} />
                                สินค้าส่งถึงฝ่าย Cashier แล้ว ({activeSession.state})
                              </span>
                            </Notice>
                            <p className="muted">
                              แคชเชียร์กำลังเปิดบิลและรับชำระเงิน
                              สามารถสลับไปหน้า "แคชเชียร์" เพื่อดูความคืบหน้าได้
                            </p>
                            <Summary session={activeSession} />
                          </>
                        )}

                        {['DEMO', 'PRODUCT_SELECTION'].includes(
                          activeSession.state,
                        ) &&
                          !activeSession.confirmed &&
                          form !== 'review' && (
                            <div className="cancel-action">
                              <Button
                                variant="danger"
                                onClick={() => setForm('cancel')}
                              >
                                ยกเลิก
                              </Button>
                            </div>
                          )}
                      </>
                    )}
                  </Panel>
                </div>

                <div>
                  <Panel
                    title="ประวัติเวลาการบริการ"
                    eyebrow="SERVER TIMESTAMPS"
                  >
                    <ol className="timeline">
                      {Object.entries(activeSession.timestamps).map(
                        ([name, time]) => (
                          <li key={name}>
                            <span>{name}</span>
                            <time dateTime={time}>
                              {new Date(time).toLocaleTimeString('th-TH')}
                            </time>
                          </li>
                        ),
                      )}
                    </ol>
                  </Panel>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
