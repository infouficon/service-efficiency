import { useEffect, useState } from 'react';
import { CheckCircle2, ClipboardCheck, FileQuestion } from 'lucide-react';
import { Button, Modal, Notice } from '../../components/ui';
import { fetchSurveyQuestionsApi, submitSurveyResponseApi } from '../../services/sessionApi';
import type {
  MockSession,
  SurveyAnswer,
  SurveyQuestion,
  SurveyResponseItem,
  SurveyTarget,
} from '../../types/session';

interface SessionSurveyModalProps {
  session: MockSession;
  target: SurveyTarget;
  onComplete: (surveyResponse?: SurveyResponseItem) => void;
}

export function SessionSurveyModal({
  session,
  target,
  onComplete,
}: SessionSurveyModalProps) {
  const [questions, setQuestions] = useState<SurveyQuestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [answers, setAnswers] = useState<Record<string, string | string[]>>({});

  useEffect(() => {
    let active = true;
    fetchSurveyQuestionsApi(target, false)
      .then((list) => {
        if (active) {
          setQuestions(list);
          const initial: Record<string, string | string[]> = {};
          for (const q of list) {
            if (q.questionType === 'MULTIPLE_CHOICE') {
              initial[q.id] = [];
            } else {
              initial[q.id] = '';
            }
          }
          setAnswers(initial);
        }
      })
      .catch((err: unknown) => {
        if (active) {
          setError(err instanceof Error ? err.message : 'โหลดแบบสำรวจไม่สำเร็จ');
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [target]);

  const isQuestionAnswered = (q: SurveyQuestion): boolean => {
    const val = answers[q.id];
    if (q.questionType === 'MULTIPLE_CHOICE') {
      return Array.isArray(val) && val.length > 0;
    }
    return typeof val === 'string' && val.trim().length > 0;
  };

  const allAnswered = questions.every((q) => !q.required || isQuestionAnswered(q));

  const handleToggleMultipleChoice = (qId: string, opt: string) => {
    const current = (answers[qId] as string[]) || [];
    const next = current.includes(opt)
      ? current.filter((x) => x !== opt)
      : [...current, opt];
    setAnswers((prev) => ({ ...prev, [qId]: next }));
  };

  const handleSingleChoice = (qId: string, opt: string) => {
    setAnswers((prev) => ({ ...prev, [qId]: opt }));
  };

  const handleTextChange = (qId: string, text: string) => {
    setAnswers((prev) => ({ ...prev, [qId]: text }));
  };

  const handleSubmit = async () => {
    if (!session.id) {
      onComplete();
      return;
    }

    if (!allAnswered) {
      setError('กรุณาตอบคำถามให้ครบทุกข้อก่อนดำเนินการต่อ');
      return;
    }

    setBusy(true);
    setError('');
    try {
      const formattedAnswers: SurveyAnswer[] = questions.map((q) => ({
        questionId: q.id,
        questionTitle: q.title,
        questionType: q.questionType,
        answer: answers[q.id] ?? (q.questionType === 'MULTIPLE_CHOICE' ? [] : ''),
      }));

      const res = await submitSurveyResponseApi({
        sessionId: session.id,
        target,
        answers: formattedAnswers,
      });

      onComplete(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'บันทึกแบบสำรวจไม่สำเร็จ');
    } finally {
      setBusy(false);
    }
  };

  const titleText =
    target === 'BUY'
      ? 'แบบสำรวจความคิดเห็นของลูกค้า (กรณีสั่งซื้อ)'
      : 'แบบสำรวจความคิดเห็นของลูกค้า (กรณีไม่ซื้อ / ยกเลิกคำขอ)';

  return (
    <Modal title={titleText} onClose={() => {}}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        {error && <Notice error>{error}</Notice>}

        {loading ? (
          <p className="muted" style={{ textAlign: 'center', padding: '1.5rem 0' }}>
            กำลังโหลดแบบสำรวจ...
          </p>
        ) : questions.length === 0 ? (
          <div
            style={{
              textAlign: 'center',
              padding: '2rem 1rem',
              background: '#f8fafc',
              borderRadius: '10px',
              border: '1px solid #e2e8f0',
            }}
          >
            <FileQuestion size={40} color="#94a3b8" style={{ marginBottom: '8px' }} />
            <h4 style={{ margin: '0 0 6px', color: '#1e293b' }}>ยังไม่มีคำถามแบบสำรวจ</h4>
            <p className="muted" style={{ margin: '0 0 16px', fontSize: '13px' }}>
              ยังไม่มีคำถามที่เปิดใช้งานสำหรับ{target === 'BUY' ? 'กรณีซื้อ' : 'กรณีไม่ซื้อ'}ในระบบ
            </p>
            <Button onClick={() => onComplete()}>ดำเนินการต่อ</Button>
          </div>
        ) : (
          <>
            <p className="muted" style={{ margin: 0, fontSize: '13px' }}>
              พนักงานสอบถามความคิดเห็นจากลูกค้าและบันทึกคำตอบลงในแบบสำรวจ (จำเป็นต้องตอบทุกข้อ)
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', maxHeight: '60vh', overflowY: 'auto', paddingRight: '4px' }}>
              {questions.map((q, idx) => {
                const answered = isQuestionAnswered(q);
                return (
                  <div
                    key={q.id}
                    style={{
                      background: answered ? '#f0fdfa' : '#ffffff',
                      border: `1.5px solid ${answered ? '#0abab5' : '#e2e8f0'}`,
                      borderRadius: '10px',
                      padding: '14px',
                      transition: 'all 0.2s ease',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '8px', marginBottom: '6px' }}>
                      <strong style={{ fontSize: '14.5px', color: '#0f172a' }}>
                        {idx + 1}. {q.title}
                        {q.required && <span style={{ color: '#dc2626', marginLeft: '4px' }}>*</span>}
                      </strong>
                      {answered && <CheckCircle2 size={16} color="#0d9488" style={{ flexShrink: 0, marginTop: '2px' }} />}
                    </div>

                    {q.description && (
                      <p style={{ margin: '0 0 10px', fontSize: '12.5px', color: '#64748b' }}>
                        {q.description}
                      </p>
                    )}

                    {/* Single choice */}
                    {q.questionType === 'SINGLE_CHOICE' && q.options && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '8px' }}>
                        {q.options.map((opt) => {
                          const isSelected = answers[q.id] === opt;
                          return (
                            <button
                              key={opt}
                              type="button"
                              onClick={() => handleSingleChoice(q.id, opt)}
                              style={{
                                textAlign: 'left',
                                padding: '9px 12px',
                                borderRadius: '8px',
                                border: isSelected ? '1.5px solid #0abab5' : '1px solid #cbd5e1',
                                background: isSelected ? '#ccfbf1' : '#ffffff',
                                color: isSelected ? '#0f766e' : '#1e293b',
                                fontWeight: isSelected ? 600 : 500,
                                fontSize: '13.5px',
                                cursor: 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '8px',
                              }}
                            >
                              <span
                                style={{
                                  width: '14px',
                                  height: '14px',
                                  borderRadius: '50%',
                                  border: `2px solid ${isSelected ? '#0abab5' : '#94a3b8'}`,
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                }}
                              >
                                {isSelected && (
                                  <span
                                    style={{
                                      width: '6px',
                                      height: '6px',
                                      borderRadius: '50%',
                                      background: '#0abab5',
                                    }}
                                  />
                                )}
                              </span>
                              <span>{opt}</span>
                            </button>
                          );
                        })}
                      </div>
                    )}

                    {/* Multiple choice */}
                    {q.questionType === 'MULTIPLE_CHOICE' && q.options && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '8px' }}>
                        {q.options.map((opt) => {
                          const isSelected = (
                            (answers[q.id] as string[]) || []
                          ).includes(opt);
                          return (
                            <button
                              key={opt}
                              type="button"
                              onClick={() => handleToggleMultipleChoice(q.id, opt)}
                              style={{
                                textAlign: 'left',
                                padding: '9px 12px',
                                borderRadius: '8px',
                                border: isSelected ? '1.5px solid #0abab5' : '1px solid #cbd5e1',
                                background: isSelected ? '#ccfbf1' : '#ffffff',
                                color: isSelected ? '#0f766e' : '#1e293b',
                                fontWeight: isSelected ? 600 : 500,
                                fontSize: '13.5px',
                                cursor: 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '8px',
                              }}
                            >
                              <span
                                style={{
                                  width: '14px',
                                  height: '14px',
                                  borderRadius: '3px',
                                  border: `2px solid ${isSelected ? '#0abab5' : '#94a3b8'}`,
                                  background: isSelected ? '#0abab5' : '#ffffff',
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                }}
                              >
                                {isSelected && (
                                  <span
                                    style={{
                                      color: '#ffffff',
                                      fontSize: '10px',
                                      lineHeight: 1,
                                      fontWeight: 700,
                                    }}
                                  >
                                    ✓
                                  </span>
                                )}
                              </span>
                              <span>{opt}</span>
                            </button>
                          );
                        })}
                      </div>
                    )}

                    {/* Text */}
                    {q.questionType === 'TEXT' && (
                      <textarea
                        rows={3}
                        placeholder="กรอกคำตอบหรือความคิดเห็นของลูกค้า..."
                        value={(answers[q.id] as string) || ''}
                        onChange={(e) => handleTextChange(q.id, e.target.value)}
                        style={{
                          width: '100%',
                          marginTop: '8px',
                          padding: '8px 10px',
                          borderRadius: '8px',
                          border: '1px solid #cbd5e1',
                          fontSize: '13.5px',
                          fontFamily: 'inherit',
                          boxSizing: 'border-box',
                        }}
                      />
                    )}
                  </div>
                );
              })}
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '10px' }}>
              <Button
                variant="primary"
                onClick={handleSubmit}
                disabled={!allAnswered || busy}
              >
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                  <ClipboardCheck size={16} />
                  {busy ? 'กำลังบันทึก...' : 'บันทึก'}
                </span>
              </Button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
