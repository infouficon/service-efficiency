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
  const [activeTab, setActiveTab] = useState<'pending' | 'completed'>('pending');
  const [search, setSearch] = useState('');
  const [surveyModal, setSurveyModal] = useState<{
    session: MockSession;
    target: SurveyTarget;
  } | null>(null);
  const [viewingResponseSession, setViewingResponseSession] = useState<MockSession | null>(null);

  // Eligible branch sessions for today that reached survey point
  const eligibleSessions = useMemo(() => {
    return sessions.filter((s) => {
      const matchesBranch =
        user.roles.includes('ADMIN') || s.branchCode === (user.branchCode ?? '');
      if (!matchesBranch || !isTodaySession(s)) return false;

      const isCancelled =
        s.outcome === 'CUSTOMER_CANCELLED' || Boolean(s.timestamps.cancelled_at);
      const isBought =
        s.confirmed || Boolean(s.timestamps.product_selection_confirmed_at) || s.state === 'COMPLETED';

      return isCancelled || isBought;
    });
  }, [sessions, user]);

  const { pendingList, completedList } = useMemo(() => {
    const pending: { session: MockSession; target: SurveyTarget }[] = [];
    const completed: { session: MockSession; target: SurveyTarget }[] = [];

    for (const s of eligibleSessions) {
      const isCancelled =
        s.outcome === 'CUSTOMER_CANCELLED' || Boolean(s.timestamps.cancelled_at);
      const target: SurveyTarget = isCancelled ? 'NOT_BUY' : 'BUY';
      const hasSurvey = s.surveyResponses && s.surveyResponses.length > 0;

      if (hasSurvey) {
        completed.push({ session: s, target });
      } else {
        pending.push({ session: s, target });
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
      const existing = surveyModal.session.surveyResponses ?? [];
      const updatedS: MockSession = {
        ...surveyModal.session,
        surveyResponses: [...existing, response],
      };
      onUpdateSession(updatedS);
      toast.success('บันทึกผลการทำแบบสำรวจสำเร็จ');
    }
    setSurveyModal(null);
  };

  const formatTime = (isoString?: string) => {
    if (!isoString) return '-';
    try {
      const d = new Date(isoString);
      return d.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
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
            รายการแบบสำรวจความคิดเห็นของลูกค้าประจำวันสำหรับพนักงาน (สาขา {user.branch})
          </p>
        </div>

        {/* Counters */}
        <div style={{ display: 'flex', gap: '10px' }}>
          <div
            style={{
              padding: '8px 16px',
              borderRadius: '8px',
              background: '#fef2f2',
              border: '1px solid #fee2e2',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
            }}
          >
            <AlertCircle size={18} color="#dc2626" />
            <div>
              <div style={{ fontSize: '11px', color: '#991b1b', fontWeight: 600 }}>ค้างทำ</div>
              <div style={{ fontSize: '18px', fontWeight: 700, color: '#dc2626', lineHeight: 1 }}>
                {pendingList.length}
              </div>
            </div>
          </div>

          <div
            style={{
              padding: '8px 16px',
              borderRadius: '8px',
              background: '#f0fdf4',
              border: '1px solid #dcfce7',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
            }}
          >
            <CheckCircle2 size={18} color="#16a34a" />
            <div>
              <div style={{ fontSize: '11px', color: '#166534', fontWeight: 600 }}>ทำแล้ว</div>
              <div style={{ fontSize: '18px', fontWeight: 700, color: '#16a34a', lineHeight: 1 }}>
                {completedList.length}
              </div>
            </div>
          </div>
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
          {/* Tabs */}
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              type="button"
              onClick={() => setActiveTab('pending')}
              style={{
                padding: '8px 16px',
                borderRadius: '8px',
                border: 'none',
                background: activeTab === 'pending' ? '#0f766e' : '#f1f5f9',
                color: activeTab === 'pending' ? '#ffffff' : '#475569',
                fontWeight: 600,
                fontSize: '13.5px',
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '8px',
                transition: 'all 0.2s',
              }}
            >
              <span>ค้างทำ (Pending)</span>
              {pendingList.length > 0 && (
                <span
                  style={{
                    backgroundColor: activeTab === 'pending' ? '#ffffff' : '#dc2626',
                    color: activeTab === 'pending' ? '#0f766e' : '#ffffff',
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
              onClick={() => setActiveTab('completed')}
              style={{
                padding: '8px 16px',
                borderRadius: '8px',
                border: 'none',
                background: activeTab === 'completed' ? '#0f766e' : '#f1f5f9',
                color: activeTab === 'completed' ? '#ffffff' : '#475569',
                fontWeight: 600,
                fontSize: '13.5px',
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '8px',
                transition: 'all 0.2s',
              }}
            >
              <span>ทำแล้ว (Completed)</span>
              <span
                style={{
                  backgroundColor: activeTab === 'completed' ? '#ffffff' : '#cbd5e1',
                  color: activeTab === 'completed' ? '#0f766e' : '#334155',
                  padding: '2px 7px',
                  borderRadius: '9999px',
                  fontSize: '11px',
                  fontWeight: 700,
                }}
              >
                {completedList.length}
              </span>
            </button>
          </div>

          {/* Search */}
          <div style={{ position: 'relative', width: '260px' }}>
            <Search
              size={15}
              color="#94a3b8"
              style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)' }}
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
          <div style={{ textAlign: 'center', padding: '3rem 1rem', color: '#64748b' }}>
            <FileCheck2 size={44} color="#cbd5e1" style={{ marginBottom: '10px' }} />
            <h4 style={{ margin: '0 0 6px', color: '#334155' }}>
              {activeTab === 'pending' ? 'ไม่มีแบบสำรวจที่ค้างทำ' : 'ยังไม่มีแบบสำรวจที่ทำแล้ว'}
            </h4>
            <p className="muted" style={{ margin: 0, fontSize: '13px' }}>
              {activeTab === 'pending'
                ? 'ลูกค้าทุกคนในสาขาวันนี้ทำแบบสำรวจครบถ้วนแล้ว'
                : 'เมื่อพนักงานทำแบบสำรวจ รายการจะปรากฏที่นี่'}
            </p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {filteredItems.map(({ session, target }) => {
              const isBuy = target === 'BUY';
              const timeStr = formatTime(session.timestamps.customer_walk_in_at);

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
                  <div style={{ display: 'flex', alignItems: 'center', gap: '14px', flexWrap: 'wrap' }}>
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

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
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
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', fontSize: '12px', color: '#64748b' }}>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
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
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                          <ClipboardList size={15} />
                          ทำแบบสำรวจ
                        </span>
                      </Button>
                    ) : (
                      <Button
                        variant="secondary"
                        onClick={() => setViewingResponseSession(session)}
                      >
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
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
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div style={{ fontSize: '13px', color: '#64748b', borderBottom: '1px solid #e2e8f0', paddingBottom: '8px' }}>
              <div>เบอร์โทร: <strong>{viewingResponseSession.phone || '-'}</strong></div>
              <div>เวลาที่บันทึก: <strong>{viewingResponseSession.surveyResponses?.[0]?.createdAt ? new Date(viewingResponseSession.surveyResponses[0].createdAt).toLocaleString('th-TH') : '-'}</strong></div>
            </div>

            {viewingResponseSession.surveyResponses && viewingResponseSession.surveyResponses.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', maxHeight: '60vh', overflowY: 'auto' }}>
                {viewingResponseSession.surveyResponses[0].answers.map((ans, idx) => (
                  <div
                    key={idx}
                    style={{
                      background: '#f8fafc',
                      borderRadius: '8px',
                      padding: '10px 12px',
                      border: '1px solid #e2e8f0',
                    }}
                  >
                    <div style={{ fontSize: '13.5px', fontWeight: 600, color: '#0f172a', marginBottom: '4px' }}>
                      {idx + 1}. {ans.questionTitle}
                    </div>
                    <div style={{ fontSize: '13px', color: '#0f766e', fontWeight: 500 }}>
                      {Array.isArray(ans.answer) ? ans.answer.join(', ') : ans.answer}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="muted" style={{ textAlign: 'center' }}>ไม่มีข้อมูลแบบสำรวจ</p>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '10px' }}>
              <Button onClick={() => setViewingResponseSession(null)}>ปิด</Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
