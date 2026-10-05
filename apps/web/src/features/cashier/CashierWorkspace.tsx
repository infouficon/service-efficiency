import { useState } from 'react';
import {
  CreditCard,
  CheckCircle2,
  Package,
  Tag,
  FileText,
  Inbox,
  Barcode,
  ArrowRight,
  ArrowLeft,
  Phone,
  User as UserIcon,
  Check,
  Zap,
  Sparkles,
  ShoppingBag,
  Percent,
  ClipboardList,
} from 'lucide-react';
import { Button, Notice, Panel } from '../../components/ui';
import { ReasonForm } from '../session/ReasonForm';
import { cancelReasons } from '../../constants/options';
import type { MockSession, MockUser } from '../../types/session';
import {
  advanceStepApi,
  cancelSessionApi,
} from '../../services/sessionApi';
import { advance } from '../session/workflow';

const previewTime = () => new Date().toISOString();

interface CashierWorkspaceProps {
  user: MockUser;
  sessions: MockSession[];
  onUpdateSession: (updated: MockSession) => void;
}

export function CashierWorkspace({
  user,
  sessions,
  onUpdateSession,
}: CashierWorkspaceProps) {
  const [filter, setFilter] = useState<
    'ALL' | 'SENT' | 'RECEIVED' | 'SCAN' | 'BILL'
  >('ALL');
  const [selectedRef, setSelectedRef] = useState<string | null>(null);
  const [mobileShowDetail, setMobileShowDetail] = useState(false);
  const [cancellingSession, setCancellingSession] =
    useState<MockSession | null>(null);

  const branchSessions = sessions.filter((s) => {
    if (user.roles.includes('ADMIN')) return true;
    return s.branchCode === (user.branchCode ?? '');
  });

  const cashierQueue = branchSessions.filter(
    (s) =>
      !s.outcome &&
      [
        'SENT_TO_CASHIER',
        'CASHIER_RECEIVED',
        'CASHIER_SCAN',
        'BILL_OPENED',
      ].includes(s.state),
  );

  const filteredQueue = cashierQueue.filter((s) => {
    if (filter === 'SENT') return s.state === 'SENT_TO_CASHIER';
    if (filter === 'RECEIVED') return s.state === 'CASHIER_RECEIVED';
    if (filter === 'SCAN') return s.state === 'CASHIER_SCAN';
    if (filter === 'BILL') return s.state === 'BILL_OPENED';
    return true;
  });

  // On desktop: auto-select first item. On mobile: only show detail when explicitly chosen.
  const selectedSession =
    cashierQueue.find((s) => s.reference === selectedRef) ||
    (mobileShowDetail ? null : filteredQueue[0]) ||
    null;

  const handleAction = async (
    session: MockSession,
    action: 'receive' | 'scan' | 'bill' | 'complete',
  ) => {
    if (session.id) {
      try {
        const updated = await advanceStepApi(session.id, action);
        onUpdateSession(updated);
        return;
      } catch {
        // Fallback to in-memory on error
      }
    }
    const updated = advance(session, action, previewTime());
    onUpdateSession(updated);
  };

  const handleCancel = async (reason: string, text: string) => {
    if (!cancellingSession) return;
    if (cancellingSession.id) {
      try {
        const updated = await cancelSessionApi(
          cancellingSession.id,
          reason,
          text || undefined,
        );
        onUpdateSession(updated);
        setCancellingSession(null);
        return;
      } catch {
        // Fallback
      }
    }
    const updated: MockSession = {
      ...cancellingSession,
      outcome: 'CUSTOMER_CANCELLED',
      reason,
      otherReason: text || undefined,
      cancelledBy: user.staffId,
      timestamps: {
        ...cancellingSession.timestamps,
        cancelled_at: previewTime(),
      },
    };
    onUpdateSession(updated);
    setCancellingSession(null);
  };

  const steps = [
    {
      key: 'SENT_TO_CASHIER',
      label: '1. รับมอบสินค้า',
      desc: 'รอรับสินค้าจากคลัง',
      isDone: (state: string) =>
        ['CASHIER_RECEIVED', 'CASHIER_SCAN', 'BILL_OPENED', 'COMPLETED'].includes(state),
      isActive: (state: string) => state === 'SENT_TO_CASHIER',
    },
    {
      key: 'CASHIER_RECEIVED',
      label: '2. สแกนบาร์โค้ด',
      desc: 'สแกนสินค้าที่เคาน์เตอร์',
      isDone: (state: string) =>
        ['CASHIER_SCAN', 'BILL_OPENED', 'COMPLETED'].includes(state),
      isActive: (state: string) => state === 'CASHIER_RECEIVED',
    },
    {
      key: 'CASHIER_SCAN',
      label: '3. เปิดบิล FileMaker',
      desc: 'บันทึกบิลในระบบ',
      isDone: (state: string) =>
        ['BILL_OPENED', 'COMPLETED'].includes(state),
      isActive: (state: string) => state === 'CASHIER_SCAN',
    },
    {
      key: 'BILL_OPENED',
      label: '4. ปิดการขาย',
      desc: 'จบขั้นตอนบริการ',
      isDone: (state: string) => state === 'COMPLETED',
      isActive: (state: string) => state === 'BILL_OPENED',
    },
  ];

  return (
    <div className="cashier-workspace">
      <div className="workspace-header-bar">
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <CreditCard size={24} color="#0abab5" />
          <div>
            <h2 style={{ margin: 0 }}>เคาน์เตอร์แคชเชียร์ (Cashier Operations)</h2>
            <p className="muted" style={{ margin: 0 }}>
              รับมอบสินค้าจากคลัง สแกน และบันทึกการเปิดบิล · สาขา {user.branch}
            </p>
          </div>
        </div>
        <div className="stats-pills">
          <span className="stat-badge pending">
            ส่งมาจาก Stock:{' '}
            {cashierQueue.filter((s) => s.state === 'SENT_TO_CASHIER').length}
          </span>
          <span className="stat-badge active">
            กำลังดำเนินการ:{' '}
            {
              cashierQueue.filter((s) =>
                ['CASHIER_RECEIVED', 'CASHIER_SCAN'].includes(s.state),
              ).length
            }
          </span>
          <span className="stat-badge ready">
            เปิดบิลแล้ว:{' '}
            {cashierQueue.filter((s) => s.state === 'BILL_OPENED').length}
          </span>
        </div>
      </div>

      {cancellingSession ? (
        <Panel
          title="ยกเลิกรายการ ณ แคชเชียร์"
          eyebrow="CASHIER CANCELLATION"
        >
          <p>
            ยกเลิก Session: <strong>{cancellingSession.reference}</strong> (
            {cancellingSession.selection.product?.model})
          </p>
          <ReasonForm
            options={cancelReasons}
            label="ยืนยันการยกเลิก"
            onBack={() => setCancellingSession(null)}
            onSubmit={handleCancel}
          />
        </Panel>
      ) : (
        <div
          className="cashier-layout"
          data-mobile-detail={mobileShowDetail ? 'true' : 'false'}
        >
          <div className="cashier-queue-column">
            <div className="queue-filter-tabs">
              <button
                className={`tab-btn ${filter === 'ALL' ? 'active' : ''}`}
                onClick={() => setFilter('ALL')}
              >
                ทั้งหมด ({cashierQueue.length})
              </button>
              <button
                className={`tab-btn ${filter === 'SENT' ? 'active' : ''}`}
                onClick={() => setFilter('SENT')}
              >
                รอรับ (
                {
                  cashierQueue.filter((s) => s.state === 'SENT_TO_CASHIER')
                    .length
                }
                )
              </button>
              <button
                className={`tab-btn ${filter === 'RECEIVED' ? 'active' : ''}`}
                onClick={() => setFilter('RECEIVED')}
              >
                รับแล้ว (
                {
                  cashierQueue.filter((s) => s.state === 'CASHIER_RECEIVED')
                    .length
                }
                )
              </button>
              <button
                className={`tab-btn ${filter === 'SCAN' ? 'active' : ''}`}
                onClick={() => setFilter('SCAN')}
              >
                สแกน (
                {cashierQueue.filter((s) => s.state === 'CASHIER_SCAN').length})
              </button>
              <button
                className={`tab-btn ${filter === 'BILL' ? 'active' : ''}`}
                onClick={() => setFilter('BILL')}
              >
                เปิดบิล (
                {cashierQueue.filter((s) => s.state === 'BILL_OPENED').length})
              </button>
            </div>

            <div className="queue-card-list">
              {filteredQueue.length === 0 ? (
                <div className="empty-state">
                  <div className="empty-icon">
                    <CheckCircle2 size={32} color="#0abab5" />
                  </div>
                  <p>ไม่มีรายการค้างในแคชเชียร์</p>
                </div>
              ) : (
                filteredQueue.map((s) => (
                  <div
                    key={s.reference}
                    className={`queue-card ${selectedSession?.reference === s.reference ? 'selected' : ''}`}
                    onClick={() => {
                      setSelectedRef(s.reference);
                      setMobileShowDetail(true);
                    }}
                  >
                    <div className="card-top">
                      <span className="card-ref">{s.reference}</span>
                      <span
                        className={`status-tag status-${s.state.toLowerCase()}`}
                      >
                        {s.state === 'SENT_TO_CASHIER' && 'สินค้ามาถึง'}
                        {s.state === 'CASHIER_RECEIVED' && 'รับสินค้าแล้ว'}
                        {s.state === 'CASHIER_SCAN' && 'สแกนแล้ว'}
                        {s.state === 'BILL_OPENED' && 'เปิดบิลแล้ว'}
                      </span>
                    </div>
                    <div className="card-product">
                      <strong>
                        {s.selection.product?.model ||
                          s.selection.product?.product ||
                          'อุปกรณ์เสริม'}
                      </strong>
                      <span className="card-sku">
                        {s.selection.product?.sku}
                      </span>
                    </div>
                    {Object.keys(s.selection.accessories).length > 0 && (
                      <div className="card-accessories">
                        + {Object.entries(s.selection.accessories).map(([k, v]) => `${k} (x${v})`).join(', ')}
                      </div>
                    )}
                    <div className="card-meta">
                      <span>โทร: {s.phone}</span>
                      <span>
                        ชำระ: {s.selection.payments.join(', ') || 'ไม่ได้ระบุ'}
                      </span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="cashier-detail-column">
            {selectedSession ? (
              <div className="cashier-detail-card">
                {/* 1. Header Row */}
                <div className="cashier-card-header">
                  <button
                    type="button"
                    className="mobile-back-to-queue-btn"
                    onClick={() => setMobileShowDetail(false)}
                  >
                    <ArrowLeft size={14} /> คิวแคชเชียร์ ({filteredQueue.length})
                  </button>
                  <div className="cashier-header-title-row">
                    <div>
                      <div className="eyebrow">
                        CASHIER TRANSACTION · {selectedSession.branchName || `สาขา ${user.branch}`}
                      </div>
                      <h2 className="cashier-ref-title">{selectedSession.reference}</h2>
                    </div>
                    <span
                      className={`status-tag status-${selectedSession.state.toLowerCase()} cashier-status-badge`}
                    >
                      {selectedSession.state === 'SENT_TO_CASHIER' && '📦 สินค้ามาถึงแล้ว (รอรับมอบ)'}
                      {selectedSession.state === 'CASHIER_RECEIVED' && '🏷️ รับมอบสินค้าแล้ว (รอสแกน)'}
                      {selectedSession.state === 'CASHIER_SCAN' && '📄 สแกนแล้ว (รอเปิดบิล)'}
                      {selectedSession.state === 'BILL_OPENED' && '✅ เปิดบิลแล้ว (พร้อมจบการขาย)'}
                    </span>
                  </div>
                </div>

                {/* 2. Modern Stepper */}
                <div className="cashier-stepper">
                  {steps.map((st, idx) => {
                    const done = st.isDone(selectedSession.state);
                    const active = st.isActive(selectedSession.state);
                    return (
                      <div key={st.key} style={{ display: 'flex', alignItems: 'center', flex: 1 }}>
                        <div
                          className={`cashier-step-item ${done ? 'done' : ''} ${active ? 'active' : ''}`}
                        >
                          <div className="cashier-step-circle">
                            {done ? <Check size={16} /> : idx + 1}
                          </div>
                          <div>
                            <div className="cashier-step-label">{st.label}</div>
                            <div className="cashier-step-desc fine">{st.desc}</div>
                          </div>
                        </div>
                        {idx < steps.length - 1 && (
                          <div
                            className={`cashier-step-divider ${done ? 'done' : ''}`}
                          />
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* 3. Action Card Banner */}
                <div
                  className={`cashier-action-banner state-${selectedSession.state.toLowerCase()}`}
                >
                  <div className="action-banner-header">
                    {selectedSession.state === 'SENT_TO_CASHIER' && (
                      <>
                        <Inbox size={22} color="#0d8a72" />
                        <div>
                          <h3>ขั้นตอนที่ 1: รับมอบสินค้าเข้าเคาน์เตอร์</h3>
                          <div className="action-banner-body">
                            สินค้าถูกจัดส่งจากฝ่ายคลัง (Stock) เรียบร้อยแล้ว กรุณาตรวจรับสินค้าจริงและกดปุ่มเพื่อบันทึกเวลา <code>cashier_received_at</code>
                          </div>
                        </div>
                      </>
                    )}
                    {selectedSession.state === 'CASHIER_RECEIVED' && (
                      <>
                        <Barcode size={22} color="#1d4ed8" />
                        <div>
                          <h3>ขั้นตอนที่ 2: สแกนบาร์โค้ดสินค้า</h3>
                          <div className="action-banner-body">
                            สแกนบาร์โค้ดสินค้า/อุปกรณ์เสริม เพื่อบันทึกเวลา <code>cashier_scan_at</code> ก่อนเปิดบิลใน FileMaker
                          </div>
                        </div>
                      </>
                    )}
                    {selectedSession.state === 'CASHIER_SCAN' && (
                      <>
                        <FileText size={22} color="#7c3aed" />
                        <div>
                          <h3>ขั้นตอนที่ 3: บันทึกและเปิดบิลใน FileMaker</h3>
                          <div className="action-banner-body">
                            กรอกข้อมูลการสั่งซื้อและชำระเงินในระบบ FileMaker เมื่อเปิดบิลสำเร็จแล้ว กดปุ่มยืนยันเพื่อบันทึก <code>bill_opened_at</code>
                          </div>
                        </div>
                      </>
                    )}
                    {selectedSession.state === 'BILL_OPENED' && (
                      <>
                        <CheckCircle2 size={22} color="#059669" />
                        <div>
                          <h3>ขั้นตอนที่ 4: ปิดการขายสมบูรณ์ (Workflow Completed)</h3>
                          <div className="action-banner-body">
                            มอบสินค้าและใบเสร็จให้ลูกค้าเรียบร้อยแล้ว กดปุ่มด้านล่างเพื่อสิ้นสุดขั้นตอนการบริการของ Session นี้
                          </div>
                        </div>
                      </>
                    )}
                  </div>

                  <div className="action-banner-buttons">
                    {selectedSession.state === 'SENT_TO_CASHIER' && (
                      <>
                        <Button
                          className="btn-large-cta"
                          onClick={() => handleAction(selectedSession, 'receive')}
                        >
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
                            <Inbox size={18} />
                            รับสินค้าเข้าเคาน์เตอร์
                          </span>
                        </Button>
                        <Button
                          variant="danger"
                          onClick={() => setCancellingSession(selectedSession)}
                        >
                          ลูกค้ายกเลิก
                        </Button>
                      </>
                    )}

                    {selectedSession.state === 'CASHIER_RECEIVED' && (
                      <>
                        <Button
                          className="btn-large-cta"
                          onClick={() => handleAction(selectedSession, 'scan')}
                        >
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
                            <Barcode size={18} />
                            สแกนสินค้า
                          </span>
                        </Button>
                        <Button
                          variant="danger"
                          onClick={() => setCancellingSession(selectedSession)}
                        >
                          ลูกค้ายกเลิก
                        </Button>
                      </>
                    )}

                    {selectedSession.state === 'CASHIER_SCAN' && (
                      <>
                        <Button
                          className="btn-large-cta"
                          onClick={() => handleAction(selectedSession, 'bill')}
                        >
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
                            <FileText size={18} />
                            ยืนยันเปิดบิล FileMaker เรียบร้อย
                          </span>
                        </Button>
                        <Button
                          variant="danger"
                          onClick={() => setCancellingSession(selectedSession)}
                        >
                          ลูกค้ายกเลิก
                        </Button>
                      </>
                    )}

                    {selectedSession.state === 'BILL_OPENED' && (
                      <Button
                        className="btn-large-cta"
                        onClick={() => handleAction(selectedSession, 'complete')}
                      >
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
                          <CheckCircle2 size={18} />
                          ปิดการขายสมบูรณ์ (COMPLETED)
                        </span>
                      </Button>
                    )}
                  </div>
                </div>

                {/* 4. Unified Summary Section (Single Frame) */}
                <div className="cashier-summary-card">
                  <div className="summary-card-header">
                    <ClipboardList size={18} color="#0abab5" />
                    <h3 style={{ margin: 0, fontSize: '15px' }}>สรุปข้อมูลคำสั่งซื้อ & การชำระเงิน</h3>
                  </div>

                  <div className="summary-subsections-wrap">
                    {/* Section A: Customer & Staff Info */}
                    <div className="summary-subsection">
                      <div className="subsection-title">
                        <UserIcon size={15} /> ข้อมูลลูกค้า & ผู้ให้บริการ
                      </div>
                      <div className="subsection-grid">
                        <div className="info-item-row">
                          <span className="info-item-label">เบอร์โทรศัพท์ลูกค้า:</span>
                          <span className="info-item-value" style={{ letterSpacing: '0.5px' }}>
                            {selectedSession.phone ? (
                              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                                <Phone size={13} color="#0abab5" /> {selectedSession.phone}
                              </span>
                            ) : (
                              '—'
                            )}
                          </span>
                        </div>
                        <div className="info-item-row">
                          <span className="info-item-label">Staff ผู้เปิดรายการ:</span>
                          <span className="info-item-value">{selectedSession.staffId}</span>
                        </div>
                        <div className="info-item-row">
                          <span className="info-item-label">สาขา:</span>
                          <span className="info-item-value">{selectedSession.branchName || user.branch}</span>
                        </div>
                      </div>
                    </div>

                    {/* Section B: Product & Accessories */}
                    <div className="summary-subsection">
                      <div className="subsection-title">
                        <ShoppingBag size={15} /> รายการสินค้า & อุปกรณ์เสริม
                      </div>
                      <div className="subsection-grid">
                        {selectedSession.selection.product ? (
                          <>
                            <div className="info-item-row">
                              <span className="info-item-label">สินค้าหลัก (Model):</span>
                              <span className="info-item-value">
                                {selectedSession.selection.product.category} · {selectedSession.selection.product.model || selectedSession.selection.product.product}
                              </span>
                            </div>
                            <div className="info-item-row">
                              <span className="info-item-label">รหัสสินค้า (SKU):</span>
                              <span className="product-sku-chip">
                                {selectedSession.selection.product.sku || '—'}
                              </span>
                            </div>
                          </>
                        ) : (
                          <div className="info-item-row">
                            <span className="info-item-label">สินค้าหลัก:</span>
                            <span className="muted" style={{ fontSize: '13px' }}>ซื้อเฉพาะอุปกรณ์เสริม</span>
                          </div>
                        )}
                        <div className="info-item-row" style={{ alignItems: 'flex-start' }}>
                          <span className="info-item-label" style={{ paddingTop: '4px' }}>อุปกรณ์เสริม:</span>
                          <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'flex-end', flex: 1 }}>
                            {Object.keys(selectedSession.selection.accessories).length > 0 ? (
                              Object.entries(selectedSession.selection.accessories).map(([name, qty]) => (
                                <span key={name} className="accessory-chip-pill">
                                  <strong>{name}</strong>
                                  <span style={{ color: '#0abab5', fontWeight: 700 }}>× {qty}</span>
                                </span>
                              ))
                            ) : (
                              <span className="muted" style={{ fontSize: '13px' }}>ไม่มีอุปกรณ์เสริม</span>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Section C: Payment & Promotions */}
                    <div className="summary-subsection">
                      <div className="subsection-title">
                        <Percent size={15} /> วิธีชำระเงิน & สิทธิพิเศษ
                      </div>
                      <div className="subsection-grid">
                        <div className="info-item-row">
                          <span className="info-item-label">วิธีชำระเงิน:</span>
                          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                            {selectedSession.selection.payments.length > 0 ? (
                              selectedSession.selection.payments.map((p) => (
                                <span key={p} className="payment-tag-chip">
                                  <CreditCard size={12} /> {p}
                                </span>
                              ))
                            ) : (
                              <span className="muted">—</span>
                            )}
                          </div>
                        </div>
                        {selectedSession.selection.ontop.length > 0 && (
                          <div className="info-item-row">
                            <span className="info-item-label">Ontop:</span>
                            <span className="info-item-value">{selectedSession.selection.ontop.join(', ')}</span>
                          </div>
                        )}
                        {selectedSession.selection.points.length > 0 && (
                          <div className="info-item-row">
                            <span className="info-item-label">สะสมคะแนน:</span>
                            <span className="info-item-value">{selectedSession.selection.points.join(', ')}</span>
                          </div>
                        )}
                        {selectedSession.selection.burnPoints.length > 0 && (
                          <div className="info-item-row">
                            <span className="info-item-label">ตัดแต้ม (Burn Points):</span>
                            <span className="info-item-value">{selectedSession.selection.burnPoints.join(', ')}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <Panel
                title="กรุณาเลือกรายการชำระเงิน"
                eyebrow="CASHIER SELECTION"
              >
                <p className="muted">
                  เลือกรายการจากคิวทางด้านซ้ายเพื่อดำเนินการขั้นตอนชำระเงิน
                </p>
              </Panel>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

