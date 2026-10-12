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
  ArrowLeft,
  AlertTriangle,
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
  reportStockMissingApi,
} from '../../services/sessionApi';
import {
  advance,
  isToday,
  itemLabel,
  itemName,
  itemsText,
  partialFulfillStock,
} from '../session/workflow';

const previewTime = () => new Date().toISOString();

const DISMISSED_CANCELS_STORAGE_KEY = 'service_efficiency_stock_dismissed_cancels';

function getStoredDismissedCancels(): string[] {
  try {
    const raw = localStorage.getItem(DISMISSED_CANCELS_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch {
    // ignore
  }
  return [];
}

function storeDismissedCancel(reference: string) {
  try {
    const current = getStoredDismissedCancels();
    if (!current.includes(reference)) {
      const updated = [...current, reference];
      localStorage.setItem(DISMISSED_CANCELS_STORAGE_KEY, JSON.stringify(updated));
    }
  } catch {
    // ignore
  }
}

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
  const [mobileShowDetail, setMobileShowDetail] = useState(false);
  const [stockNote, setStockNote] = useState('');
  const [foundSelection, setFoundSelection] = useState<string[]>([]);
  const [dismissedCancels, setDismissedCancels] = useState<string[]>(() =>
    getStoredDismissedCancels(),
  );
  const [cancellingSession, setCancellingSession] =
    useState<MockSession | null>(null);
  const [error, setError] = useState('');

  const handleDismissCancel = (reference: string) => {
    storeDismissedCancel(reference);
    setDismissedCancels((prev) => [...prev, reference]);
  };

  // Filter sessions by branch and today only (D47)
  const branchSessions = sessions.filter((s) => {
    const isTargetBranch = user.roles.includes('ADMIN') || s.branchCode === (user.branchCode ?? '');
    const isTodaySession = isToday(s.timestamps.customer_walk_in_at);
    return isTargetBranch && isTodaySession;
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

  // On desktop: auto-select first item. On mobile: only show detail when explicitly chosen.
  const selectedSession =
    stockQueue.find((s) => s.reference === selectedRef) ||
    (mobileShowDetail ? null : filteredQueue[0]) ||
    null;

  const cancelledAlertSessions = branchSessions.filter(
    (s) =>
      s.outcome === 'CUSTOMER_CANCELLED' &&
      !dismissedCancels.includes(s.reference) &&
      (Boolean(s.timestamps.product_selection_confirmed_at) ||
        Boolean(s.timestamps.stock_started_at) ||
        Boolean(s.stockPendingReview) ||
        Boolean(s.cancelledBy)),
  );

  const handleSelectCard = (reference: string) => {
    setSelectedRef(reference);
    setMobileShowDetail(true);
    setError('');
    const target = stockQueue.find((s) => s.reference === reference);
    if (target?.stockPendingReview) {
      setStockNote(target.stockPendingReview.stockNote || '');
    } else {
      setStockNote('');
      setFoundSelection([]);
    }
  };

  const handleAction = async (
    session: MockSession,
    action: 'search' | 'found' | 'send',
  ) => {
    setError('');
    if (session.id) {
      try {
        const updated = await advanceStepApi(session.id, action);
        onUpdateSession(updated);
        setFoundSelection([]);
        setStockNote('');
        return;
      } catch (err: unknown) {
        console.error('Failed to advance stock step:', err);
        const msg = err instanceof Error ? err.message : 'ดำเนินการไม่สำเร็จ';
        setError(msg);
        return;
      }
    }
    const updated = advance(session, action, previewTime());
    onUpdateSession({
      ...updated,
      stockPendingReview: undefined,
    });
    setFoundSelection([]);
    setStockNote('');
  };

  /** F3: STOCK ticks what it found, item by item; the unticked main products are reported by id, accessories by name. */
  const handleSendToStaff = async (session: MockSession) => {
    setError('');
    if (!session.id) return;
    const missingItems: string[] = [];
    const missingItemIds: string[] = [];
    const foundNames: string[] = [];

    for (const item of session.selection.items) {
      if (item.id && foundSelection.includes(item.id)) {
        foundNames.push(itemLabel(item));
      } else {
        missingItems.push(itemLabel(item));
        if (item.id) missingItemIds.push(item.id);
      }
    }

    Object.entries(session.selection.accessories).forEach(([acc, qty]) => {
      if (foundSelection.includes(acc)) {
        foundNames.push(`${acc} (x${qty})`);
      } else {
        missingItems.push(`${acc} (x${qty})`);
      }
    });

    if (missingItems.length === 0) {
      setError('กรุณาระบุสินค้าที่ขาด/หมดอย่างน้อย 1 รายการ');
      return;
    }

    try {
      const updated = await reportStockMissingApi(
        session.id,
        missingItems,
        foundNames,
        stockNote || undefined,
        missingItemIds,
      );
      onUpdateSession(updated);
    } catch (err: unknown) {
      console.error('Failed to report missing stock:', err);
      setError(err instanceof Error ? err.message : 'ไม่สามารถแจ้งสินค้าไม่ครบได้');
    }
  };

  const handleCancel = async (reason: string, text: string) => {
    if (!cancellingSession) return;
    setError('');
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
      } catch (err: unknown) {
        console.error('Failed to cancel session:', err);
        const msg = err instanceof Error ? err.message : 'ยกเลิกรายการไม่สำเร็จ';
        setError(msg);
        setCancellingSession(null);
        return;
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
            <h2 style={{ margin: 0 }}>คลังสินค้า</h2>
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

      {error && (
        <div style={{ marginBottom: '1rem' }}>
          <Notice error>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                width: '100%',
                gap: '8px',
              }}
            >
              <span>{error}</span>
              <Button size="sm" variant="secondary" onClick={() => setError('')}>
                ปิด
              </Button>
            </div>
          </Notice>
        </div>
      )}

      {cancelledAlertSessions.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '1.25rem' }}>
          {cancelledAlertSessions.map((cs) => (
            <Notice key={cs.reference} error>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  width: '100%',
                  flexWrap: 'wrap',
                  gap: '8px',
                }}
              >
                <span>
                  <strong>⚠️ แจ้งเตือนฝ่ายคลัง:</strong> คิว <strong>{cs.queue}</strong> (
                  {itemsText(cs.selection.items) || 'สินค้า'}) ถูกยกเลิกโดย Staff <strong>{cs.cancelledBy || cs.staffId || 'Staff'}</strong> — สาเหตุ:{' '}
                  <em>{cs.reason || cs.otherReason || 'ลูกค้าเปลี่ยนใจ'}</em>
                </span>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => handleDismissCancel(cs.reference)}
                >
                  รับทราบ
                </Button>
              </div>
            </Notice>
          ))}
        </div>
      )}

      {cancellingSession ? (
        <Panel
          title="ยกเลิกคำขอบริการ"
          eyebrow="STOCK CANCELLATION"
        >
          <p>
            ยกเลิกคำขอสำหรับคิว{' '}
            <strong>{cancellingSession.queue}</strong> (
            {itemsText(cancellingSession.selection.items)})
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
          className="stock-layout"
          data-mobile-detail={mobileShowDetail ? 'true' : 'false'}
        >
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
                    onClick={() => handleSelectCard(s.reference)}
                  >
                    <div className="card-top">
                      <span className="card-ref">คิว {s.queue}</span>
                      {s.stockPendingReview ? (
                        <span
                          className="status-tag status-searching"
                          style={{
                            background: '#fef3c7',
                            color: '#b45309',
                            border: '1px solid #fde68a',
                          }}
                        >
                          รอลูกค้าตัดสินใจ
                        </span>
                      ) : (
                        <span
                          className={`status-tag status-${s.state.toLowerCase()}`}
                        >
                          {s.state === 'STOCK_REQUESTED' && 'รอค้นหา'}
                          {s.state === 'SEARCHING' && 'กำลังค้นหา'}
                          {s.state === 'FOUND' && 'พบสินค้าแล้ว'}
                        </span>
                      )}
                    </div>
                    <div className="card-product">
                      <strong>{itemsText(s.selection.items)}</strong>
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
                title={`รายละเอียดคำขอ: คิว ${selectedSession.queue}`}
                eyebrow={`สถานะปัจจุบัน: ${selectedSession.state}`}
              >
                <button
                  type="button"
                  className="mobile-back-to-queue-btn"
                  onClick={() => setMobileShowDetail(false)}
                >
                  <ArrowLeft size={14} /> คิวสินค้า ({filteredQueue.length})
                </button>
                <div className="detail-status-banner">
                  {selectedSession.stockPendingReview && (
                    <Notice error>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 700 }}>
                          <AlertTriangle size={16} />
                          ส่งเรื่องให้ Staff ({selectedSession.staffId}) แล้ว — รอลูกค้าตัดสินใจ
                        </div>
                        <div>
                          <strong>รายการที่ขาด/หมด:</strong>{' '}
                          {selectedSession.stockPendingReview.missingItems.join(', ')}
                        </div>
                        {selectedSession.stockPendingReview.stockNote && (
                          <div>
                            <strong>หมายเหตุ:</strong>{' '}
                            {selectedSession.stockPendingReview.stockNote}
                          </div>
                        )}
                        <p style={{ margin: '4px 0 0', fontSize: '12px' }}>
                          กำลังรอลูกค้าตัดสินใจและแจ้งผ่าน Staff ({selectedSession.staffId}) ว่าจะซื้อเฉพาะที่เหลือ, เปลี่ยน/เพิ่มสินค้าอื่น หรือขอยกเลิกคำขอนี้
                        </p>
                      </div>
                    </Notice>
                  )}
                  {!selectedSession.stockPendingReview && selectedSession.state === 'STOCK_REQUESTED' && (
                    <Notice>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                        <Clock size={16} />
                        ได้รับคำขอยืนยันจากหน้าร้านแล้ว (กดปุ่ม "เริ่มค้นหา" เมื่อเริ่มเดินไปหยิบสินค้า)
                      </span>
                    </Notice>
                  )}
                  {!selectedSession.stockPendingReview && selectedSession.state === 'SEARCHING' && (
                    <Notice>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                        <Search size={16} />
                        กำลังค้นหาสินค้าในคลัง (ติ๊กเลือกเฉพาะสินค้าที่พบจริง)
                      </span>
                    </Notice>
                  )}
                  {!selectedSession.stockPendingReview && selectedSession.state === 'FOUND' && (
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
                  {selectedSession.selection.items.map((item) => (
                    <div className="product-highlight-box" key={item.id ?? item.product.id}>
                      <div className="product-title">
                        {itemName(item)}{' '}
                        <span className="qty-badge">× {item.quantity}</span>
                      </div>
                      <div className="product-sku">
                        SKU: <strong>{item.product.sku}</strong>
                      </div>
                      <div className="product-cat">
                        หมวดหมู่: {item.product.category}
                      </div>
                    </div>
                  ))}

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
                    <h3 style={{ margin: 0 }}>การดำเนินการ</h3>
                  </div>
                  {selectedSession.state === 'STOCK_REQUESTED' && (
                    <div className="actions">
                      <Button
                        onClick={() => handleAction(selectedSession, 'search')}
                      >
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                          <Search size={16} />
                          เริ่มค้นหาสินค้า
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

                  {selectedSession.state === 'SEARCHING' && (() => {
                    const items = selectedSession.selection.items;
                    const totalCount =
                      items.length +
                      Object.keys(selectedSession.selection.accessories).length;
                    const foundCount =
                      items.filter((item) => item.id && foundSelection.includes(item.id))
                        .length +
                      Object.keys(selectedSession.selection.accessories).filter((a) =>
                        foundSelection.includes(a),
                      ).length;
                    const isAllFound = totalCount > 0 && foundCount === totalCount;

                    return (
                      <div className="searching-action-box">
                        <div style={{ marginBottom: '16px' }}>
                          <h4 style={{ margin: '0 0 4px', fontSize: '13px', color: '#496357' }}>
                            เลือกรายการสินค้าที่ <strong>"พบแล้ว"</strong> (ชิ้นที่ไม่ได้ติ๊ก จะถือว่าไม่พบ/ของขาด):
                          </h4>
                          <p style={{ margin: '0 0 8px', fontSize: '12px', color: '#6b7280' }}>
                            * ติ๊กเครื่องหมายถูกเฉพาะชิ้นที่หยิบพบจริงในคลัง ชิ้นที่ไม่ได้ติ๊กจะถูกส่งเรื่องให้ Staff ดำเนินการ
                          </p>
                          <div className="accessory-list">
                            {items.map((item) => {
                              const itemId = item.id ?? item.product.id;
                              const isFound = foundSelection.includes(itemId);
                              return (
                                <div
                                  key={itemId}
                                  className={`accessory-item ${
                                    isFound ? '' : 'out-of-stock-item'
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
                                      checked={isFound}
                                      onChange={() => {
                                        setFoundSelection((prev) =>
                                          prev.includes(itemId)
                                            ? prev.filter((i) => i !== itemId)
                                            : [...prev, itemId],
                                        );
                                      }}
                                    />
                                    <span>
                                      <strong>สินค้าหลัก:</strong> {itemName(item)} (
                                      {item.product.sku}) จำนวน {item.quantity} ชิ้น
                                    </span>
                                    {isFound ? (
                                      <span
                                        className="status-tag status-found"
                                        style={{ marginLeft: 'auto' }}
                                      >
                                        พบแล้ว
                                      </span>
                                    ) : (
                                      <span
                                        className="status-tag status-searching"
                                        style={{ marginLeft: 'auto' }}
                                      >
                                        ยังไม่พบ
                                      </span>
                                    )}
                                  </label>
                                </div>
                              );
                            })}

                            {Object.entries(selectedSession.selection.accessories).map(
                              ([name, qty]) => {
                                const isFound = foundSelection.includes(name);
                                return (
                                  <div
                                    key={name}
                                    className={`accessory-item ${
                                      isFound ? '' : 'out-of-stock-item'
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
                                        checked={isFound}
                                        onChange={() => {
                                          setFoundSelection((prev) =>
                                            prev.includes(name)
                                              ? prev.filter((i) => i !== name)
                                              : [...prev, name],
                                          );
                                        }}
                                      />
                                      <span>
                                        <strong>อุปกรณ์เสริม:</strong> {name} (จำนวน:{' '}
                                        {qty} ชิ้น)
                                      </span>
                                      {isFound ? (
                                        <span
                                          className="status-tag status-found"
                                          style={{ marginLeft: 'auto' }}
                                        >
                                          พบแล้ว
                                        </span>
                                      ) : (
                                        <span
                                          className="status-tag status-searching"
                                          style={{ marginLeft: 'auto' }}
                                        >
                                          ยังไม่พบ
                                        </span>
                                      )}
                                    </label>
                                  </div>
                                );
                              },
                            )}
                          </div>
                        </div>

                        <div className={`stock-note-section ${isAllFound ? '' : 'has-missing'}`}>
                          <label>
                            {isAllFound
                              ? 'หมายเหตุเพิ่มเติม (ถ้ามี)'
                              : 'หมายเหตุการค้นหา / รายละเอียดสินค้าที่ไม่พบ (Note)'}
                            <input
                              placeholder={
                                isAllFound
                                  ? 'ระบุหมายเหตุเพิ่มเติม (ถ้ามี)'
                                  : 'ระบุสาเหตุ เช่น สินค้าหมดสต็อก, ชำรุด, รอเติมของ'
                              }
                              value={stockNote}
                              onChange={(e) => setStockNote(e.target.value)}
                            />
                          </label>
                        </div>

                        <div className="actions" style={{ marginTop: '16px' }}>
                          {isAllFound ? (
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
                                พบสินค้าครบทั้งหมด ({foundCount}/{totalCount}) → บันทึก FOUND
                              </span>
                            </Button>
                          ) : (
                            <Button
                              variant="secondary"
                              onClick={() => handleSendToStaff(selectedSession)}
                            >
                              <span
                                style={{
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: '6px',
                                  color: '#b45309',
                                  fontWeight: 600,
                                }}
                              >
                                <AlertTriangle size={16} />
                                แจ้งสินค้าไม่ครบ/หมด ({foundCount}/{totalCount}) → ส่งเรื่องให้ Staff
                              </span>
                            </Button>
                          )}
                          <Button
                            variant="danger"
                            onClick={() => setCancellingSession(selectedSession)}
                          >
                            ลูกค้ายกเลิก
                          </Button>
                        </div>
                      </div>
                    );
                  })()}

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
