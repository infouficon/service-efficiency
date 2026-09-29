import { useState } from 'react';
import {
  Package,
  Search,
  Check,
  X,
  Send,
  Clock,
  Zap,
  CheckCircle2,
} from 'lucide-react';
import { Button, Notice, Panel } from '../../components/ui';
import { Summary } from '../session/Summary';
import { ReasonForm } from '../session/ReasonForm';
import { cancelReasons } from '../../constants/options';
import type { MockSession, MockUser } from '../../types/session';
import {
  advanceStepApi,
  cancelSessionApi,
  recordOutOfStockApi,
} from '../../services/sessionApi';
import { advance, partialFulfillStock } from '../session/workflow';

const previewTime = () => new Date().toISOString();

interface StockWorkspaceProps {
  user: MockUser;
  sessions: MockSession[];
  onUpdateSession: (updated: MockSession) => void;
}

export function StockWorkspace({
  user,
  sessions,
  onUpdateSession,
}: StockWorkspaceProps) {
  const [filter, setFilter] = useState<
    'ALL' | 'REQUESTED' | 'SEARCHING' | 'FOUND'
  >('ALL');
  const [selectedRef, setSelectedRef] = useState<string | null>(null);
  const [stockNote, setStockNote] = useState('');
  const [outOfStockSelection, setOutOfStockSelection] = useState<string[]>([]);
  const [cancellingSession, setCancellingSession] =
    useState<MockSession | null>(null);

  // Filter sessions by branch (ADMIN sees all or filtered, STAFF/STOCK sees own branch)
  const branchSessions = sessions.filter((s) => {
    if (user.roles.includes('ADMIN')) return true;
    return s.branchCode === (user.branchCode ?? '');
  });

  const stockQueue = branchSessions.filter(
    (s) =>
      !s.outcome && ['STOCK_REQUESTED', 'SEARCHING', 'FOUND'].includes(s.state),
  );

  const filteredQueue = stockQueue.filter((s) => {
    if (filter === 'REQUESTED') return s.state === 'STOCK_REQUESTED';
    if (filter === 'SEARCHING') return s.state === 'SEARCHING';
    if (filter === 'FOUND') return s.state === 'FOUND';
    return true;
  });

  const selectedSession =
    stockQueue.find((s) => s.reference === selectedRef) ||
    filteredQueue[0] ||
    null;

  const handleAction = async (
    session: MockSession,
    action: 'search' | 'found' | 'send',
  ) => {
    if (session.id) {
      try {
        const updated = await advanceStepApi(session.id, action);
        onUpdateSession(updated);
        setOutOfStockSelection([]);
        return;
      } catch {
        // Fallback to in-memory on error
      }
    }
    const updated = advance(session, action, previewTime());
    onUpdateSession(updated);
    setOutOfStockSelection([]);
  };

  const handlePartialFulfill = async (session: MockSession) => {
    if (session.id) {
      try {
        const updated = await recordOutOfStockApi(
          session.id,
          'PARTIAL_FULFILL',
          stockNote || undefined,
          outOfStockSelection,
          'partial',
          stockNote,
        );
        onUpdateSession(updated);
        setOutOfStockSelection([]);
        setStockNote('');
        return;
      } catch {
        // Fallback
      }
    }
    const updated = partialFulfillStock(
      session,
      outOfStockSelection,
      previewTime(),
    );
    onUpdateSession(updated);
    setOutOfStockSelection([]);
    setStockNote('');
  };

  const handleFullOutOfStock = async (session: MockSession) => {
    if (session.id) {
      try {
        const detailedReason =
          stockNote ||
          (outOfStockSelection.length > 0
            ? `สินค้าหมด: ${outOfStockSelection.join(', ')}`
            : undefined);
        const updated = await recordOutOfStockApi(
          session.id,
          'OUT_OF_STOCK',
          detailedReason,
          outOfStockSelection,
          'cancel',
          stockNote,
        );
        onUpdateSession(updated);
        setOutOfStockSelection([]);
        setStockNote('');
        return;
      } catch {
        // Fallback
      }
    }
    const detailedReason =
      stockNote ||
      (outOfStockSelection.length > 0
        ? `สินค้าหมด: ${outOfStockSelection.join(', ')}`
        : undefined);
    const updated: MockSession = {
      ...session,
      outcome: 'OUT_OF_STOCK',
      otherReason: detailedReason,
    };
    onUpdateSession(updated);
    setOutOfStockSelection([]);
    setStockNote('');
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
    <div className="stock-workspace">
      <div className="workspace-header-bar">
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Package size={24} color="#0abab5" />
          <div>
            <h2 style={{ margin: 0 }}>คลังสินค้า (Stock Operations)</h2>
            <p className="muted" style={{ margin: 0 }}>
              จัดการรายการคำขอเบิกสินค้า ค้นหา และส่งต่อไปยังแคชเชียร์ · สาขา{' '}
              {user.branch}
            </p>
          </div>
        </div>
        <div className="stats-pills">
          <span className="stat-badge pending">
            รอค้นหา:{' '}
            {stockQueue.filter((s) => s.state === 'STOCK_REQUESTED').length}
          </span>
          <span className="stat-badge active">
            กำลังค้นหา:{' '}
            {stockQueue.filter((s) => s.state === 'SEARCHING').length}
          </span>
          <span className="stat-badge ready">
            พร้อมส่งแคชเชียร์:{' '}
            {stockQueue.filter((s) => s.state === 'FOUND').length}
          </span>
        </div>
      </div>

      {cancellingSession ? (
        <Panel
          title="ยกเลิกคำขอบริการ (CUSTOMER_CANCELLED)"
          eyebrow="STOCK CANCELLATION"
        >
          <p>
            ยกเลิกคำขอสำหรับ Session:{' '}
            <strong>{cancellingSession.reference}</strong> (
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
        <div className="stock-layout">
          <div className="stock-queue-column">
            <div className="queue-filter-tabs">
              <button
                className={`tab-btn ${filter === 'ALL' ? 'active' : ''}`}
                onClick={() => setFilter('ALL')}
              >
                ทั้งหมด ({stockQueue.length})
              </button>
              <button
                className={`tab-btn ${filter === 'REQUESTED' ? 'active' : ''}`}
                onClick={() => setFilter('REQUESTED')}
              >
                รอเริ่ม (
                {stockQueue.filter((s) => s.state === 'STOCK_REQUESTED').length}
                )
              </button>
              <button
                className={`tab-btn ${filter === 'SEARCHING' ? 'active' : ''}`}
                onClick={() => setFilter('SEARCHING')}
              >
                กำลังหา (
                {stockQueue.filter((s) => s.state === 'SEARCHING').length})
              </button>
              <button
                className={`tab-btn ${filter === 'FOUND' ? 'active' : ''}`}
                onClick={() => setFilter('FOUND')}
              >
                พบแล้ว ({stockQueue.filter((s) => s.state === 'FOUND').length})
              </button>
            </div>

            <div className="queue-card-list">
              {filteredQueue.length === 0 ? (
                <div className="empty-state">
                  <div className="empty-icon">
                    <CheckCircle2 size={32} color="#0abab5" />
                  </div>
                  <p>ไม่มีรายการคำขอในสถานะนี้</p>
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
                        {s.state === 'STOCK_REQUESTED' && 'รอค้นหา'}
                        {s.state === 'SEARCHING' && 'กำลังค้นหา'}
                        {s.state === 'FOUND' && 'พบสินค้าแล้ว'}
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
                    {Object.keys(s.selection.accessories).length > 0 && (
                      <div className="card-accessories">
                        + อุปกรณ์เสริม:{' '}
                        {Object.entries(s.selection.accessories)
                          .map(([k, v]) => `${k} (x${v})`)
                          .join(', ')}
                      </div>
                    )}
                    <div className="card-meta">
                      <span>โทร: {s.phone}</span>
                      <span>ร้องขอโดย: {s.staffId}</span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="stock-detail-column">
            {selectedSession ? (
              <Panel
                title={`รายละเอียดคำขอ: ${selectedSession.reference}`}
                eyebrow={`สถานะปัจจุบัน: ${selectedSession.state}`}
              >
                <div className="detail-status-banner">
                  {selectedSession.state === 'STOCK_REQUESTED' && (
                    <Notice>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                        <Clock size={16} />
                        ได้รับคำขอยืนยันจากหน้าร้านแล้ว (กดปุ่ม "เริ่มค้นหา" เมื่อเริ่มเดินไปหยิบสินค้า)
                      </span>
                    </Notice>
                  )}
                  {selectedSession.state === 'SEARCHING' && (
                    <Notice>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                        <Search size={16} />
                        กำลังค้นหาสินค้าในคลัง (Server เริ่มจับเวลา stock_started_at)
                      </span>
                    </Notice>
                  )}
                  {selectedSession.state === 'FOUND' && (
                    <Notice>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                        <Check size={16} />
                        พบสินค้าแล้ว (Server บันทึก stock_found_at เรียบร้อย พร้อมส่งต่อแคชเชียร์)
                      </span>
                    </Notice>
                  )}
                </div>

                <div className="detail-section">
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px' }}>
                    <Package size={18} color="#0abab5" />
                    <h3 style={{ margin: 0 }}>สินค้าที่ต้องเบิก</h3>
                  </div>
                  <div className="product-highlight-box">
                    <div className="product-title">
                      {selectedSession.selection.product?.model}
                    </div>
                    <div className="product-sku">
                      SKU:{' '}
                      <strong>{selectedSession.selection.product?.sku}</strong>
                    </div>
                    <div className="product-cat">
                      หมวดหมู่: {selectedSession.selection.product?.category}
                    </div>
                  </div>

                  {Object.keys(selectedSession.selection.accessories).length >
                    0 && (
                    <div className="accessories-list-box">
                      <h4>อุปกรณ์เสริมที่ต้องจัดคู่กัน:</h4>
                      <ul>
                        {Object.entries(
                          selectedSession.selection.accessories,
                        ).map(([name, qty]) => (
                          <li key={name}>
                            <strong>{name}</strong> — จำนวน:{' '}
                            <span className="qty-badge">{qty}</span> ชิ้น
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>

                <div className="detail-actions-area">
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px' }}>
                    <Zap size={18} color="#0abab5" />
                    <h3 style={{ margin: 0 }}>การดำเนินการ (Stock Actions)</h3>
                  </div>
                  {selectedSession.state === 'STOCK_REQUESTED' && (
                    <div className="actions">
                      <Button
                        onClick={() => handleAction(selectedSession, 'search')}
                      >
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                          <Search size={16} />
                          เริ่มค้นหาสินค้า (SEARCHING)
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

                  {selectedSession.state === 'SEARCHING' && (
                    <div className="searching-action-box">
                      <div style={{ marginBottom: '16px' }}>
                        <h4 style={{ margin: '0 0 8px', fontSize: '13px', color: '#496357' }}>
                          ตรวจสอบรายการสินค้า (ติ๊กเลือกหาก <strong>"ไม่พบ / สินค้าหมด"</strong>):
                        </h4>
                        <div className="accessory-list">
                          {selectedSession.selection.product && (
                            <div
                              className={`accessory-item ${
                                outOfStockSelection.includes('MAIN_PRODUCT')
                                  ? 'out-of-stock-item'
                                  : ''
                              }`}
                            >
                              <label
                                style={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: '8px',
                                  cursor: 'pointer',
                                  margin: 0,
                                }}
                              >
                                <input
                                  type="checkbox"
                                  checked={outOfStockSelection.includes('MAIN_PRODUCT')}
                                  onChange={() => {
                                    setOutOfStockSelection((prev) =>
                                      prev.includes('MAIN_PRODUCT')
                                        ? prev.filter((i) => i !== 'MAIN_PRODUCT')
                                        : [...prev, 'MAIN_PRODUCT']
                                    );
                                  }}
                                />
                                <span>
                                  <strong>สินค้าหลัก:</strong>{' '}
                                  {selectedSession.selection.product.model}{' '}
                                  ({selectedSession.selection.product.sku})
                                </span>
                                {outOfStockSelection.includes('MAIN_PRODUCT') && (
                                  <span
                                    className="status-tag status-outcome"
                                    style={{ marginLeft: 'auto' }}
                                  >
                                    ไม่พบ / สินค้าหมด
                                  </span>
                                )}
                              </label>
                            </div>
                          )}

                          {Object.entries(selectedSession.selection.accessories).map(
                            ([name, qty]) => {
                              const isOos = outOfStockSelection.includes(name);
                              return (
                                <div
                                  key={name}
                                  className={`accessory-item ${
                                    isOos ? 'out-of-stock-item' : ''
                                  }`}
                                >
                                  <label
                                    style={{
                                      display: 'flex',
                                      alignItems: 'center',
                                      gap: '8px',
                                      cursor: 'pointer',
                                      margin: 0,
                                    }}
                                  >
                                    <input
                                      type="checkbox"
                                      checked={isOos}
                                      onChange={() => {
                                        setOutOfStockSelection((prev) =>
                                          prev.includes(name)
                                            ? prev.filter((i) => i !== name)
                                            : [...prev, name]
                                        );
                                      }}
                                    />
                                    <span>
                                      <strong>อุปกรณ์เสริม:</strong> {name} (จำนวน:{' '}
                                      {qty} ชิ้น)
                                    </span>
                                    {isOos && (
                                      <span
                                        className="status-tag status-outcome"
                                        style={{ marginLeft: 'auto' }}
                                      >
                                        ไม่พบ / สินค้าหมด
                                      </span>
                                    )}
                                  </label>
                                </div>
                              );
                            }
                          )}
                        </div>
                      </div>

                      <div className="out-of-stock-section">
                        <label>
                          หมายเหตุการค้นหา / สินค้าหมด (Note)
                          <input
                            placeholder="ระบุสาเหตุ เช่น ไม่พบในระบบ, มีการจองไว้แล้ว"
                            value={stockNote}
                            onChange={(e) => setStockNote(e.target.value)}
                          />
                        </label>
                      </div>

                      <div className="actions" style={{ marginTop: '16px' }}>
                        {outOfStockSelection.length === 0 ? (
                          <Button
                            onClick={() => handleAction(selectedSession, 'found')}
                          >
                            <span
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '6px',
                              }}
                            >
                              <Check size={16} />
                              พบสินค้าครบทั้งหมด (FOUND)
                            </span>
                          </Button>
                        ) : (
                          (selectedSession.selection.product ? 1 : 0) +
                            Object.keys(selectedSession.selection.accessories).length >
                          outOfStockSelection.length ? (
                            <>
                              <Button
                                onClick={() =>
                                  handlePartialFulfill(selectedSession)
                                }
                              >
                                <span
                                  style={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '6px',
                                  }}
                                >
                                  <Check size={16} />
                                  ลูกค้าซื้อต่อ (ตัด {outOfStockSelection.length}{' '}
                                  รายการที่ไม่มีออก)
                                </span>
                              </Button>
                              <Button
                                variant="danger"
                                onClick={() =>
                                  handleFullOutOfStock(selectedSession)
                                }
                              >
                                <span
                                  style={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '6px',
                                  }}
                                >
                                  <X size={16} />
                                  ลูกค้ายกเลิกทั้งหมด
                                </span>
                              </Button>
                            </>
                          ) : (
                            <Button
                              variant="danger"
                              onClick={() =>
                                handleFullOutOfStock(selectedSession)
                              }
                            >
                              <span
                                style={{
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: '6px',
                                }}
                              >
                                <X size={16} />
                                สินค้าหมดทุกรายการ (ยกเลิกคำขอ)
                              </span>
                            </Button>
                          )
                        )}
                        <Button
                          variant="secondary"
                          onClick={() => setCancellingSession(selectedSession)}
                        >
                          ลูกค้ายกเลิกขณะค้นหา
                        </Button>
                      </div>
                    </div>
                  )}

                  {selectedSession.state === 'FOUND' && (
                    <div className="actions">
                      <Button
                        onClick={() => handleAction(selectedSession, 'send')}
                      >
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                          <Send size={16} />
                          ส่งสินค้าไปที่แคชเชียร์ (SENT_TO_CASHIER)
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
                </div>

                <details className="panel" style={{ marginTop: '1rem' }}>
                  <summary>
                    ดูรายละเอียดการชำระเงินและสิทธิประโยชน์ทั้งหมด
                  </summary>
                  <Summary session={selectedSession} />
                </details>
              </Panel>
            ) : (
              <Panel title="กรุณาเลือกรายการคำขอ" eyebrow="STOCK SELECTION">
                <p className="muted">
                  เลือกรายการจากคิวทางด้านซ้ายเพื่อดูรายละเอียดและดำเนินการ
                </p>
              </Panel>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
