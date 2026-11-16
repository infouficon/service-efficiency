import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import {
  User as UserIcon,
  Plus,
  ClipboardList,
  Check,
  X,
  Package,
  CreditCard,
  ArrowLeft,
  AlertTriangle,
  Plane,
  ReceiptText,
  RefreshCw,
  ArrowRight,
} from 'lucide-react';
import { Button, Notice, Panel } from '../../components/ui';
import { PhoneInput } from '../../components/PhoneInput';
import { formatDisplayPhone } from '../../utils/phone';
import {
  cancelReasons,
  changeReasons,
  customerAppleCategories,
  notBuyReasons,
  stages,
} from '../../constants/options';
import type {
  MockSession,
  MockUser,
  Selection,
  SurveyResponseItem,
  SurveyTarget,
} from '../../types/session';
import {
  SelectionEditor,
  CategoryPicture,
  StockBadge,
} from './SelectionEditor';
import { Summary } from './Summary';
import { ReasonForm } from './ReasonForm';
import { ReturnToStockForm } from './ReturnToStockForm';
import { WalkInForm } from './WalkInForm';
import { ChangeItemModal } from './ChangeItemModal';
import { SessionSurveyModal } from './SessionSurveyModal';
import { ReceiptSheet, nowText } from './Receipt';
import { isOutOfStock, toProduct, type Picked } from './catalog';
import {
  advance,
  confirmSelection,
  itemName,
  itemsText,
  phoneIsValid,
  progressIndex,
  receiptTypeBadgeLabel,
  receiptTypeLabel,
  stateLabel,
  type StepAction,
} from './workflow';
import {
  advanceStepApi,
  cancelSessionApi,
  changeSessionItemApi,
  confirmPurchaseApi,
  createWalkInApi,
  fetchCustomerHistoryApi,
  rebuyApi,
  recordNotBuyApi,
  resolveStockReviewApi,
  returnToStockApi,
  updateSelectionApi,
} from '../../services/sessionApi';

const previewTime = () => new Date().toISOString();

/** F11: cancelled for a change (model, colour, capacity, wrong product) and not bought again yet. The server checks it too. */
const canRebuy = (s: MockSession) =>
  s.outcome === 'CUSTOMER_CANCELLED' &&
  (changeReasons as readonly string[]).includes(s.reason ?? '') &&
  !s.rebuiltAs;

interface StaffWorkspaceProps {
  user: MockUser;
  sessions: MockSession[];
  onAddSession: (session: MockSession) => void;
  onUpdateSession: (session: MockSession) => void;
}

type FormView = 'normal' | 'notBuy' | 'review' | 'cancel' | 'return';

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
  const [phoneAttempted, setPhoneAttempted] = useState<Record<string, boolean>>(
    {},
  );
  const [selectedAppleDevices, setSelectedAppleDevices] = useState<string[]>(
    [],
  );
  const [hasAutoLoadedHistory, setHasAutoLoadedHistory] = useState(false);
  const [form, setForm] = useState<FormView>('normal');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [printSession, setPrintSession] = useState<MockSession | null>(null);
  const [changingItemSession, setChangingItemSession] =
    useState<MockSession | null>(null);
  const [walkInStep, setWalkInStep] = useState<'product' | 'phone'>('product');
  const [surveyModal, setSurveyModal] = useState<{
    session: MockSession;
    target: SurveyTarget;
  } | null>(null);

  // Filter staff's branch sessions for today
  const branchSessions = sessions.filter((s) => {
    const matchesBranch =
      user.roles.includes('ADMIN') || s.branchCode === (user.branchCode ?? '');
    return matchesBranch && isTodaySession(s);
  });

  const activeSession =
    branchSessions.find((s) => s.reference === activeSessionRef) || null;

  useEffect(() => {
    if (activeSession) {
      setSelectedAppleDevices(activeSession.currentAppleDevices ?? []);
    } else {
      setSelectedAppleDevices([]);
    }
  }, [activeSession?.reference, activeSession?.currentAppleDevices]);

  const currentPhone = activeSession
    ? (phoneDrafts[activeSession.reference] ?? activeSession.phone ?? '')
    : '';

  const finished = Boolean(
    activeSession?.outcome || activeSession?.state === 'COMPLETED',
  );

  const hasCompletedAppleDeviceSurvey = Boolean(
    activeSession?.currentAppleDevices &&
    activeSession.currentAppleDevices.length > 0,
  );

  const isAppleDeviceStep = Boolean(
    activeSession && !finished && !hasCompletedAppleDeviceSurvey,
  );

  const isPhoneStep = Boolean(
    activeSession &&
    !finished &&
    hasCompletedAppleDeviceSurvey &&
    (!activeSession.phone || activeSession.phone.trim() === ''),
  );

  const progressContainerRef = useRef<HTMLOListElement>(null);

  // on a phone the list and the order take turns: opening an order (or a new walk-in) starts at the top of the page
  useEffect(() => {
    document.querySelector('main')?.scrollTo({ top: 0 });
  }, [activeSessionRef]);

  // Auto-scroll to progress stepper or top on stage change, form change, or session switch
  useEffect(() => {
    if (activeSessionRef) {
      if (progressContainerRef.current) {
        progressContainerRef.current.scrollIntoView({
          behavior: 'smooth',
          block: 'nearest',
        });
      } else {
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
    }
  }, [activeSessionRef, activeSession?.state, activeSession?.confirmed, form]);

  /** The customer keeps what is left (D40 ACCEPT_PARTIAL): the server drops the missing items and the session moves on to FOUND. */
  const handleCustomerAcceptPartial = async (session: MockSession) => {
    if (!session.stockPendingReview || !session.id) return;
    setBusy(true);
    setError('');
    try {
      const updated = await resolveStockReviewApi(session.id, 'ACCEPT_PARTIAL');
      onUpdateSession({ ...updated, stockPendingReview: undefined });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'ดำเนินการไม่สำเร็จ');
    } finally {
      setBusy(false);
    }
  };

  /** The customer wants other items instead (D40 CHANGE_ITEMS): the missing items drop out and the selection reopens. */
  const handleCustomerChangeItems = async (session: MockSession) => {
    if (!session.stockPendingReview || !session.id) return;
    setBusy(true);
    setError('');
    try {
      const updated = await resolveStockReviewApi(session.id, 'CHANGE_ITEMS');
      onUpdateSession({ ...updated, stockPendingReview: undefined });
      setForm('normal');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'ดำเนินการไม่สำเร็จ');
    } finally {
      setBusy(false);
    }
  };

  const startNewWalkIn = async (pickedItems: Picked[] = []) => {
    setBusy(true);
    setError('');
    try {
      const skuIds = pickedItems.map((item) => item.sku.id);
      const newS = await createWalkInApi(
        user.branchCode,
        '',
        undefined,
        undefined,
        skuIds,
      );
      newS.currentAppleDevices = undefined;
      setSelectedAppleDevices([]);
      setHasAutoLoadedHistory(false);
      if (pickedItems.length > 0) {
        newS.selection = {
          ...newS.selection,
          items: pickedItems.map((item) => ({
            id: item.sku.id,
            quantity: 1,
            product: toProduct(item.product, item.model, item.sku),
          })),
        };
      }
      onAddSession(newS);
      setActiveSessionRef(newS.reference);
      setForm('normal');
      setWalkInStep('product');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'สร้าง Session ไม่สำเร็จ');
    } finally {
      setBusy(false);
    }
  };

  const handleToggleAppleDevice = (cat: string) => {
    if (cat === 'ยังไม่เคยใช้สินค้า Apple' || cat === 'ไม่แน่ใจ / ไม่ได้ถาม') {
      if (selectedAppleDevices.includes(cat)) {
        setSelectedAppleDevices([]);
      } else {
        setSelectedAppleDevices([cat]);
      }
    } else {
      const next = selectedAppleDevices.includes(cat)
        ? selectedAppleDevices.filter((c) => c !== cat)
        : [
            ...selectedAppleDevices.filter(
              (c) =>
                c !== 'ยังไม่เคยใช้สินค้า Apple' &&
                c !== 'ไม่แน่ใจ / ไม่ได้ถาม',
            ),
            cat,
          ];
      setSelectedAppleDevices(next);
    }
  };

  const handleConfirmAppleDeviceStep = async () => {
    if (!activeSession) return;
    const devicesToSave =
      selectedAppleDevices.length > 0 ? selectedAppleDevices : ['ไม่ระบุ'];
    setBusy(true);
    setError('');
    try {
      if (activeSession.id) {
        const updated = await updateSelectionApi(
          activeSession.id,
          activeSession.selection,
          activeSession.phone || currentPhone || '',
          devicesToSave,
        );
        onUpdateSession({ ...updated, currentAppleDevices: devicesToSave });
      } else {
        onUpdateSession({
          ...activeSession,
          currentAppleDevices: devicesToSave,
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'บันทึกข้อมูลไม่สำเร็จ');
    } finally {
      setBusy(false);
    }
  };

  const handleConfirmPhoneStep = async () => {
    if (!activeSession) return;
    if (!phoneIsValid(currentPhone)) {
      setPhoneAttempted((prev) => ({
        ...prev,
        [activeSession.reference]: true,
      }));
      return;
    }
    setBusy(true);
    setError('');
    try {
      if (activeSession.id) {
        const updated = await updateSelectionApi(
          activeSession.id,
          activeSession.selection,
          currentPhone,
          activeSession.currentAppleDevices,
        );
        onUpdateSession({ ...updated, phone: currentPhone });
      } else {
        onUpdateSession({ ...activeSession, phone: currentPhone });
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'บันทึกเบอร์โทรศัพท์ไม่สำเร็จ',
      );
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
        const phoneToSave =
          phoneDrafts[activeSession.reference] ?? activeSession.phone ?? '';
        await updateSelectionApi(
          activeSession.id,
          activeSession.selection,
          phoneToSave,
        );
      }
      if (activeSession.id) {
        const updated = await advanceStepApi(activeSession.id, action);
        onUpdateSession(updated);
      } else {
        const updated = advance(
          activeSession,
          action,
          new Date().toISOString(),
        );
        onUpdateSession(updated);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'ดำเนินการไม่สำเร็จ');
    } finally {
      setBusy(false);
    }
  };

  /** F11: a new session with the old data and the old queue number; the cancelled one stays cancelled. */
  const handleRebuy = async () => {
    if (!activeSession?.id) return;
    setBusy(true);
    setError('');
    try {
      const created = await rebuyApi(activeSession.id);
      onUpdateSession({
        ...activeSession,
        rebuiltAs: { id: created.id ?? '', reference: created.reference },
      });
      onAddSession(created);
      setActiveSessionRef(created.reference);
      setForm('normal');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'ซื้อใหม่ไม่สำเร็จ');
    } finally {
      setBusy(false);
    }
  };

  const handleStartSelection = () => {
    if (!activeSession) return;
    if (!phoneIsValid(currentPhone)) {
      setPhoneAttempted((prev) => ({
        ...prev,
        [activeSession.reference]: true,
      }));
      return;
    }
    handleStep('startSelection');
  };

  const handleConfirm = async () => {
    if (!activeSession) return;
    setBusy(true);
    setError('');
    try {
      let updated: MockSession;
      if (activeSession.id) {
        updated = await confirmPurchaseApi(activeSession.id);
        onUpdateSession(updated);
      } else {
        updated = confirmSelection(activeSession, new Date().toISOString());
        onUpdateSession(updated);
      }
      setForm('normal');
      setPrintSession(updated);

      const handleAfterPrint = () => {
        window.removeEventListener('afterprint', handleAfterPrint);
        setForm('normal');
        setPrintSession(null);
        // D140: Open survey for BUY after confirm purchase
        setSurveyModal({ session: updated, target: 'BUY' });
      };
      window.addEventListener('afterprint', handleAfterPrint, { once: true });

      setTimeout(() => {
        if (typeof window.print === 'function') {
          window.print();
        } else {
          handleAfterPrint();
        }
      }, 150);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'ยืนยันการสั่งซื้อไม่สำเร็จ',
      );
    } finally {
      setBusy(false);
    }
  };

  const handleCancelCurrent = async (reason: string, text: string) => {
    if (!activeSession) return;
    setBusy(true);
    setError('');
    try {
      let updated: MockSession;
      if (activeSession.id) {
        updated = await cancelSessionApi(activeSession.id, reason, text);
      } else {
        updated = {
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
      }
      onUpdateSession(updated);
      setForm('normal');
      // D140: Open survey for NOT_BUY after cancel
      setSurveyModal({ session: updated, target: 'NOT_BUY' });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'ยกเลิกไม่สำเร็จ');
    } finally {
      setBusy(false);
    }
  };

  const handleSurveyComplete = (response?: SurveyResponseItem) => {
    if (response && surveyModal?.session) {
      const existing = (surveyModal.session.surveyResponses ?? []).filter(
        (r) => r.target !== response.target,
      );
      const updatedS: MockSession = {
        ...surveyModal.session,
        surveyResponses: [...existing, response],
      };
      onUpdateSession(updatedS);
    }
    const wasBuy = surveyModal?.target === 'BUY';
    setSurveyModal(null);
    if (wasBuy) {
      setActiveSessionRef(null);
    }
  };

  /** F13/D105: the cashier (in U POS) found the wrong unit; STAFF sends the order back to stock with which items and why. */
  const handleReturnToStock = async (
    reason: string,
    text: string,
    wrongItems?: string[],
    wrongItemIds?: string[],
    wrongItemDetails?: Record<string, { reason: string; note?: string }>,
  ) => {
    if (!activeSession?.id) return;
    setBusy(true);
    setError('');
    try {
      onUpdateSession(
        await returnToStockApi(
          activeSession.id,
          reason,
          text || undefined,
          wrongItems,
          wrongItemIds,
          wrongItemDetails,
        ),
      );
      setForm('normal');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'ส่งกลับ Stock ไม่สำเร็จ');
    } finally {
      setBusy(false);
    }
  };

  /** D78: staff changes item and sends back to stock. */
  const handleChangeItem = async (
    oldItemId: string,
    newSkuId: string,
    reason: string,
    note?: string,
  ) => {
    if (!changingItemSession || !changingItemSession.id) return;
    setError('');
    const updated = await changeSessionItemApi(
      changingItemSession.id,
      oldItemId,
      newSkuId,
      reason,
      note,
    );
    onUpdateSession(updated);
    setChangingItemSession(null);
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

  const handleUpdatePhone = (cleanPhone: string, _isValid: boolean) => {
    if (!activeSession) return;
    setPhoneDrafts((prev) => ({
      ...prev,
      [activeSession.reference]: cleanPhone,
    }));
    setPhoneAttempted((prev) => ({
      ...prev,
      [activeSession.reference]: false,
    }));
  };

  const pendingStockSessions = branchSessions.filter(
    (s) =>
      !s.outcome &&
      Boolean(s.stockPendingReview) &&
      (user.roles.includes('ADMIN') ||
        user.roles.includes('MANAGER') ||
        s.staffId === user.staffId),
  );

  return (
    <div
      className="staff-workspace"
      data-mobile-detail={activeSession ? 'true' : 'false'}
    >
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
          <Button
            onClick={() => {
              setActiveSessionRef(null);
              setForm('normal');
            }}
            disabled={busy}
          >
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
              }}
            >
              <Plus size={16} />
              รับลูกค้าใหม่
            </span>
          </Button>
        </div>
      </div>

      {error && (
        <div style={{ marginBottom: '1rem' }}>
          <Notice error>{error}</Notice>
        </div>
      )}

      {pendingStockSessions.length > 0 && (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
            marginBottom: '1.25rem',
          }}
        >
          {pendingStockSessions.map((ps) => (
            <Notice key={ps.reference} error>
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
                  <strong
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '4px',
                    }}
                  >
                    <AlertTriangle size={16} color="#dc2626" />
                    ฝ่ายคลัง (Stock) แจ้งเตือน:
                  </strong>{' '}
                  {ps.queueNo != null ? (
                    <>
                      <strong>{ps.queue}</strong>
                    </>
                  ) : (
                    <>
                      <strong>
                        {formatDisplayPhone(ps.phone) || ps.reference}
                      </strong>
                    </>
                  )}{' '}
                  ({itemsText(ps.selection.items) || 'สินค้า'}) —{' '}
                  มีสินค้าไม่พบ/หมด (
                  {ps.stockPendingReview?.missingItems.join(', ')})
                </span>
                <Button
                  size="sm"
                  onClick={() => {
                    setActiveSessionRef(ps.reference);
                    setForm('normal');
                  }}
                >
                  เปิดดูและถามลูกค้า
                </Button>
              </div>
            </Notice>
          ))}
        </div>
      )}

      <div className="staff-layout">
        <div className="staff-sessions-sidebar">
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              marginBottom: '12px',
            }}
          >
            <ClipboardList size={18} color="#0abab5" />
            <h3 style={{ margin: 0 }}>
              Session หน้าร้าน ({branchSessions.length})
            </h3>
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
                  <span className="card-ref">
                    {s.queueNo != null
                      ? `${s.queue}`
                      : `${formatDisplayPhone(s.phone) || s.reference}`}
                  </span>
                  {s.stockPendingReview ? (
                    <span
                      className="status-tag status-outcome"
                      style={{
                        background: '#fef2f2',
                        color: '#b91c1c',
                        border: '1px solid #fecaca',
                      }}
                    >
                      <AlertTriangle size={12} strokeWidth={1.75} />
                      <span>สินค้าไม่ครบ</span>
                    </span>
                  ) : (
                    <span
                      className={`status-tag ${s.outcome ? 'status-outcome' : `status-${s.state.toLowerCase()}`}`}
                    >
                      <span className="only-desktop">
                        {s.outcome ?? s.state}
                      </span>
                      <span className="only-mobile">{stateLabel(s)}</span>
                    </span>
                  )}
                </div>
                <div className="card-product">
                  {itemsText(s.selection.items) || 'ยังไม่ระบุสินค้า'}
                </div>
                <div className="card-meta">
                  <span>ผู้ดูแล: {s.staffId}</span>
                  <div
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '8px',
                    }}
                  >
                    {s.queueNo != null && (
                      <span>
                        {formatDisplayPhone(s.phone) || 'ยังไม่มีเบอร์'}
                      </span>
                    )}
                    {(() => {
                      const badge = receiptTypeBadgeLabel(
                        s.receiptType ?? s.selection?.receiptType,
                        s.taxInvoice ?? s.selection?.taxInvoice,
                      );
                      return badge ? (
                        <span
                          style={{
                            color: 'var(--color-info)',
                            fontWeight: 500,
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '4px',
                          }}
                        >
                          <ReceiptText size={13} strokeWidth={1.6} />
                          {badge}
                        </span>
                      ) : null;
                    })()}
                    {(s.vatRefund ?? s.selection?.vatRefund) && (
                      <span
                        style={{
                          color: 'var(--color-warning)',
                          fontWeight: 500,
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '4px',
                        }}
                      >
                        <Plane size={13} strokeWidth={1.6} />
                        VAT
                      </span>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="staff-main-panel">
          {(() => {
            const pIndex = progressIndex(activeSession, form === 'review');
            return (
              <>
                {/* D135: Mobile segmented stepper */}
                <div
                  className="mobile-stepper"
                  role="region"
                  aria-label="ขั้นตอนความคืบหน้า"
                >
                  <div className="mobile-stepper-header">
                    <span className="mobile-stepper-title">
                      {stages[pIndex]}
                    </span>
                    <span className="mobile-stepper-step">
                      ขั้นตอน {pIndex + 1}/{stages.length}
                    </span>
                  </div>
                  <div className="mobile-stepper-bars">
                    {stages.map((_, idx) => (
                      <div
                        key={idx}
                        className={`mobile-stepper-bar ${idx <= pIndex ? 'active' : ''}`}
                      />
                    ))}
                  </div>
                </div>

                {/* Desktop pill stepper */}
                <ol className="progress" ref={progressContainerRef}>
                  {stages.map((label, index) => (
                    <li
                      key={label}
                      className={
                        index === pIndex
                          ? 'current'
                          : index < pIndex
                            ? 'done'
                            : ''
                      }
                      aria-current={index === pIndex ? 'step' : undefined}
                    >
                      <span>
                        {index < pIndex ? <Check size={14} /> : index + 1}
                      </span>
                      {label}
                    </li>
                  ))}
                </ol>
              </>
            );
          })()}

          {!activeSession ? (
            <div className="content-grid">
              <Panel
                title="ลูกค้าสนใจอะไร"
                eyebrow="ขั้นตอนที่ 1: เลือกสินค้าที่ลูกค้าสนใจ (สูงสุด 3 รายการ)"
              >
                <WalkInForm busy={busy} onSubmit={startNewWalkIn} />
              </Panel>
            </div>
          ) : (
            <>
              <section className="session-strip">
                <div className="session-strip-main">
                  <div className="session-strip-top-row">
                    <button
                      type="button"
                      className="mobile-back-to-queue-btn"
                      onClick={() => setActiveSessionRef(null)}
                    >
                      <ArrowLeft size={14} /> ลูกค้าวันนี้ (
                      {branchSessions.length})
                    </button>
                    <span
                      className={`state-pill only-mobile ${finished ? 'terminal' : ''}`}
                    >
                      {stateLabel(activeSession)}
                    </span>
                  </div>
                  {/* <span className="eyebrow">
                    {activeSession.queueNo != null ? 'QUEUE' : 'CUSTOMER'} · {activeSession.branchName}
                  </span> */}
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: '10px',
                      width: '100%',
                    }}
                  >
                    <h2 className="queue-title" style={{ margin: 0 }}>
                      {activeSession.queueNo != null
                        ? `${activeSession.queue}`
                        : `${formatDisplayPhone(activeSession.phone) || activeSession.reference}`}
                    </h2>
                    {(activeSession.vatRefund ??
                      activeSession.selection?.vatRefund) && (
                      <span
                        className="only-tablet-mobile"
                        style={{ marginLeft: 'auto' }}
                      >
                        <span
                          className="status-tag"
                          style={{
                            background: 'var(--bg-warning)',
                            color: 'var(--color-warning)',
                            border: '1px solid var(--border-warning)',
                          }}
                        >
                          <Plane size={12} strokeWidth={1.6} />
                          VAT Refund
                        </span>
                      </span>
                    )}
                  </div>
                  {activeSession.rebuyOf && (
                    <span
                      className="status-tag status-found"
                      style={{ marginRight: '8px' }}
                    >
                      ซื้อใหม่ (ใช้คิวเดิม)
                    </span>
                  )}
                  {(() => {
                    const activeReceipt =
                      activeSession.receiptType ??
                      activeSession.selection?.receiptType;
                    const activeTax =
                      activeSession.taxInvoice ??
                      activeSession.selection?.taxInvoice;
                    const badge = receiptTypeBadgeLabel(
                      activeReceipt,
                      activeTax,
                    );
                    const fullLabel = receiptTypeLabel(
                      activeReceipt,
                      activeTax,
                    );
                    return badge && fullLabel ? (
                      <span
                        className="status-tag"
                        style={{
                          background: 'var(--bg-info)',
                          color: 'var(--color-info)',
                          border: '1px solid var(--border-info)',
                          marginRight: '6px',
                        }}
                      >
                        <ReceiptText size={12} strokeWidth={1.6} />
                        {fullLabel}
                      </span>
                    ) : null;
                  })()}
                  {/* the phone is the title until the order gets its queue number: then it is shown here once */}
                  {activeSession.queueNo != null && (
                    <span className="muted">
                      Customer Phone ·{' '}
                      {formatDisplayPhone(activeSession.phone) ||
                        'ไม่มีเบอร์โทร'}
                    </span>
                  )}
                </div>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    flexShrink: 0,
                  }}
                >
                  {(activeSession.vatRefund ??
                    activeSession.selection?.vatRefund) && (
                    <span
                      className="status-tag vat-desktop"
                      style={{
                        background: 'var(--bg-warning)',
                        color: 'var(--color-warning)',
                        border: '1px solid var(--border-warning)',
                      }}
                    >
                      <Plane size={12} strokeWidth={1.6} />
                      VAT Refund
                    </span>
                  )}
                  <span
                    className={`state-pill only-desktop ${finished ? 'terminal' : ''}`}
                  >
                    {activeSession.outcome ?? stateLabel(activeSession)}
                  </span>
                </div>
              </section>

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
                            : form === 'return'
                              ? 'ส่งสินค้ากลับ Stock (หยิบผิด)'
                              : isAppleDeviceStep
                                ? 'ลูกค้าใช้สินค้า Apple อะไรอยู่บ้าง'
                                : isPhoneStep
                                  ? 'กรอกเบอร์โทรศัพท์ลูกค้า'
                                  : undefined
                    }
                    eyebrow={
                      !finished &&
                      form === 'normal' &&
                      !isAppleDeviceStep &&
                      !isPhoneStep
                        ? undefined
                        : isAppleDeviceStep
                          ? `ขั้นตอนที่ 2: รหัสคำขอ ${activeSession.reference}`
                          : isPhoneStep
                            ? `ขั้นตอนที่ 3: รหัสคำขอ ${activeSession.reference}`
                            : 'ขั้นตอนปัจจุบัน'
                    }
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
                        {canRebuy(activeSession) && (
                          <div className="rebuy-box">
                            <p>
                              <strong>ลูกค้าต้องการเปลี่ยนสินค้า</strong> —
                              ซื้อใหม่ได้ทันที โดยดึงข้อมูลเดิมมาแก้ไข
                              {activeSession.queueNo != null
                                ? ` และใช้คิว ${activeSession.queue} เดิม`
                                : ''}
                            </p>
                            <Button onClick={handleRebuy} disabled={busy}>
                              {activeSession.queueNo != null
                                ? `ซื้อใหม่ (คิว ${activeSession.queue})`
                                : 'ซื้อใหม่'}
                            </Button>
                          </div>
                        )}
                        <div style={{ marginTop: '1rem' }}>
                          <Button
                            onClick={() => {
                              setActiveSessionRef(null);
                              setForm('normal');
                            }}
                          >
                            <span
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '6px',
                              }}
                            >
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
                        label="ยืนยันการยกเลิก"
                        onSubmit={handleCancelCurrent}
                      />
                    ) : form === 'return' ? (
                      <ReturnToStockForm
                        session={activeSession}
                        onBack={() => setForm('normal')}
                        onSubmit={handleReturnToStock}
                      />
                    ) : (
                      <>
                        {activeSession.stockPendingReview && (
                          <div style={{ marginBottom: '1.25rem' }}>
                            <Notice error>
                              <div
                                style={{
                                  display: 'flex',
                                  flexDirection: 'column',
                                  gap: '8px',
                                }}
                              >
                                <div
                                  style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '6px',
                                    fontWeight: 700,
                                  }}
                                >
                                  <AlertTriangle size={18} color="#dc2626" />
                                  ฝ่าย Stock แจ้ง: สินค้าบางรายการไม่พบ / หมด
                                </div>
                                {activeSession.stockPendingReview.stockNote && (
                                  <div>
                                    <strong>หมายเหตุจาก Stock:</strong>{' '}
                                    <em>
                                      "
                                      {
                                        activeSession.stockPendingReview
                                          .stockNote
                                      }
                                      "
                                    </em>
                                  </div>
                                )}
                                <div>
                                  <strong style={{ color: '#991b1b' }}>
                                    รายการที่ไม่พบ/หมด:
                                  </strong>{' '}
                                  {activeSession.stockPendingReview.missingItems.join(
                                    ', ',
                                  )}
                                </div>
                                {activeSession.stockPendingReview.foundItems
                                  .length > 0 && (
                                  <div>
                                    <strong style={{ color: '#0d8a72' }}>
                                      รายการที่มีพร้อมส่ง:
                                    </strong>{' '}
                                    {activeSession.stockPendingReview.foundItems.join(
                                      ', ',
                                    )}
                                  </div>
                                )}
                                <p
                                  style={{
                                    margin: '4px 0 8px',
                                    fontSize: '13px',
                                  }}
                                >
                                  กรุณาสอบถามลูกค้าและเลือกดำเนินการตามความประสงค์:
                                </p>
                                <div
                                  style={{
                                    display: 'flex',
                                    gap: '8px',
                                    flexWrap: 'wrap',
                                    marginTop: '6px',
                                  }}
                                >
                                  <Button
                                    size="sm"
                                    onClick={() =>
                                      handleCustomerAcceptPartial(activeSession)
                                    }
                                    disabled={
                                      busy ||
                                      activeSession.stockPendingReview
                                        .foundItems.length === 0
                                    }
                                    title={
                                      activeSession.stockPendingReview
                                        .foundItems.length === 0
                                        ? 'ไม่มีสินค้าที่พบพร้อมจัดส่ง'
                                        : undefined
                                    }
                                  >
                                    <span
                                      style={{
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        gap: '4px',
                                      }}
                                    >
                                      <Check size={14} /> 1.
                                      ยืนยันซื้อเฉพาะที่เหลือ
                                      {activeSession.stockPendingReview
                                        .foundItems.length === 0 && (
                                        <span
                                          style={{
                                            fontSize: '11px',
                                            opacity: 0.8,
                                          }}
                                        >
                                          (ไม่มีสินค้าพร้อมส่ง)
                                        </span>
                                      )}
                                    </span>
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="secondary"
                                    onClick={() =>
                                      handleCustomerChangeItems(activeSession)
                                    }
                                    disabled={busy}
                                  >
                                    <span
                                      style={{
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        gap: '4px',
                                      }}
                                    >
                                      <Plus size={14} /> 2.
                                      เพิ่ม/เปลี่ยนสินค้าอื่น
                                    </span>
                                  </Button>
                                  <Button
                                    variant="danger"
                                    size="sm"
                                    onClick={() => setForm('cancel')}
                                    disabled={busy}
                                  >
                                    <span
                                      style={{
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        gap: '4px',
                                      }}
                                    >
                                      <X size={14} /> 3. ลูกค้ายกเลิกทั้งหมด
                                    </span>
                                  </Button>
                                </div>
                              </div>
                            </Notice>
                          </div>
                        )}

                        {isAppleDeviceStep ? (
                          <div
                            style={{
                              display: 'flex',
                              flexDirection: 'column',
                              gap: '1.25rem',
                            }}
                          >
                            {/* Customer interested products from Step 1 */}
                            <div
                              style={{
                                background: '#f8fafc',
                                border: '1px solid #e2e8f0',
                                borderRadius: '12px',
                                padding: '16px',
                              }}
                            >
                              <div
                                style={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'space-between',
                                  marginBottom: '12px',
                                }}
                              >
                                <strong
                                  style={{ fontSize: '14px', color: '#0f172a' }}
                                >
                                  รายการสินค้าที่สนใจ (
                                  {activeSession.selection?.items?.length ?? 0}{' '}
                                  รายการ)
                                </strong>
                              </div>
                              {!activeSession.selection?.items ||
                              activeSession.selection.items.length === 0 ? (
                                <p className="muted" style={{ margin: 0 }}>
                                  ไม่มีสินค้าที่ระบุไว้ในขั้นตอนแรก
                                </p>
                              ) : (
                                <div
                                  style={{
                                    display: 'flex',
                                    flexDirection: 'column',
                                    gap: '8px',
                                  }}
                                >
                                  {activeSession.selection.items.map((item) => {
                                    const outOfStock = isOutOfStock(
                                      item.product,
                                    );
                                    return (
                                      <div
                                        key={item.product.id}
                                        style={{
                                          display: 'flex',
                                          alignItems: 'center',
                                          justifyContent: 'space-between',
                                          padding: '8px 12px',
                                          background: '#ffffff',
                                          border: '1px solid #edf2f7',
                                          borderRadius: '8px',
                                        }}
                                      >
                                        <div
                                          style={{
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: '10px',
                                          }}
                                        >
                                          <CategoryPicture
                                            cat={item.product.category}
                                            size={32}
                                          />
                                          <div>
                                            <div
                                              style={{
                                                fontWeight: 600,
                                                fontSize: '13px',
                                                color: '#1e293b',
                                              }}
                                            >
                                              {itemName(item)}
                                            </div>
                                            <small style={{ color: '#64748b' }}>
                                              {item.product.sku}
                                            </small>
                                          </div>
                                        </div>
                                        <div>
                                          {outOfStock ? (
                                            <span
                                              className="stock-badge stock-badge-out"
                                              style={{
                                                fontSize: '11px',
                                                padding: '3px 8px',
                                                borderRadius: '4px',
                                              }}
                                            >
                                              สินค้าหมด (สนใจ)
                                            </span>
                                          ) : (
                                            <span
                                              className="stock-badge stock-badge-in"
                                              style={{
                                                fontSize: '11px',
                                                padding: '3px 8px',
                                                borderRadius: '4px',
                                              }}
                                            >
                                              มีสินค้า
                                            </span>
                                          )}
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                              )}
                            </div>

                            {/* Apple devices survey */}
                            <div
                              style={{
                                background: '#ffffff',
                                border: '1px solid #e2e8f0',
                                borderRadius: '12px',
                                padding: '16px',
                              }}
                            >
                              <label
                                style={{
                                  display: 'block',
                                  fontWeight: 600,
                                  fontSize: '15px',
                                  marginBottom: '6px',
                                  color: '#0f172a',
                                }}
                              >
                                ลูกค้าใช้สินค้า Apple อะไรอยู่บ้าง?
                              </label>
                              <p
                                style={{
                                  margin: '0 0 14px',
                                  fontSize: '13px',
                                  color: '#64748b',
                                }}
                              >
                                เลือกหมวดหมู่ที่ลูกค้ากำลังใช้งานอยู่ในปัจจุบัน
                              </p>
                              <div
                                className="wizard-tiles picker-category-tiles"
                                role="group"
                                aria-label="หมวดหมู่สินค้า Apple ที่ลูกค้าใช้อยู่"
                              >
                                {customerAppleCategories
                                  .filter(
                                    (cat) =>
                                      cat !== 'ยังไม่เคยใช้สินค้า Apple' &&
                                      cat !== 'ไม่แน่ใจ / ไม่ได้ถาม',
                                  )
                                  .map((cat) => {
                                    const isSelected =
                                      selectedAppleDevices.includes(cat);
                                    return (
                                      <button
                                        key={cat}
                                        type="button"
                                        className={`wizard-tile wizard-tile-category${isSelected ? ' selected' : ''}`}
                                        aria-pressed={isSelected}
                                        onClick={() =>
                                          handleToggleAppleDevice(cat)
                                        }
                                        style={{ position: 'relative' }}
                                      >
                                        {isSelected && (
                                          <span
                                            style={{
                                              position: 'absolute',
                                              top: '6px',
                                              right: '6px',
                                              width: '20px',
                                              height: '20px',
                                              borderRadius: '50%',
                                              background: '#0abab5',
                                              color: '#ffffff',
                                              display: 'grid',
                                              placeItems: 'center',
                                              boxShadow:
                                                '0 1px 3px rgba(0,0,0,0.15)',
                                            }}
                                          >
                                            <Check size={12} strokeWidth={3} />
                                          </span>
                                        )}
                                        <CategoryPicture cat={cat} size={64} />
                                        <strong>{cat}</strong>
                                      </button>
                                    );
                                  })}
                              </div>

                              {/* Two exclusive buttons side-by-side */}
                              <div
                                style={{
                                  marginTop: '14px',
                                  display: 'grid',
                                  gridTemplateColumns:
                                    'repeat(auto-fit, minmax(200px, 1fr))',
                                  gap: '10px',
                                }}
                              >
                                <button
                                  type="button"
                                  className={`wizard-tile${selectedAppleDevices.includes('ยังไม่เคยใช้สินค้า Apple') ? ' selected' : ''}`}
                                  onClick={() =>
                                    handleToggleAppleDevice(
                                      'ยังไม่เคยใช้สินค้า Apple',
                                    )
                                  }
                                  style={{
                                    width: '100%',
                                    padding: '12px 18px',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    gap: '8px',
                                    borderRadius: '10px',
                                    border: selectedAppleDevices.includes(
                                      'ยังไม่เคยใช้สินค้า Apple',
                                    )
                                      ? '2px solid #0abab5'
                                      : '1.5px dashed #cbd5e1',
                                    background: selectedAppleDevices.includes(
                                      'ยังไม่เคยใช้สินค้า Apple',
                                    )
                                      ? '#f0fdfa'
                                      : '#ffffff',
                                    color: selectedAppleDevices.includes(
                                      'ยังไม่เคยใช้สินค้า Apple',
                                    )
                                      ? '#0f766e'
                                      : '#64748b',
                                    fontWeight: 600,
                                    fontSize: '13.5px',
                                    cursor: 'pointer',
                                    transition: 'all 0.15s ease',
                                  }}
                                >
                                  <span>ยังไม่เคยใช้สินค้า Apple</span>
                                </button>

                                <button
                                  type="button"
                                  className={`wizard-tile${selectedAppleDevices.includes('ไม่แน่ใจ / ไม่ได้ถาม') ? ' selected' : ''}`}
                                  onClick={() =>
                                    handleToggleAppleDevice(
                                      'ไม่แน่ใจ / ไม่ได้ถาม',
                                    )
                                  }
                                  style={{
                                    width: '100%',
                                    padding: '12px 18px',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    gap: '8px',
                                    borderRadius: '10px',
                                    border: selectedAppleDevices.includes(
                                      'ไม่แน่ใจ / ไม่ได้ถาม',
                                    )
                                      ? '2px solid #0abab5'
                                      : '1.5px dashed #cbd5e1',
                                    background: selectedAppleDevices.includes(
                                      'ไม่แน่ใจ / ไม่ได้ถาม',
                                    )
                                      ? '#f0fdfa'
                                      : '#ffffff',
                                    color: selectedAppleDevices.includes(
                                      'ไม่แน่ใจ / ไม่ได้ถาม',
                                    )
                                      ? '#0f766e'
                                      : '#64748b',
                                    fontWeight: 600,
                                    fontSize: '13.5px',
                                    cursor: 'pointer',
                                    transition: 'all 0.15s ease',
                                  }}
                                >
                                  <span>ไม่แน่ใจ / ไม่ได้ถาม</span>
                                </button>
                              </div>
                            </div>

                            {/* Actions */}
                            <div
                              style={{
                                display: 'flex',
                                justifyContent: 'flex-end',
                                alignItems: 'center',
                                marginTop: '16px',
                              }}
                            >
                              <Button
                                variant="primary"
                                onClick={handleConfirmAppleDeviceStep}
                                disabled={busy}
                              >
                                <span
                                  style={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '6px',
                                  }}
                                >
                                  ถัดไป
                                  <ArrowRight size={16} />
                                </span>
                              </Button>
                            </div>
                          </div>
                        ) : isPhoneStep ? (
                          <div
                            style={{
                              display: 'flex',
                              flexDirection: 'column',
                              gap: '1.25rem',
                            }}
                          >
                            {/* Customer Phone Input */}
                            <div
                              style={{
                                background: '#ffffff',
                                border: '1px solid #e2e8f0',
                                borderRadius: '12px',
                                padding: '16px',
                              }}
                            >
                              <label
                                style={{
                                  display: 'block',
                                  fontWeight: 600,
                                  fontSize: '14px',
                                  marginBottom: '8px',
                                  color: '#0f172a',
                                }}
                              >
                                เบอร์โทรศัพท์ลูกค้า{' '}
                                <span style={{ color: '#dc2626' }}>*</span>
                              </label>
                              <p
                                style={{
                                  margin: '0 0 10px',
                                  fontSize: '12px',
                                  color: '#64748b',
                                }}
                              >
                                ใช้สำหรับติดต่อ และบันทึกประวัติการรับบริการ
                              </p>
                              <div style={{ width: '100%' }}>
                                <PhoneInput
                                  value={currentPhone}
                                  onChange={(newPhone, valid) =>
                                    handleUpdatePhone(newPhone, valid)
                                  }
                                />
                              </div>
                              {phoneAttempted[activeSession.reference] &&
                                !phoneIsValid(currentPhone) && (
                                  <p
                                    className="field-error"
                                    style={{
                                      margin: '6px 0 0',
                                      fontSize: '13px',
                                    }}
                                  >
                                    กรุณากรอกเบอร์โทรศัพท์ให้ถูกต้อง
                                  </p>
                                )}
                            </div>

                            {/* Customer interested products from Step 1 */}
                            <div
                              style={{
                                background: '#f8fafc',
                                border: '1px solid #e2e8f0',
                                borderRadius: '12px',
                                padding: '16px',
                              }}
                            >
                              <div
                                style={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'space-between',
                                  marginBottom: '12px',
                                }}
                              >
                                <strong
                                  style={{ fontSize: '14px', color: '#0f172a' }}
                                >
                                  รายการสินค้าที่สนใจ (
                                  {activeSession.selection?.items?.length ?? 0}{' '}
                                  รายการ)
                                </strong>
                              </div>
                              {!activeSession.selection?.items ||
                              activeSession.selection.items.length === 0 ? (
                                <p className="muted" style={{ margin: 0 }}>
                                  ไม่มีสินค้าที่ระบุไว้ในขั้นตอนแรก
                                </p>
                              ) : (
                                <div
                                  style={{
                                    display: 'flex',
                                    flexDirection: 'column',
                                    gap: '8px',
                                  }}
                                >
                                  {activeSession.selection.items.map((item) => {
                                    const outOfStock = isOutOfStock(
                                      item.product,
                                    );
                                    return (
                                      <div
                                        key={item.product.id}
                                        style={{
                                          display: 'flex',
                                          alignItems: 'center',
                                          justifyContent: 'space-between',
                                          padding: '8px 12px',
                                          background: '#ffffff',
                                          border: '1px solid #edf2f7',
                                          borderRadius: '8px',
                                        }}
                                      >
                                        <div
                                          style={{
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: '10px',
                                          }}
                                        >
                                          <CategoryPicture
                                            cat={item.product.category}
                                            size={32}
                                          />
                                          <div>
                                            <div
                                              style={{
                                                fontWeight: 600,
                                                fontSize: '13px',
                                                color: '#1e293b',
                                              }}
                                            >
                                              {itemName(item)}
                                            </div>
                                            <small style={{ color: '#64748b' }}>
                                              {item.product.sku}
                                            </small>
                                          </div>
                                        </div>
                                        <div>
                                          {outOfStock ? (
                                            <span
                                              className="stock-badge stock-badge-out"
                                              style={{
                                                fontSize: '11px',
                                                padding: '3px 8px',
                                                borderRadius: '4px',
                                              }}
                                            >
                                              สินค้าหมด (สนใจ)
                                            </span>
                                          ) : (
                                            <span
                                              className="stock-badge stock-badge-in"
                                              style={{
                                                fontSize: '11px',
                                                padding: '3px 8px',
                                                borderRadius: '4px',
                                              }}
                                            >
                                              มีสินค้า
                                            </span>
                                          )}
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                              )}
                            </div>

                            {/* Apple devices summary from Step 2 */}
                            {activeSession.currentAppleDevices &&
                              activeSession.currentAppleDevices.length > 0 && (
                                <div
                                  style={{
                                    background: '#f0fdfa',
                                    border: '1px solid #ccfbf1',
                                    borderRadius: '12px',
                                    padding: '12px 16px',
                                  }}
                                >
                                  <div
                                    style={{
                                      fontSize: '12px',
                                      fontWeight: 600,
                                      color: '#0f766e',
                                      marginBottom: '4px',
                                    }}
                                  >
                                    สินค้า Apple ที่ลูกค้าใช้อยู่ในปัจจุบัน:
                                  </div>
                                  <div
                                    style={{
                                      fontSize: '13px',
                                      color: '#115e59',
                                      fontWeight: 500,
                                    }}
                                  >
                                    {activeSession.currentAppleDevices.join(
                                      ', ',
                                    )}
                                  </div>
                                </div>
                              )}

                            {/* Actions */}
                            <div
                              style={{
                                display: 'flex',
                                justifyContent: 'flex-end',
                                alignItems: 'center',
                                marginTop: '16px',
                              }}
                            >
                              <Button
                                variant="primary"
                                onClick={handleConfirmPhoneStep}
                                disabled={busy || !phoneIsValid(currentPhone)}
                              >
                                <span
                                  style={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '6px',
                                  }}
                                >
                                  เริ่มบริการ
                                  <ArrowRight size={16} />
                                </span>
                              </Button>
                            </div>
                          </div>
                        ) : (
                          (activeSession.state === 'PRODUCT_SELECTION' ||
                            ['WALK_IN', 'DEMO', 'DECISION'].includes(
                              activeSession.state,
                            )) &&
                          (form === 'review' ? (
                            <>
                              {activeSession.selection.items.some((i) =>
                                isOutOfStock(i.product),
                              ) && (
                                <div style={{ marginBottom: '1rem' }}>
                                  <Notice error>
                                    มีสินค้าหมดสต็อกในรายการ
                                    กรุณากลับไปแก้ไขก่อนยืนยันการสั่งซื้อ
                                  </Notice>
                                </div>
                              )}
                              <div
                                style={{
                                  marginBottom: '1rem',
                                  padding: '1rem',
                                  background: '#f8fafc',
                                  borderRadius: '8px',
                                  border: '1px solid #e2e8f0',
                                }}
                              >
                                <label
                                  style={{
                                    display: 'block',
                                    fontWeight: 600,
                                    fontSize: '14px',
                                    marginBottom: '6px',
                                  }}
                                >
                                  เบอร์โทรศัพท์ลูกค้า
                                </label>
                                <div
                                  style={{
                                    maxWidth: '360px',
                                    marginTop: '6px',
                                  }}
                                >
                                  <PhoneInput
                                    value={currentPhone}
                                    onChange={(newPhone, valid) =>
                                      handleUpdatePhone(newPhone, valid)
                                    }
                                  />
                                </div>
                                {currentPhone &&
                                  !phoneIsValid(currentPhone) && (
                                    <p
                                      className="field-error"
                                      style={{
                                        margin: '4px 0 0 0',
                                        fontSize: '13px',
                                      }}
                                    >
                                      กรุณากรอกเบอร์โทรศัพท์ให้ถูกต้อง
                                      (เบอร์ไทยไม่ต้องใส่ 0 นำหน้า
                                      หรือเลือกประเทศสำหรับเบอร์ต่างประเทศ)
                                    </p>
                                  )}
                              </div>
                              <Summary session={activeSession} />
                              <div
                                className="actions"
                                style={{
                                  display: 'flex',
                                  justifyContent: 'flex-end',
                                  alignItems: 'center',
                                  gap: '12px',
                                  marginTop: '16px',
                                }}
                              >
                                <Button
                                  variant="secondary"
                                  onClick={() => setForm('normal')}
                                >
                                  <span
                                    style={{
                                      display: 'inline-flex',
                                      alignItems: 'center',
                                      gap: '6px',
                                    }}
                                  >
                                    <ArrowLeft size={16} /> กลับไปแก้ไข
                                  </span>
                                </Button>
                                <Button
                                  onClick={handleConfirm}
                                  disabled={
                                    !phoneIsValid(currentPhone) ||
                                    activeSession.selection.items.some((i) =>
                                      isOutOfStock(i.product),
                                    ) ||
                                    busy
                                  }
                                >
                                  <span
                                    style={{
                                      display: 'inline-flex',
                                      alignItems: 'center',
                                      gap: '6px',
                                    }}
                                  >
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
                          ))
                        )}

                        {['STOCK_REQUESTED', 'SEARCHING', 'FOUND'].includes(
                          activeSession.state,
                        ) && (
                          <>
                            <Notice>
                              <span
                                style={{
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: '6px',
                                }}
                              >
                                <Package size={16} />
                                คำขออยู่ในกระบวนการของฝ่าย Stock
                              </span>
                            </Notice>
                            <p className="muted">
                              ฝ่ายคลังกำลังจัดเตรียมสินค้า สามารถสลับไปหน้า
                              "คลังสินค้า" เพื่ออัปเดตสถานะได้
                            </p>
                            <Summary session={activeSession} />
                            <div style={{ marginTop: '16px' }}>
                              <Button
                                variant="secondary"
                                onClick={() =>
                                  setChangingItemSession(activeSession)
                                }
                              >
                                <span
                                  style={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '6px',
                                  }}
                                >
                                  <RefreshCw size={15} /> เปลี่ยนสินค้า
                                  (รุ่น/สี/ความจุ)
                                </span>
                              </Button>
                            </div>
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
                              <span
                                style={{
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: '6px',
                                }}
                              >
                                <CreditCard size={16} />
                                {activeSession.state === 'BILL_OPENED'
                                  ? `เปิดบิลใน U POS แล้ว${activeSession.posBillNo ? ` (บิล ${activeSession.posBillNo})` : ''} รอชำระเงิน`
                                  : 'ส่งของถึงแคชเชียร์แล้ว รอเปิดบิลใน U POS'}
                              </span>
                            </Notice>
                            <p className="muted">
                              แคชเชียร์ทำรายการใน U POS ระบบอัปเดตสถานะให้เอง
                              ถ้าแคชเชียร์แจ้งว่าหยิบผิด/ชำรุด กด "ส่งกลับ
                              Stock"
                            </p>
                            <Summary session={activeSession} />
                            {activeSession.state !== 'BILL_OPENED' && (
                              // D105: the cashier works in U POS and tells the staff; the staff sends the order back
                              <div style={{ marginTop: '16px' }}>
                                <Button
                                  variant="secondary"
                                  onClick={() => setForm('return')}
                                >
                                  ส่งกลับ Stock (หยิบผิด)
                                </Button>
                              </div>
                            )}
                          </>
                        )}

                        {!finished && form !== 'review' && (
                          <div
                            className="cancel-action"
                            style={{
                              marginTop: '1.5rem',
                              paddingTop: '1rem',
                              borderTop: '1px solid #e2ebe6',
                            }}
                          >
                            <Button
                              variant="danger"
                              onClick={() => setForm('cancel')}
                            >
                              ยกเลิกคำขอบริการ
                            </Button>
                          </div>
                        )}
                      </>
                    )}
                  </Panel>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
      {surveyModal && (
        <SessionSurveyModal
          session={surveyModal.session}
          target={surveyModal.target}
          onComplete={handleSurveyComplete}
        />
      )}
      {changingItemSession && (
        <ChangeItemModal
          session={changingItemSession}
          isOpen={Boolean(changingItemSession)}
          onClose={() => setChangingItemSession(null)}
          onSubmit={handleChangeItem}
        />
      )}
      {printSession &&
        createPortal(
          <ReceiptSheet session={printSession} printedAt={nowText()} />,
          document.body,
        )}
    </div>
  );
}
