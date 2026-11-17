import { useEffect, useState } from 'react';
import { CheckCircle2, ClipboardCheck, FileQuestion } from 'lucide-react';
import { Button, Modal, Notice } from '../../components/ui';
import {
  fetchSurveyQuestionsApi,
  submitSurveyResponseApi,
} from '../../services/sessionApi';
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
  const [otherTexts, setOtherTexts] = useState<Record<string, string>>({});

  useEffect(() => {
    let active = true;
    fetchSurveyQuestionsApi(target, false)
      .then((list) => {
        if (active) {
          setQuestions(list);
          const initial: Record<string, string | string[]> = {};
          const initialOthers: Record<string, string> = {};

          const existingResponse = session.surveyResponses?.find(
            (r) => r.target === target,
          );
          const existingMap = new Map<string, string | string[]>();
          if (existingResponse?.answers) {
            for (const a of existingResponse.answers) {
              existingMap.set(a.questionId, a.answer);
            }
          }

          for (const q of list) {
            const saved = existingMap.get(q.id);
            if (q.questionType === 'MULTIPLE_CHOICE') {
              if (Array.isArray(saved)) {
                const uiArr: string[] = [];
                for (const item of saved) {
                  if (item.startsWith('อื่น ๆ: ')) {
                    uiArr.push('OTHER');
                    initialOthers[q.id] = item.slice(8);
                  } else {
                    uiArr.push(item);
                  }
                }
                initial[q.id] = uiArr;
              } else {
                initial[q.id] = [];
              }
            } else if (q.questionType === 'SINGLE_CHOICE') {
              if (typeof saved === 'string' && saved.startsWith('อื่น ๆ: ')) {
                initial[q.id] = 'OTHER';
                initialOthers[q.id] = saved.slice(8);
              } else if (typeof saved === 'string') {
                initial[q.id] = saved;
              } else {
                initial[q.id] = '';
              }
            } else {
              initial[q.id] = typeof saved === 'string' ? saved : '';
            }
          }
          setAnswers(initial);
          setOtherTexts(initialOthers);
        }
      })
      .catch((err: unknown) => {
        if (active) {
          setError(
            err instanceof Error ? err.message : 'โหลดแบบสำรวจไม่สำเร็จ',
          );
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [target, session]);

  const isQuestionAnswered = (q: SurveyQuestion): boolean => {
    const val = answers[q.id];
    if (q.questionType === 'MULTIPLE_CHOICE') {
      if (!Array.isArray(val) || val.length === 0) return false;
      if (val.includes('OTHER') && !otherTexts[q.id]?.trim()) return false;
      return true;
    }
    if (val === 'OTHER') {
      return Boolean(otherTexts[q.id]?.trim());
    }
    return typeof val === 'string' && val.trim().length > 0;
  };

  const allAnswered = questions.every(
    (q) => !q.required || isQuestionAnswered(q),
  );
  const requiredNowQuestions = questions.filter((q) => q.requiredNow);
  const allRequiredNowAnswered = requiredNowQuestions.every((q) =>
    isQuestionAnswered(q),
  );

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

  const handlePostpone = async () => {
    if (!session.id) {
      onComplete();
      return;
    }

    if (!allRequiredNowAnswered) {
      setError(
        'กรุณาตอบคำถามที่จำเป็นต้อง "ตอบทันที" ให้ครบก่อนกดไว้ทำทีหลัง',
      );
      return;
    }

    setBusy(true);
    setError('');
    try {
      const answeredQuestions = questions.filter((q) => isQuestionAnswered(q));
      if (answeredQuestions.length > 0) {
        const formattedAnswers: SurveyAnswer[] = answeredQuestions.map((q) => {
          let finalAnswer: string | string[];
          const raw = answers[q.id];
          if (q.questionType === 'MULTIPLE_CHOICE') {
            const list = (raw as string[]) || [];
            finalAnswer = list.map((item) =>
              item === 'OTHER'
                ? `อื่น ๆ: ${(otherTexts[q.id] || '').trim()}`
                : item,
            );
          } else {
            finalAnswer =
              raw === 'OTHER'
                ? `อื่น ๆ: ${(otherTexts[q.id] || '').trim()}`
                : (raw as string) || '';
          }
          return {
            questionId: q.id,
            questionTitle: q.title,
            questionType: q.questionType,
            answer: finalAnswer,
          };
        });

        const res = await submitSurveyResponseApi({
          sessionId: session.id,
          target,
          answers: formattedAnswers,
          completed: false,
        });

        onComplete(res);
      } else {
        onComplete();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'บันทึกคำตอบไม่สำเร็จ');
    } finally {
      setBusy(false);
    }
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
      const formattedAnswers: SurveyAnswer[] = questions.map((q) => {
        let finalAnswer: string | string[];
        const raw = answers[q.id];
        if (q.questionType === 'MULTIPLE_CHOICE') {
          const list = (raw as string[]) || [];
          finalAnswer = list.map((item) =>
            item === 'OTHER'
              ? `อื่น ๆ: ${(otherTexts[q.id] || '').trim()}`
              : item,
          );
        } else {
          finalAnswer =
            raw === 'OTHER'
              ? `อื่น ๆ: ${(otherTexts[q.id] || '').trim()}`
              : (raw as string) || '';
        }
        return {
          questionId: q.id,
          questionTitle: q.title,
          questionType: q.questionType,
          answer: finalAnswer,
        };
      });

      const res = await submitSurveyResponseApi({
        sessionId: session.id,
        target,
        answers: formattedAnswers,
        completed: true,
      });

      onComplete(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'บันทึกแบบสำรวจไม่สำเร็จ');
    } finally {
      setBusy(false);
    }
  };

  const titleText = 'แบบสำรวจความคิดเห็นของลูกค้า';
  const modalFooter =
    !loading && questions.length > 0 ? (
      <div className="survey-modal-footer">
        <Button
          variant="secondary"
          onClick={handlePostpone}
          disabled={busy}
        >
          ไว้ทำทีหลัง
        </Button>
        <Button
          variant="primary"
          onClick={handleSubmit}
          disabled={!allAnswered || busy}
        >
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            <ClipboardCheck size={16} />
            {busy ? 'กำลังบันทึก...' : 'บันทึก'}
          </span>
        </Button>
      </div>
    ) : undefined;

  return (
    <Modal
      title={titleText}
      onClose={() => {
        if (questions.length === 0) {
          onComplete();
        } else {
          void handlePostpone();
        }
      }}
      closeOnBackdropClick={false}
      showCloseButton={false}
      closeOnEscape={false}
      footer={modalFooter}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        {error && <Notice error>{error}</Notice>}

        {loading ? (
          <p
            className="muted"
            style={{ textAlign: 'center', padding: '1.5rem 0' }}
          >
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
            <FileQuestion
              size={40}
              color="#94a3b8"
              style={{ marginBottom: '8px' }}
            />
            <h4 style={{ margin: '0 0 6px', color: '#1e293b' }}>
              ยังไม่มีคำถามแบบสำรวจ
            </h4>
            <p
              className="muted"
              style={{ margin: '0 0 16px', fontSize: '13px' }}
            >
              ยังไม่มีคำถามที่เปิดใช้งานสำหรับ
              {target === 'BUY' ? 'กรณีซื้อ' : 'กรณีไม่ซื้อ'}ในระบบ
            </p>
            <Button onClick={() => onComplete()}>ดำเนินการต่อ</Button>
          </div>
        ) : (
          <>
            <div
              style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}
            >
              <p className="muted" style={{ margin: 0, fontSize: '13px' }}>
                พนักงานสอบถามความคิดเห็นจากลูกค้าและบันทึกคำตอบลงในแบบสำรวจ
              </p>
              {questions.some((q) => q.requiredNow) && (
                <p
                  style={{
                    margin: 0,
                    fontSize: '12px',
                    color: '#b45309',
                    fontWeight: 600,
                  }}
                >
                  ข้อที่มีเครื่องหมาย &quot;ตอบทันที&quot;
                  บังคับต้องตอบก่อนกด &quot;ไว้ทำทีหลัง&quot;
                </p>
              )}
            </div>

            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '16px',
              }}
            >
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
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'flex-start',
                        justifyContent: 'space-between',
                        gap: '8px',
                        marginBottom: '6px',
                      }}
                    >
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          flexWrap: 'wrap',
                          gap: '6px',
                        }}
                      >
                        <strong
                          style={{ fontSize: '14.5px', color: '#0f172a' }}
                        >
                          {idx + 1}. {q.title}
                          {q.required && (
                            <span
                              style={{ color: '#dc2626', marginLeft: '4px' }}
                            >
                              *
                            </span>
                          )}
                        </strong>
                        {q.requiredNow && (
                          <span
                            style={{
                              fontSize: '11px',
                              background: '#fef3c7',
                              color: '#b45309',
                              padding: '2px 6px',
                              borderRadius: '4px',
                              fontWeight: 700,
                            }}
                          >
                            ตอบทันที
                          </span>
                        )}
                      </div>
                      {answered && (
                        <CheckCircle2
                          size={16}
                          color="#0d9488"
                          style={{ flexShrink: 0, marginTop: '2px' }}
                        />
                      )}
                    </div>

                    {q.description && (
                      <p
                        style={{
                          margin: '0 0 10px',
                          fontSize: '12.5px',
                          color: '#64748b',
                        }}
                      >
                        {q.description}
                      </p>
                    )}

                    {/* Single choice */}
                    {q.questionType === 'SINGLE_CHOICE' && q.options && (
                      <div
                        style={{
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '6px',
                          marginTop: '8px',
                        }}
                      >
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
                                border: isSelected
                                  ? '1.5px solid #0abab5'
                                  : '1px solid #cbd5e1',
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

                        {q.allowOther && (
                          <div
                            style={{
                              display: 'flex',
                              flexDirection: 'column',
                              gap: '6px',
                            }}
                          >
                            <button
                              type="button"
                              onClick={() => handleSingleChoice(q.id, 'OTHER')}
                              style={{
                                textAlign: 'left',
                                padding: '9px 12px',
                                borderRadius: '8px',
                                border:
                                  answers[q.id] === 'OTHER'
                                    ? '1.5px solid #0abab5'
                                    : '1px solid #cbd5e1',
                                background:
                                  answers[q.id] === 'OTHER'
                                    ? '#ccfbf1'
                                    : '#ffffff',
                                color:
                                  answers[q.id] === 'OTHER'
                                    ? '#0f766e'
                                    : '#1e293b',
                                fontWeight:
                                  answers[q.id] === 'OTHER' ? 600 : 500,
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
                                  border: `2px solid ${answers[q.id] === 'OTHER' ? '#0abab5' : '#94a3b8'}`,
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                }}
                              >
                                {answers[q.id] === 'OTHER' && (
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
                              <span>อื่น ๆ (โปรดระบุ)</span>
                            </button>
                            {answers[q.id] === 'OTHER' && (
                              <input
                                type="text"
                                placeholder="โปรดระบุรายละเอียด..."
                                value={otherTexts[q.id] || ''}
                                onChange={(e) =>
                                  setOtherTexts({
                                    ...otherTexts,
                                    [q.id]: e.target.value,
                                  })
                                }
                                style={{
                                  padding: '8px 12px',
                                  borderRadius: '6px',
                                  border: '1.5px solid #0abab5',
                                  fontSize: '13px',
                                  width: '100%',
                                  boxSizing: 'border-box',
                                  backgroundColor: '#f0fdfa',
                                }}
                                autoFocus
                              />
                            )}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Multiple choice */}
                    {q.questionType === 'MULTIPLE_CHOICE' && q.options && (
                      <div
                        style={{
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '6px',
                          marginTop: '8px',
                        }}
                      >
                        {q.options.map((opt) => {
                          const isSelected = (
                            (answers[q.id] as string[]) || []
                          ).includes(opt);
                          return (
                            <button
                              key={opt}
                              type="button"
                              onClick={() =>
                                handleToggleMultipleChoice(q.id, opt)
                              }
                              style={{
                                textAlign: 'left',
                                padding: '9px 12px',
                                borderRadius: '8px',
                                border: isSelected
                                  ? '1.5px solid #0abab5'
                                  : '1px solid #cbd5e1',
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
                                  background: isSelected
                                    ? '#0abab5'
                                    : '#ffffff',
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

                        {q.allowOther && (
                          <div
                            style={{
                              display: 'flex',
                              flexDirection: 'column',
                              gap: '6px',
                            }}
                          >
                            <button
                              type="button"
                              onClick={() =>
                                handleToggleMultipleChoice(q.id, 'OTHER')
                              }
                              style={{
                                textAlign: 'left',
                                padding: '9px 12px',
                                borderRadius: '8px',
                                border: (
                                  (answers[q.id] as string[]) || []
                                ).includes('OTHER')
                                  ? '1.5px solid #0abab5'
                                  : '1px solid #cbd5e1',
                                background: (
                                  (answers[q.id] as string[]) || []
                                ).includes('OTHER')
                                  ? '#ccfbf1'
                                  : '#ffffff',
                                color: (
                                  (answers[q.id] as string[]) || []
                                ).includes('OTHER')
                                  ? '#0f766e'
                                  : '#1e293b',
                                fontWeight: (
                                  (answers[q.id] as string[]) || []
                                ).includes('OTHER')
                                  ? 600
                                  : 500,
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
                                  border: `2px solid ${
                                    (
                                      (answers[q.id] as string[]) || []
                                    ).includes('OTHER')
                                      ? '#0abab5'
                                      : '#94a3b8'
                                  }`,
                                  background: (
                                    (answers[q.id] as string[]) || []
                                  ).includes('OTHER')
                                    ? '#0abab5'
                                    : '#ffffff',
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                }}
                              >
                                {((answers[q.id] as string[]) || []).includes(
                                  'OTHER',
                                ) && (
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
                              <span>อื่น ๆ (โปรดระบุ)</span>
                            </button>
                            {((answers[q.id] as string[]) || []).includes(
                              'OTHER',
                            ) && (
                              <input
                                type="text"
                                placeholder="โปรดระบุรายละเอียด..."
                                value={otherTexts[q.id] || ''}
                                onChange={(e) =>
                                  setOtherTexts({
                                    ...otherTexts,
                                    [q.id]: e.target.value,
                                  })
                                }
                                style={{
                                  padding: '8px 12px',
                                  borderRadius: '6px',
                                  border: '1.5px solid #0abab5',
                                  fontSize: '13px',
                                  width: '100%',
                                  boxSizing: 'border-box',
                                  backgroundColor: '#f0fdfa',
                                }}
                                autoFocus
                              />
                            )}
                          </div>
                        )}
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
          </>
        )}
      </div>
    </Modal>
  );
}
