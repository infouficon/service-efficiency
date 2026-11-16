import { useState, useMemo } from 'react';
import {
  ClipboardList,
  CheckCircle2,
  Clock,
  Phone,
  Search,
  Eye,
  AlertCircle,
  FileCheck2,
} from 'lucide-react';
import { Button, Modal, Panel } from '../../components/ui';
import { useToast } from '../../components/Toast';
import { SessionSurveyModal } from '../session/SessionSurveyModal';
import type {
  MockSession,
  MockUser,
  SurveyResponseItem,
  SurveyTarget,
} from '../../types/session';

interface SurveyWorkspaceProps {
  sessions: MockSession[];
  user: MockUser;
  onUpdateSession: (session: MockSession) => void;
}

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

  return true;
}

export function SurveyWorkspace({
  sessions,
  user,
  onUpdateSession,
}: SurveyWorkspaceProps) {
  const toast = useToast();
  const [activeTab, setActiveTab] = useState<'pending' | 'completed'>(
    'pending',
  );
  const [search, setSearch] = useState('');
  const [surveyModal, setSurveyModal] = useState<{
    session: MockSession;
    target: SurveyTarget;
  } | null>(null);
  const [viewingResponseSession, setViewingResponseSession] =
    useState<MockSession | null>(null);

  // Eligible branch sessions for today that reached survey point
  const eligibleSessions = useMemo(() => {
    return sessions.filter((s) => {
      const matchesBranch =
        user.roles.includes('ADMIN') ||
        s.branchCode === (user.branchCode ?? '');
      if (!matchesBranch || !isTodaySession(s)) return false;

      const isCancelled =
        s.outcome === 'CUSTOMER_CANCELLED' ||
        Boolean(s.timestamps.cancelled_at);
      const isBought =
        s.confirmed ||
        Boolean(s.timestamps.product_selection_confirmed_at) ||
        s.state === 'COMPLETED';

      return isCancelled || isBought;
    });
  }, [sessions, user]);

  const { pendingList, completedList } = useMemo(() => {
    const pending: {
      session: MockSession;
      target: SurveyTarget;
      isPartial?: boolean;
    }[] = [];
    const completed: {
      session: MockSession;
      target: SurveyTarget;
      isPartial?: boolean;
    }[] = [];

    for (const s of eligibleSessions) {
      const isCancelled =
        s.outcome === 'CUSTOMER_CANCELLED' ||
        Boolean(s.timestamps.cancelled_at);
      const target: SurveyTarget = isCancelled ? 'NOT_BUY' : 'BUY';
      const existing = s.surveyResponses?.find((r) => r.target === target);

      if (existing && existing.completed !== false) {
        completed.push({ session: s, target });
      } else {
        const isPartial = existing?.completed === false;
        pending.push({ session: s, target, isPartial });
      }
    }

    return { pendingList: pending, completedList: completed };
  }, [eligibleSessions]);

  const filteredItems = useMemo(() => {
    const list = activeTab === 'pending' ? pendingList : completedList;
    if (!search.trim()) return list;

    const query = search.trim().toLowerCase();
    return list.filter(({ session }) => {
      const phone = session.phone || '';
      const ref = session.reference || '';
      const queue = session.queue || '';
      const staff = session.staffId || '';
      return (
        phone.toLowerCase().includes(query) ||
        ref.toLowerCase().includes(query) ||
        queue.toLowerCase().includes(query) ||
        staff.toLowerCase().includes(query)
      );
    });
  }, [activeTab, pendingList, completedList, search]);

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
      toast.success(
        response.completed === false
          ? 'บันทึกคำตอบเบื้องต้นแล้ว (ค้างทำแบบสำรวจต่อในภายหลัง)'
          : 'บันทึกผลการทำแบบสำรวจสำเร็จ',
      );
    }
    setSurveyModal(null);
  };

  const formatTime = (isoString?: string) => {
    if (!isoString) return '-';
    try {
      const d = new Date(isoString);
      return d.toLocaleTimeString('th-TH', {
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return '-';
    }
  };

  return (
    <div style={{ padding: '16px', maxWidth: '1200px', margin: '0 auto' }}>
      {/* Header */}
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '12px',
          marginBottom: '20px',
        }}
      >
        <div>
          <h2
            style={{
              margin: '0 0 4px',
              fontSize: '20px',
              fontWeight: 700,
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              color: '#0f172a',
            }}
          >
            <ClipboardList size={22} color="#0f766e" />
            แบบสำรวจลูกค้า (Customer Surveys)
          </h2>
          <p className="muted" style={{ margin: 0, fontSize: '13px' }}>
            รายการแบบสำรวจความคิดเห็นของลูกค้าประจำวันสำหรับพนักงาน (สาขา{' '}
            {user.branch})
          </p>
        </div>
      </div>

      {/* Main Panel */}
      <Panel>
        {/* Tabs & Search */}
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '12px',
            marginBottom: '16px',
            borderBottom: '1px solid #e2e8f0',
            paddingBottom: '12px',
          }}
        >
          {/* Segmented Control Mode Toggle */}
          <div
            role="tablist"
            aria-label="เลือกโหมดแบบสำรวจ"
            style={{
              display: 'inline-flex',
              backgroundColor: '#f1f5f9',
              padding: '3px',
              borderRadius: '10px',
              border: '1px solid #e2e8f0',
            }}
          >
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'pending'}
              onClick={() => setActiveTab('pending')}
              style={{
                padding: '7px 16px',
                borderRadius: '8px',
                border: 'none',
                background: activeTab === 'pending' ? '#ffffff' : 'transparent',
                color: activeTab === 'pending' ? '#0f172a' : '#64748b',
                fontWeight: activeTab === 'pending' ? 700 : 500,
                fontSize: '13.5px',
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '8px',
                boxShadow:
                  activeTab === 'pending'
                    ? '0 1px 3px rgba(0, 0, 0, 0.08), 0 1px 2px rgba(0, 0, 0, 0.04)'
                    : 'none',
                transition: 'all 0.15s ease',
              }}
            >
              <span>ค้างทำ</span>
              {pendingList.length > 0 && (
                <span
                  style={{
                    backgroundColor:
                      activeTab === 'pending' ? '#fee2e2' : '#e2e8f0',
                    color: activeTab === 'pending' ? '#dc2626' : '#64748b',
                    padding: '2px 7px',
                    borderRadius: '9999px',
                    fontSize: '11px',
                    fontWeight: 700,
                  }}
                >
                  {pendingList.length}
                </span>
              )}
            </button>

            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'completed'}
              onClick={() => setActiveTab('completed')}
              style={{
                padding: '7px 16px',
                borderRadius: '8px',
                border: 'none',
                background:
                  activeTab === 'completed' ? '#ffffff' : 'transparent',
                color: activeTab === 'completed' ? '#0f172a' : '#64748b',
                fontWeight: activeTab === 'completed' ? 700 : 500,
                fontSize: '13.5px',
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '8px',
                boxShadow:
                  activeTab === 'completed'
                    ? '0 1px 3px rgba(0, 0, 0, 0.08), 0 1px 2px rgba(0, 0, 0, 0.04)'
                    : 'none',
                transition: 'all 0.15s ease',
              }}
            >
              <span>ทำแล้ว</span>
            </button>
          </div>

          {/* Search */}
          <div style={{ position: 'relative', width: '260px' }}>
            <Search
              size={15}
              color="#94a3b8"
              style={{
                position: 'absolute',
                left: '10px',
                top: '50%',
                transform: 'translateY(-50%)',
              }}
            />
            <input
              type="text"
              placeholder="ค้นหาเบอร์โทร, คิว, พนักงาน..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{
                width: '100%',
                padding: '7px 10px 7px 32px',
                borderRadius: '6px',
                border: '1px solid #cbd5e1',
                fontSize: '13px',
                boxSizing: 'border-box',
              }}
            />
          </div>
        </div>

        {/* List Table / Cards */}
        {filteredItems.length === 0 ? (
          <div
            style={{
              textAlign: 'center',
              padding: '3rem 1rem',
              color: '#64748b',
            }}
          >
            <FileCheck2
              size={44}
              color="#cbd5e1"
              style={{ marginBottom: '10px' }}
            />
            <h4 style={{ margin: '0 0 6px', color: '#334155' }}>
              {activeTab === 'pending'
                ? 'ไม่มีแบบสำรวจที่ค้างทำ'
                : 'ยังไม่มีแบบสำรวจที่ทำแล้ว'}
            </h4>
            <p className="muted" style={{ margin: 0, fontSize: '13px' }}>
              {activeTab === 'pending'
                ? 'ลูกค้าทุกคนในสาขาวันนี้ทำแบบสำรวจครบถ้วนแล้ว'
                : 'เมื่อพนักงานทำแบบสำรวจ รายการจะปรากฏที่นี่'}
            </p>
          </div>
        ) : (
          <div
            style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}
          >
            {filteredItems.map(({ session, target, isPartial }) => {
              const isBuy = target === 'BUY';
              const timeStr = formatTime(
                session.timestamps.customer_walk_in_at,
              );

              return (
                <div
                  key={session.id || session.reference}
                  style={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '12px',
                    padding: '14px 16px',
                    borderRadius: '8px',
                    border: '1px solid #e2e8f0',
                    background: '#ffffff',
                    transition: 'box-shadow 0.15s ease',
                  }}
                >
                  {/* Left: Queue, Phone, Target */}
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '14px',
                      flexWrap: 'wrap',
                    }}
                  >
                    <div
                      style={{
                        padding: '4px 10px',
                        background: '#f1f5f9',
                        borderRadius: '6px',
                        fontWeight: 700,
                        fontSize: '14px',
                        color: '#0f172a',
                        minWidth: '55px',
                        textAlign: 'center',
                      }}
                    >
                      {session.queue || session.reference.slice(-4)}
                    </div>

                    <div
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '2px',
                      }}
                    >
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '8px',
                        }}
                      >
                        <span
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '4px',
                            fontWeight: 600,
                            fontSize: '14px',
                            color: '#1e293b',
                          }}
                        >
                          <Phone size={13} color="#64748b" />
                          {session.phone || 'ไม่ระบุเบอร์'}
                        </span>

                        <span
                          style={{
                            fontSize: '11px',
                            padding: '2px 8px',
                            borderRadius: '4px',
                            fontWeight: 600,
                            background: isBuy ? '#dcfce7' : '#fee2e2',
                            color: isBuy ? '#166534' : '#991b1b',
                          }}
                        >
                          {isBuy ? 'ซื้อสินค้า' : 'ไม่ซื้อ / ยกเลิก'}
                        </span>

                        {isPartial && (
                          <span
                            style={{
                              fontSize: '11px',
                              padding: '2px 8px',
                              borderRadius: '4px',
                              fontWeight: 600,
                              background: '#fef3c7',
                              color: '#b45309',
                            }}
                          >
                            ตอบบางส่วนแล้ว
                          </span>
                        )}
                      </div>

                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '12px',
                          fontSize: '12px',
                          color: '#64748b',
                        }}
                      >
                        <span
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '4px',
                          }}
                        >
                          <Clock size={12} /> {timeStr} น.
                        </span>
                        <span>ผู้รับผิดชอบ: {session.staffId}</span>
                      </div>
                    </div>
                  </div>

                  {/* Right Action Button */}
                  <div>
                    {activeTab === 'pending' ? (
                      <Button
                        variant="primary"
                        onClick={() => setSurveyModal({ session, target })}
                      >
                        <span
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '6px',
                          }}
                        >
                          <ClipboardList size={15} />
                          {isPartial ? 'ทำแบบสำรวจต่อ' : 'ทำแบบสำรวจ'}
                        </span>
                      </Button>
                    ) : (
                      <Button
                        variant="secondary"
                        onClick={() => setViewingResponseSession(session)}
                      >
                        <span
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '6px',
                          }}
                        >
                          <Eye size={15} />
                          ดูผลสำรวจ
                        </span>
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Panel>

      {/* Survey Modal */}
      {surveyModal && (
        <SessionSurveyModal
          session={surveyModal.session}
          target={surveyModal.target}
          onComplete={handleSurveyComplete}
        />
      )}

      {/* View Survey Responses Modal */}
      {viewingResponseSession && (
        <Modal
          title={`ผลการทำแบบสำรวจ - คิว ${viewingResponseSession.queue || viewingResponseSession.reference}`}
          onClose={() => setViewingResponseSession(null)}
        >
          <div
            style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}
          >
            <div
              style={{
                fontSize: '13px',
                color: '#64748b',
                borderBottom: '1px solid #e2e8f0',
                paddingBottom: '8px',
              }}
            >
              <div>
                เบอร์โทร: <strong>{viewingResponseSession.phone || '-'}</strong>
              </div>
              <div>
                เวลาที่บันทึก:{' '}
                <strong>
                  {viewingResponseSession.surveyResponses?.[0]?.createdAt
                    ? new Date(
                        viewingResponseSession.surveyResponses[0].createdAt,
                      ).toLocaleString('th-TH')
                    : '-'}
                </strong>
              </div>
            </div>

            {viewingResponseSession.surveyResponses &&
            viewingResponseSession.surveyResponses.length > 0 ? (
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '12px',
                  maxHeight: '60vh',
                  overflowY: 'auto',
                }}
              >
                {viewingResponseSession.surveyResponses[0].answers.map(
                  (ans, idx) => (
                    <div
                      key={idx}
                      style={{
                        background: '#f8fafc',
                        borderRadius: '8px',
                        padding: '10px 12px',
                        border: '1px solid #e2e8f0',
                      }}
                    >
                      <div
                        style={{
                          fontSize: '13.5px',
                          fontWeight: 600,
                          color: '#0f172a',
                          marginBottom: '4px',
                        }}
                      >
                        {idx + 1}. {ans.questionTitle}
                      </div>
                      <div
                        style={{
                          fontSize: '13px',
                          color: '#0f766e',
                          fontWeight: 500,
                        }}
                      >
                        {Array.isArray(ans.answer)
                          ? ans.answer.join(', ')
                          : ans.answer}
                      </div>
                    </div>
                  ),
                )}
              </div>
            ) : (
              <p className="muted" style={{ textAlign: 'center' }}>
                ไม่มีข้อมูลแบบสำรวจ
              </p>
            )}

            <div
              style={{
                display: 'flex',
                justifyContent: 'flex-end',
                marginTop: '10px',
              }}
            >
              <Button onClick={() => setViewingResponseSession(null)}>
                ปิด
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
