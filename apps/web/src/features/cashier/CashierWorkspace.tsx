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
} from 'lucide-react';
import { Button, Notice, Panel } from '../../components/ui';
import { Summary } from '../session/Summary';
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

  const selectedSession =
    cashierQueue.find((s) => s.reference === selectedRef) ||
    filteredQueue[0] ||
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
          title="ยกเลิกรายการ ณ แคชเชียร์ (CUSTOMER_CANCELLED)"
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
        <div className="cashier-layout">
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
                    onClick={() => setSelectedRef(s.reference)}
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
                          s.selection.product?.product}
                      </strong>
                      <span className="card-sku">
                        {s.selection.product?.sku}
                      </span>
                    </div>
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
              <Panel
                title={`รายการชำระเงิน: ${selectedSession.reference}`}
                eyebrow={`สถานะ: ${selectedSession.state}`}
              >
                <div className="detail-status-banner">
                  {selectedSession.state === 'SENT_TO_CASHIER' && (
                    <Notice>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                        <Package size={16} />
                        สินค้าถูกส่งมาจากฝ่ายคลังแล้ว · กด "รับสินค้าเข้าเคาน์เตอร์" เมื่อได้รับสินค้าจริง
                      </span>
                    </Notice>
                  )}
                  {selectedSession.state === 'CASHIER_RECEIVED' && (
                    <Notice>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                        <Tag size={16} />
                        รับสินค้าแล้ว · บันทึกเวลา cashier_received_at เรียบร้อย ขั้นตอนถัดไปคือการสแกนบาร์โค้ด
                      </span>
                    </Notice>
                  )}
                  {selectedSession.state === 'CASHIER_SCAN' && (
                    <Notice>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                        <FileText size={16} />
                        สแกนสินค้าแล้ว (cashier_scan_at) · แคชเชียร์กำลังบันทึกและเปิดบิลในระบบ FileMaker
                      </span>
                    </Notice>
                  )}
                  {selectedSession.state === 'BILL_OPENED' && (
                    <Notice>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                        <CheckCircle2 size={16} />
                        เปิดบิลใน FileMaker สำเร็จ (bill_opened_at) · กด "ปิดการขายสมบูรณ์ (COMPLETED)" เพื่อจบ Workflow
                      </span>
                    </Notice>
                  )}
                </div>

                <div className="cashier-step-flow">
                  <div
                    className={`flow-node ${selectedSession.state === 'SENT_TO_CASHIER' ? 'active' : 'done'}`}
                  >
                    1. รับสินค้า
                  </div>
                  <div className="flow-arrow">
                    <ArrowRight size={14} />
                  </div>
                  <div
                    className={`flow-node ${selectedSession.state === 'CASHIER_RECEIVED' ? 'active' : ['CASHIER_SCAN', 'BILL_OPENED'].includes(selectedSession.state) ? 'done' : ''}`}
                  >
                    2. สแกนบาร์โค้ด
                  </div>
                  <div className="flow-arrow">
                    <ArrowRight size={14} />
                  </div>
                  <div
                    className={`flow-node ${selectedSession.state === 'CASHIER_SCAN' ? 'active' : selectedSession.state === 'BILL_OPENED' ? 'done' : ''}`}
                  >
                    3. เปิดบิล FileMaker
                  </div>
                  <div className="flow-arrow">
                    <ArrowRight size={14} />
                  </div>
                  <div
                    className={`flow-node ${selectedSession.state === 'BILL_OPENED' ? 'active' : ''}`}
                  >
                    4. ปิดการขาย (Completed)
                  </div>
                </div>

                <div className="cashier-action-bar">
                  {selectedSession.state === 'SENT_TO_CASHIER' && (
                    <div className="actions">
                      <Button
                        onClick={() => handleAction(selectedSession, 'receive')}
                      >
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                          <Inbox size={16} />
                          รับสินค้าเข้าเคาน์เตอร์
                        </span>
                      </Button>
                      <Button
                        variant="danger"
                        onClick={() => setCancellingSession(selectedSession)}
                      >
                        ลูกค้ายกเลิก
                      </Button>
                    </div>
                  )}

                  {selectedSession.state === 'CASHIER_RECEIVED' && (
                    <div className="actions">
                      <Button
                        onClick={() => handleAction(selectedSession, 'scan')}
                      >
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                          <Barcode size={16} />
                          สแกนสินค้า
                        </span>
                      </Button>
                      <Button
                        variant="danger"
                        onClick={() => setCancellingSession(selectedSession)}
                      >
                        ลูกค้ายกเลิก
                      </Button>
                    </div>
                  )}

                  {selectedSession.state === 'CASHIER_SCAN' && (
                    <div className="actions">
                      <Button
                        onClick={() => handleAction(selectedSession, 'bill')}
                      >
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                          <FileText size={16} />
                          ยืนยันเปิดบิลใน FileMaker
                        </span>
                      </Button>
                      <Button
                        variant="danger"
                        onClick={() => setCancellingSession(selectedSession)}
                      >
                        ลูกค้ายกเลิก
                      </Button>
                    </div>
                  )}

                  {selectedSession.state === 'BILL_OPENED' && (
                    <div className="actions">
                      <Button
                        onClick={() =>
                          handleAction(selectedSession, 'complete')
                        }
                      >
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                          <CheckCircle2 size={16} />
                          ปิดการขายสมบูรณ์ (COMPLETED)
                        </span>
                      </Button>
                    </div>
                  )}
                </div>

                <div className="cashier-summary-container">
                  <h3>สรุปข้อมูลคำสั่งซื้อ & การชำระเงิน</h3>
                  <Summary session={selectedSession} />
                </div>
              </Panel>
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
