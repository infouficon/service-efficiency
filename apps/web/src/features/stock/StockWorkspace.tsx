import { useState, useEffect } from 'react';
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
  AlertCircle,
} from 'lucide-react';
import { Button, Notice, Panel } from '../../components/ui';
import { Summary } from '../session/Summary';
import { ReasonForm } from '../session/ReasonForm';
import { cancelReasons } from '../../constants/options';
import type { MockSession, MockUser } from '../../types/session';
import {
  acknowledgeStockCancelApi,
  advanceStepApi,
  cancelSessionApi,
  recordOutOfStockApi,
  reportStockMissingApi,
} from '../../services/sessionApi';
import {
  advance,
  cashierRejectNotice,
  goodsToReturn,
  isToday,
  itemChangeNotice,
  itemLabel,
  itemName,
  itemsText,
  needsStockAck,
  partialFulfillStock,
} from '../session/workflow';

const previewTime = () => new Date().toISOString();

function getWrongItemBadgeText(
  reject: ReturnType<typeof cashierRejectNotice>,
  itemId: string,
  itemText?: string,
): string | null {
  if (!reject) return null;
  const isIdWrong = Boolean(reject.wrongItemIds?.includes(itemId));
  const isNameWrong = Boolean(
    itemText &&
      (reject.wrongItems?.includes(itemText) ||
        reject.wrongItems?.some((w) => w.startsWith(itemText))),
  );
  if (!isIdWrong && !isNameWrong) return null;

  const detail = reject.wrongItemDetails?.[itemId];
  if (detail) {
    if (detail.reason === 'อื่น ๆ' && detail.note) {
      return `⚠️ อื่น ๆ: ${detail.note}`;
    }
    return `⚠️ ${detail.reason}`;
  }
  return '⚠️ แคชเชียร์แจ้งมีปัญหา';
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
  const [cancellingSession, setCancellingSession] =
    useState<MockSession | null>(null);
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');

  /** F12: stock confirms it has seen a cancel and brought the goods back; stored on the session, so every device sees it. */
  const handleAcknowledgeCancel = async (session: MockSession) => {
    if (!session.id) return;
    setError('');
    try {
      onUpdateSession(await acknowledgeStockCancelApi(session.id));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'ยืนยันไม่สำเร็จ');
    }
  };

  // Filter sessions by branch and today only (D47)
  const branchSessions = sessions.filter((s) => {
    const isTargetBranch = user.roles.includes('ADMIN') || s.branchCode === (user.branchCode ?? '');
    const isTodaySession = isToday(s.timestamps.customer_walk_in_at);
    return isTargetBranch && isTodaySession;
  });

  // D73: sessions sent back to staff (stockPendingReview) are excluded from the stock queue
  const stockQueue = branchSessions.filter(
    (s) =>
      !s.outcome &&
      !s.stockPendingReview &&
      ['STOCK_REQUESTED', 'SEARCHING', 'FOUND'].includes(s.state),
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

  const lastRejectTimestamp =
    [...(selectedSession?.events ?? [])].reverse().find(
      (e) => e.eventType === 'CASHIER_REJECTED',
    )?.createdAt ?? null;

  const lastItemChangeTimestamp =
    [...(selectedSession?.events ?? [])].reverse().find(
      (e) => e.eventType === 'ITEM_CHANGED',
    )?.createdAt ?? null;

  useEffect(() => {
    if (!selectedSession) {
      setFoundSelection([]);
      setStockNote('');
      return;
    }
    if (selectedSession.stockPendingReview) {
      setStockNote(selectedSession.stockPendingReview.stockNote || '');
    } else {
      setStockNote('');
    }

    const itemChange = itemChangeNotice(selectedSession);
    const reject = cashierRejectNotice(selectedSession);

    if (itemChange) {
      // D78: Pre-select items that were not changed so Stock only needs to find the newly replaced item
      const preSelected: string[] = [];
      for (const item of selectedSession.selection.items) {
        const itemId = item.id ?? item.product.id;
        const isNewItem =
          item.product.id === itemChange.newSkuId ||
          item.product.sku === itemChange.newSku;
        if (!isNewItem) {
          preSelected.push(itemId);
        }
      }
      Object.entries(selectedSession.selection.accessories).forEach(([name]) => {
        preSelected.push(name);
      });
      setFoundSelection(preSelected);
    } else if (reject && (reject.wrongItemIds?.length || reject.wrongItems?.length)) {
      const wrongIds = new Set(reject.wrongItemIds ?? []);
      const wrongNames = new Set(reject.wrongItems ?? []);
      const preSelected: string[] = [];

      for (const item of selectedSession.selection.items) {
        const itemId = item.id ?? item.product.id;
        const label = itemLabel(item);
        const isWrong =
          wrongIds.has(itemId) ||
          wrongNames.has(label) ||
          [...wrongNames].some((w) => w.startsWith(label));
        if (!isWrong) {
          preSelected.push(itemId);
        }
      }

      Object.entries(selectedSession.selection.accessories).forEach(
        ([name, qty]) => {
          const label = `${name} (x${qty})`;
          const isWrong =
            wrongIds.has(name) ||
            wrongNames.has(label) ||
            wrongNames.has(name) ||
            [...wrongNames].some((w) => w.startsWith(label) || w.startsWith(name));
          if (!isWrong) {
            preSelected.push(name);
          }
        },
      );

      setFoundSelection(preSelected);
    } else {
      setFoundSelection([]);
    }
  }, [selectedSession?.id, selectedSession?.state, lastRejectTimestamp, lastItemChangeTimestamp]);

  // F12: every cancel after the stock request that stock has not acknowledged, whatever day it was (not only today)
  const cancelledAlertSessions = sessions.filter(
    (s) =>
      needsStockAck(s) &&
      (user.roles.includes('ADMIN') || s.branchCode === (user.branchCode ?? '')),
  );

  const handleSelectCard = (reference: string) => {
    setSelectedRef(reference);
    setMobileShowDetail(true);
    setError('');
    setSuccessMessage('');
  };

  const handleAction = async (
    session: MockSession,
    action: 'search' | 'found' | 'send',
  ) => {
    setError('');
    setSuccessMessage('');
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
      setSelectedRef(null);
      setMobileShowDetail(false);
      setFoundSelection([]);
      setStockNote('');
      setSuccessMessage(
        `ส่งเรื่องให้ Staff เรียบร้อยแล้ว (คิว ${session.queue || session.reference} ถูกส่งกลับไปให้ Staff ดำเนินการต่อ)`,
      );
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

      {successMessage && (
        <div style={{ marginBottom: '1rem' }}>
          <Notice>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                width: '100%',
                gap: '8px',
              }}
            >
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  color: '#0d8a72',
                  fontWeight: 600,
                }}
              >
                <CheckCircle2 size={18} color="#0abab5" />
                {successMessage}
              </span>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => setSuccessMessage('')}
              >
                ปิด
              </Button>
            </div>
          </Notice>
        </div>
      )}

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
        <div className="stock-cancel-notices" role="alert">
          {cancelledAlertSessions.map((cs) => (
            <div key={cs.reference} className="stock-cancel-notice">
              <div className="stock-cancel-notice-body">
                <strong className="stock-cancel-notice-title">
                  <AlertTriangle size={20} />
                  คิว {cs.queue} ถูกยกเลิก
                  {goodsToReturn(cs) ? ' — ต้องคืนสินค้าเข้าชั้น' : ' — หยุดค้นหา'}
                </strong>
                <span>
                  {itemsText(cs.selection.items) || 'สินค้า'} · ยกเลิกโดย{' '}
                  <strong>{cs.cancelledBy || cs.staffId}</strong> · เหตุผล:{' '}
                  <em>{cs.reason || cs.otherReason || '—'}</em>
                </span>
              </div>
              <Button onClick={() => handleAcknowledgeCancel(cs)}>
                {goodsToReturn(cs) ? 'คืนของเข้าชั้นแล้ว' : 'รับทราบ'}
              </Button>
            </div>
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
                      <span className="card-ref">{s.queue}</span>
                      {itemChangeNotice(s) ? (
                        <span
                          className="status-tag"
                          style={{
                            background: '#fef3c7',
                            color: '#b45309',
                            border: '1px solid #fde68a',
                            fontWeight: 700,
                          }}
                        >
                          เปลี่ยนสินค้า
                        </span>
                      ) : cashierRejectNotice(s) ? (
                        <span
                          className="status-tag status-outcome"
                          style={{ background: '#fef2f2', color: '#b91c1c', border: '1px solid #fecaca' }}
                        >
                          Cashier ส่งกลับ
                        </span>
                      ) : s.stockPendingReview ? (
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
                  {itemChangeNotice(selectedSession) && (() => {
                    const notice = itemChangeNotice(selectedSession);
                    if (!notice) return null;
                    return (
                      <div
                        style={{
                          padding: '12px 16px',
                          borderRadius: '10px',
                          background: '#fffbeb',
                          border: '1.5px solid #f59e0b',
                          color: '#92400e',
                          fontSize: '14px',
                          marginBottom: '16px',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '6px',
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 700, fontSize: '15px' }}>
                          <AlertTriangle size={18} style={{ color: '#d97706' }} />
                          <span>
                            มีการเปลี่ยนสินค้าในคิวนี้ (เปลี่ยนโดย {notice.changedByRole === 'CASHIER' ? 'แคชเชียร์' : 'พนักงานขาย'}: {notice.actorStaffId})
                          </span>
                        </div>
                        <div style={{ fontSize: '13px' }}>
                          <strong>เหตุผล:</strong> {notice.reason} {notice.note ? `(${notice.note})` : ''}
                        </div>
                        <div style={{ fontSize: '13px', background: '#fef3c7', padding: '8px 12px', borderRadius: '6px' }}>
                          <div>
                            <span style={{ color: '#b91c1c', fontWeight: 600 }}>❌ สินค้าเดิม:</span> {notice.oldName} ({notice.oldSku})
                          </div>
                          <div style={{ marginTop: '2px' }}>
                            <span style={{ color: '#15803d', fontWeight: 600 }}>✅ สินค้าใหม่ที่ต้องหยิบ:</span> {notice.newName} ({notice.newSku})
                          </div>
                        </div>
                        {notice.hadPickedOldItem && (
                          <div style={{ fontSize: '13px', color: '#b91c1c', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '6px', marginTop: '2px' }}>
                            <AlertCircle size={15} />
                            ⚠️ สินค้าเดิมเคยถูกหยิบไปแล้ว กรุณานำเครื่องเดิมคืนชั้นวางสินค้าในคลัง
                          </div>
                        )}
                      </div>
                    );
                  })()}
                  {cashierRejectNotice(selectedSession) && (() => {
                    const reject = cashierRejectNotice(selectedSession);
                    const wrongList =
                      reject?.wrongItems && reject.wrongItems.length > 0
                        ? reject.wrongItems
                        : null;
                    return (
                      <Notice error>
                        <div
                          style={{
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '4px',
                          }}
                        >
                          <span
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '6px',
                              fontWeight: 700,
                            }}
                          >
                            <AlertTriangle size={16} />
                            Cashier ส่งกลับ: {reject?.reason} — ค้นหา/หยิบสินค้าใหม่ให้ถูกต้อง
                          </span>
                          {wrongList && (
                            <div style={{ fontSize: '13px', marginTop: '2px' }}>
                              <strong>สินค้าที่แคชเชียร์แจ้งมีปัญหา:</strong>{' '}
                              <span style={{ color: '#b91c1c', fontWeight: 600 }}>
                                {wrongList.join(', ')}
                              </span>
                            </div>
                          )}
                        </div>
                      </Notice>
                    );
                  })()}
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
                  {selectedSession.selection.items.map((item) => {
                    const itemId = item.id ?? item.product.id;
                    const reject = cashierRejectNotice(selectedSession);
                    const itemChange = itemChangeNotice(selectedSession);
                    const isNewSwappedItem = Boolean(
                      itemChange &&
                        (item.product.id === itemChange.newSkuId ||
                          item.product.sku === itemChange.newSku),
                    );
                    const wrongBadge = getWrongItemBadgeText(
                      reject,
                      itemId,
                      itemLabel(item),
                    );
                    const isWrong = Boolean(wrongBadge);
                    return (
                      <div
                        className="product-highlight-box"
                        key={item.id ?? item.product.id}
                        style={
                          isWrong
                            ? {
                                borderColor: '#ef4444',
                                backgroundColor: '#fff5f5',
                              }
                            : isNewSwappedItem
                              ? {
                                  borderColor: '#10b981',
                                  backgroundColor: '#f0fdf4',
                                }
                              : undefined
                        }
                      >
                        <div className="product-title">
                          {itemName(item)}{' '}
                          <span className="qty-badge">× {item.quantity}</span>
                          {isNewSwappedItem && (
                            <span
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '4px',
                                backgroundColor: '#ecfdf5',
                                color: '#047857',
                                border: '1px solid #a7f3d0',
                                borderRadius: '4px',
                                padding: '2px 6px',
                                fontSize: '11px',
                                fontWeight: 600,
                                marginLeft: '8px',
                              }}
                            >
                              ✨ สินค้าใหม่ที่เปลี่ยน (ต้องหยิบ)
                            </span>
                          )}
                          {wrongBadge && (
                            <span
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '4px',
                                backgroundColor: '#fef2f2',
                                color: '#b91c1c',
                                border: '1px solid #fecaca',
                                borderRadius: '4px',
                                padding: '2px 6px',
                                fontSize: '11px',
                                fontWeight: 600,
                                marginLeft: '8px',
                              }}
                            >
                              {wrongBadge}
                            </span>
                          )}
                        </div>
                        <div className="product-sku">
                          SKU: <strong>{item.product.sku}</strong>
                        </div>
                        <div className="product-cat">
                          หมวดหมู่: {item.product.category}
                        </div>
                      </div>
                    );
                  })}

                  {Object.keys(selectedSession.selection.accessories).length >
                    0 && (
                    <div className="accessories-list-box">
                      <h4>อุปกรณ์เสริมที่ต้องจัดคู่กัน:</h4>
                      <ul>
                        {Object.entries(
                          selectedSession.selection.accessories,
                        ).map(([name, qty]) => {
                          const accLabel = `${name} (x${qty})`;
                          const reject = cashierRejectNotice(selectedSession);
                          const wrongBadge =
                            getWrongItemBadgeText(reject, name, accLabel) ||
                            getWrongItemBadgeText(reject, name, name);
                          const isWrong = Boolean(wrongBadge);
                          return (
                            <li
                              key={name}
                              style={isWrong ? { color: '#b91c1c' } : undefined}
                            >
                              <strong>{name}</strong> — จำนวน:{' '}
                              <span className="qty-badge">{qty}</span> ชิ้น
                              {wrongBadge && (
                                <span
                                  style={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '4px',
                                    backgroundColor: '#fef2f2',
                                    color: '#b91c1c',
                                    border: '1px solid #fecaca',
                                    borderRadius: '4px',
                                    padding: '2px 6px',
                                    fontSize: '11px',
                                    fontWeight: 600,
                                    marginLeft: '8px',
                                  }}
                                >
                                  {wrongBadge}
                                </span>
                              )}
                            </li>
                          );
                        })}
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
                              const reject = cashierRejectNotice(selectedSession);
                              const itemChange = itemChangeNotice(selectedSession);
                              const isNewSwappedItem = Boolean(
                                itemChange &&
                                  (item.product.id === itemChange.newSkuId ||
                                    item.product.sku === itemChange.newSku),
                              );
                              const wrongBadge = getWrongItemBadgeText(
                                reject,
                                itemId,
                                itemLabel(item),
                              );
                              const isWrong = Boolean(wrongBadge);
                              return (
                                <div
                                  key={itemId}
                                  className={`accessory-item ${
                                    isFound ? '' : 'out-of-stock-item'
                                  }`}
                                  style={
                                    isWrong && !isFound
                                      ? {
                                          borderColor: '#ef4444',
                                          backgroundColor: '#fff5f5',
                                        }
                                      : isNewSwappedItem && !isFound
                                        ? {
                                            borderColor: '#10b981',
                                            backgroundColor: '#f0fdf4',
                                          }
                                        : undefined
                                  }
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
                                    {isNewSwappedItem && (
                                      <span
                                        style={{
                                          display: 'inline-flex',
                                          alignItems: 'center',
                                          gap: '4px',
                                          backgroundColor: '#ecfdf5',
                                          color: '#047857',
                                          border: '1px solid #a7f3d0',
                                          borderRadius: '4px',
                                          padding: '2px 6px',
                                          fontSize: '11px',
                                          fontWeight: 600,
                                        }}
                                      >
                                        ✨ ชิ้นใหม่ที่ต้องหยิบ
                                      </span>
                                    )}
                                    {wrongBadge && (
                                      <span
                                        style={{
                                          display: 'inline-flex',
                                          alignItems: 'center',
                                          gap: '4px',
                                          backgroundColor: '#fef2f2',
                                          color: '#b91c1c',
                                          border: '1px solid #fecaca',
                                          borderRadius: '4px',
                                          padding: '2px 6px',
                                          fontSize: '11px',
                                          fontWeight: 600,
                                        }}
                                      >
                                        {wrongBadge}
                                      </span>
                                    )}
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
                                const accLabel = `${name} (x${qty})`;
                                const reject = cashierRejectNotice(selectedSession);
                                const wrongBadge =
                                  getWrongItemBadgeText(reject, name, accLabel) ||
                                  getWrongItemBadgeText(reject, name, name);
                                const isWrong = Boolean(wrongBadge);
                                return (
                                  <div
                                    key={name}
                                    className={`accessory-item ${
                                      isFound ? '' : 'out-of-stock-item'
                                    }`}
                                    style={
                                      isWrong && !isFound
                                        ? {
                                            borderColor: '#ef4444',
                                            backgroundColor: '#fff5f5',
                                          }
                                        : undefined
                                    }
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
                                      {wrongBadge && (
                                        <span
                                          style={{
                                            display: 'inline-flex',
                                            alignItems: 'center',
                                            gap: '4px',
                                            backgroundColor: '#fef2f2',
                                            color: '#b91c1c',
                                            border: '1px solid #fecaca',
                                            borderRadius: '4px',
                                            padding: '2px 6px',
                                            fontSize: '11px',
                                            fontWeight: 600,
                                          }}
                                        >
                                          {wrongBadge}
                                        </span>
                                      )}
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
