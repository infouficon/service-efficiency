import { useCallback, useEffect, useState } from 'react';
import {
  Download,
  Edit2,
  FileQuestion,
  GripVertical,
  Plus,
  Trash2,
  X,
} from 'lucide-react';
import { Button, Modal, Notice, Panel } from '../../components/ui';
import { useToast } from '../../components/Toast';
import {
  createSurveyQuestionApi,
  deleteSurveyQuestionApi,
  fetchSurveyQuestionsApi,
  reorderSurveyQuestionsApi,
  updateSurveyQuestionApi,
} from '../../services/sessionApi';
import type {
  SurveyQuestion,
  SurveyQuestionType,
  SurveyTarget,
} from '../../types/session';

interface QuestionFormState {
  id?: string;
  target: SurveyTarget;
  title: string;
  description: string;
  questionType: SurveyQuestionType;
  options: string[];
  allowOther: boolean;
  required: boolean;
  active: boolean;
}

const DEFAULT_FORM: QuestionFormState = {
  target: 'BUY',
  title: '',
  description: '',
  questionType: 'SINGLE_CHOICE',
  options: [''],
  allowOther: false,
  required: true,
  active: true,
};

const TYPE_LABELS: Record<SurveyQuestionType, string> = {
  SINGLE_CHOICE: 'เลือกตอบข้อเดียว (Single choice)',
  MULTIPLE_CHOICE: 'เลือกตอบหลายข้อ (Multiple choice)',
  TEXT: 'พิมพ์ข้อความ (Text)',
};

export function SurveyManagementPanel() {
  const toast = useToast();
  const [target, setTarget] = useState<SurveyTarget>('BUY');
  const [questions, setQuestions] = useState<SurveyQuestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState<QuestionFormState>(DEFAULT_FORM);
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [canDrag, setCanDrag] = useState(false);

  const load = useCallback(async (t: SurveyTarget) => {
    setLoading(true);
    try {
      const list = await fetchSurveyQuestionsApi(t, true);
      setQuestions(list);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'โหลดรายการคำถามไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(target);
  }, [load, target]);

  const handleOpenAdd = () => {
    setForm({
      ...DEFAULT_FORM,
      target,
      options: ['ตัวเลือกที่ 1', 'ตัวเลือกที่ 2'],
      allowOther: false,
    });
    setModalOpen(true);
  };

  const handleOpenEdit = (q: SurveyQuestion) => {
    setForm({
      id: q.id,
      target: q.target,
      title: q.title,
      description: q.description ?? '',
      questionType: q.questionType,
      options: q.options && q.options.length > 0 ? [...q.options] : [''],
      allowOther: q.allowOther ?? false,
      required: q.required,
      active: q.active,
    });
    setModalOpen(true);
  };

  const handleSave = async () => {
    if (!form.title.trim()) {
      setError('กรุณาระบุหัวข้อคำถาม');
      return;
    }

    if (
      (form.questionType === 'SINGLE_CHOICE' || form.questionType === 'MULTIPLE_CHOICE') &&
      form.options.filter((o) => o.trim()).length < 2
    ) {
      setError('คำถามประเภทตัวเลือกต้องมีตัวเลือกอย่างน้อย 2 ตัวเลือก');
      return;
    }

    setBusy(true);
    setError('');
    try {
      const cleanedOptions =
        form.questionType === 'TEXT'
          ? []
          : form.options.map((o) => o.trim()).filter(Boolean);

      const isChoiceType = form.questionType === 'SINGLE_CHOICE' || form.questionType === 'MULTIPLE_CHOICE';

      if (form.id) {
        await updateSurveyQuestionApi(form.id, {
          title: form.title,
          description: form.description || undefined,
          questionType: form.questionType,
          options: cleanedOptions,
          allowOther: isChoiceType ? form.allowOther : false,
          required: form.required,
          active: form.active,
        });
        toast.success('บันทึกการแก้ไขคำถามสำเร็จ');
      } else {
        await createSurveyQuestionApi({
          target: form.target,
          title: form.title,
          description: form.description || undefined,
          questionType: form.questionType,
          options: cleanedOptions,
          allowOther: isChoiceType ? form.allowOther : false,
          required: form.required,
          active: form.active,
        });
        toast.success('เพิ่มคำถามแบบสำรวจสำเร็จ');
      }
      setModalOpen(false);
      await load(target);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'บันทึกข้อมูลไม่สำเร็จ';
      setError(msg);
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (q: SurveyQuestion) => {
    if (!window.confirm(`ยืนยันการลบคำถาม "${q.title}" หรือไม่?`)) return;
    setBusy(true);
    try {
      await deleteSurveyQuestionApi(q.id);
      toast.success('ลบคำถามสำเร็จ');
      await load(target);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'ลบคำถามไม่สำเร็จ';
      setError(msg);
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  };

  const handleToggleActive = async (q: SurveyQuestion) => {
    setBusy(true);
    try {
      await updateSurveyQuestionApi(q.id, { active: !q.active });
      toast.success(q.active ? 'ปิดการใช้งานคำถามแล้ว' : 'เปิดการใช้งานคำถามแล้ว');
      await load(target);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'อัปเดตสถานะไม่สำเร็จ';
      setError(msg);
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  };

  const handleReorder = async (sourceIndex: number, targetIndex: number) => {
    if (sourceIndex === targetIndex || busy) return;
    const previous = [...questions];
    const updated = [...questions];
    const [moved] = updated.splice(sourceIndex, 1);
    updated.splice(targetIndex, 0, moved);
    setQuestions(updated);
    setBusy(true);
    try {
      const result = await reorderSurveyQuestionsApi(
        target,
        updated.map((q) => q.id),
      );
      setQuestions(result);
      toast.success('บันทึกลำดับคำถามเรียบร้อย');
      setError('');
    } catch (err) {
      setQuestions(previous);
      const msg = err instanceof Error ? err.message : 'จัดลำดับไม่สำเร็จ';
      setError(msg);
      toast.error(msg);
    } finally {
      setBusy(false);
      setDraggedIndex(null);
      setDragOverIndex(null);
      setCanDrag(false);
    }
  };

  const handleExportCsv = () => {
    window.open(`/api/surveys/export?target=${encodeURIComponent(target)}`, '_blank');
  };

  return (
    <Panel
      title="จัดการแบบสำรวจ"
      eyebrow="ตั้งค่าคำถามสำหรับเก็บข้อมูลความคิดเห็นลูกค้า แยกตามกรณีซื้อ และไม่ซื้อ"
    >
      {error && (
        <div style={{ marginBottom: '1rem' }}>
          <Notice error>{error}</Notice>
        </div>
      )}

      {/* Target Tabs (BUY / NOT_BUY) */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '12px',
          marginBottom: '1.25rem',
          borderBottom: '1px solid #e2e8f0',
          paddingBottom: '12px',
        }}
      >
        {/* Modern Segmented Control for Target Mode */}
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
            aria-selected={target === 'BUY'}
            onClick={() => setTarget('BUY')}
            style={{
              padding: '7px 18px',
              borderRadius: '8px',
              border: 'none',
              background: target === 'BUY' ? '#ffffff' : 'transparent',
              color: target === 'BUY' ? '#0f172a' : '#64748b',
              fontWeight: target === 'BUY' ? 700 : 500,
              fontSize: '13.5px',
              cursor: 'pointer',
              boxShadow:
                target === 'BUY'
                  ? '0 1px 3px rgba(0, 0, 0, 0.08), 0 1px 2px rgba(0, 0, 0, 0.04)'
                  : 'none',
              transition: 'all 0.15s ease',
            }}
          >
            แบบสำรวจ: BUY
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={target === 'NOT_BUY'}
            onClick={() => setTarget('NOT_BUY')}
            style={{
              padding: '7px 18px',
              borderRadius: '8px',
              border: 'none',
              background: target === 'NOT_BUY' ? '#ffffff' : 'transparent',
              color: target === 'NOT_BUY' ? '#0f172a' : '#64748b',
              fontWeight: target === 'NOT_BUY' ? 700 : 500,
              fontSize: '13.5px',
              cursor: 'pointer',
              boxShadow:
                target === 'NOT_BUY'
                  ? '0 1px 3px rgba(0, 0, 0, 0.08), 0 1px 2px rgba(0, 0, 0, 0.04)'
                  : 'none',
              transition: 'all 0.15s ease',
            }}
          >
            แบบสำรวจ: NOT BUY
          </button>
        </div>

        <div style={{ display: 'flex', gap: '8px' }}>
          <Button variant="secondary" onClick={handleExportCsv}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
              <Download size={15} />
              ดาวน์โหลดรายงานผล (CSV)
            </span>
          </Button>
          <Button onClick={handleOpenAdd} disabled={busy}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
              <Plus size={16} />
              เพิ่มคำถาม
            </span>
          </Button>
        </div>
      </div>

      {loading ? (
        <p className="muted">กำลังโหลดคำถาม...</p>
      ) : questions.length === 0 ? (
        <div
          style={{
            padding: '3rem 1.5rem',
            textAlign: 'center',
            background: '#f8fafc',
            border: '2px dashed #cbd5e1',
            borderRadius: '12px',
          }}
        >
          <FileQuestion size={44} color="#94a3b8" style={{ marginBottom: '12px' }} />
          <h4 style={{ margin: '0 0 6px', color: '#1e293b' }}>
            ยังไม่มีคำถามแบบสำรวจสำหรับ{target === 'BUY' ? 'กรณีซื้อ' : 'กรณีไม่ซื้อ'}
          </h4>
          <p className="muted" style={{ margin: '0 0 16px', fontSize: '13px' }}>
            คลิกปุ่ม &quot;เพิ่มคำถาม&quot; เพื่อเริ่มต้นสร้างคำถามแรก
          </p>
          <Button onClick={handleOpenAdd}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
              <Plus size={16} /> เพิ่มคำถาม
            </span>
          </Button>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {questions.map((q, idx) => {
            const isDragging = draggedIndex === idx;
            const isOver = dragOverIndex === idx && draggedIndex !== idx;
            return (
              <div
                key={q.id}
                draggable={canDrag && !busy}
                onDragStart={(e) => {
                  e.dataTransfer.setData('text/plain', String(idx));
                  e.dataTransfer.effectAllowed = 'move';
                  setDraggedIndex(idx);
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = 'move';
                  if (dragOverIndex !== idx) {
                    setDragOverIndex(idx);
                  }
                }}
                onDragLeave={() => {
                  if (dragOverIndex === idx) {
                    setDragOverIndex(null);
                  }
                }}
                onDragEnd={() => {
                  setDraggedIndex(null);
                  setDragOverIndex(null);
                  setCanDrag(false);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  if (draggedIndex !== null && draggedIndex !== idx) {
                    void handleReorder(draggedIndex, idx);
                  } else {
                    setDraggedIndex(null);
                    setDragOverIndex(null);
                    setCanDrag(false);
                  }
                }}
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  justifyContent: 'space-between',
                  padding: '16px',
                  background: isOver ? '#f0fdfa' : q.active ? '#ffffff' : '#f8fafc',
                  border: isOver ? '1.5px dashed #0abab5' : '1px solid #e2e8f0',
                  borderRadius: '10px',
                  opacity: isDragging ? 0.35 : q.active ? 1 : 0.65,
                  boxShadow: isOver
                    ? draggedIndex !== null && draggedIndex < idx
                      ? 'inset 0 -2px 0 0 #0abab5'
                      : 'inset 0 2px 0 0 #0abab5'
                    : undefined,
                  gap: '12px',
                  flexWrap: 'wrap',
                  transition:
                    'background-color 0.15s ease, opacity 0.15s ease, border 0.15s ease',
                }}
              >
                {/* Drag grip handle */}
                <div
                  style={{
                    cursor: busy ? 'default' : 'grab',
                    color: '#94a3b8',
                    padding: '4px 2px',
                    userSelect: 'none',
                    display: 'flex',
                    alignItems: 'center',
                    marginTop: '2px',
                    flexShrink: 0,
                  }}
                  onMouseEnter={() => setCanDrag(true)}
                  onMouseLeave={() => {
                    if (draggedIndex === null) setCanDrag(false);
                  }}
                  title="ลากเพื่อสลับลำดับ"
                  aria-label="ลากเพื่อสลับลำดับ"
                >
                  <GripVertical size={20} />
                </div>

                <div style={{ flex: 1, minWidth: '240px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                    <span
                      style={{
                        background: '#0f766e',
                        color: '#ffffff',
                        fontSize: '11px',
                        fontWeight: 700,
                        padding: '2px 8px',
                        borderRadius: '12px',
                      }}
                    >
                      ข้อ {idx + 1}
                    </span>
                    <span
                      style={{
                        fontSize: '11.5px',
                        background: '#f1f5f9',
                        color: '#475569',
                        padding: '2px 8px',
                        borderRadius: '6px',
                      }}
                    >
                      {TYPE_LABELS[q.questionType]}
                    </span>
                    {q.required && (
                      <span
                        style={{
                          fontSize: '11px',
                          background: '#fef2f2',
                          color: '#b91c1c',
                          padding: '2px 6px',
                          borderRadius: '4px',
                          fontWeight: 600,
                        }}
                      >
                        จำเป็นต้องตอบ
                      </span>
                    )}
                    {!q.active && (
                      <span
                        style={{
                          fontSize: '11px',
                          background: '#fee2e2',
                          color: '#991b1b',
                          padding: '2px 6px',
                          borderRadius: '4px',
                        }}
                      >
                        ปิดใช้งาน
                      </span>
                    )}
                  </div>

                  <div style={{ fontWeight: 600, fontSize: '15px', color: '#0f172a', marginBottom: '4px' }}>
                    {q.title}
                  </div>

                  {q.description && (
                    <p style={{ margin: '0 0 8px', fontSize: '13px', color: '#64748b' }}>
                      {q.description}
                    </p>
                  )}

                  {q.options && q.options.length > 0 && q.questionType !== 'TEXT' && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '6px' }}>
                      {q.options.map((opt, oIdx) => (
                        <span
                          key={oIdx}
                          style={{
                            fontSize: '12px',
                            background: '#e0f2fe',
                            color: '#0369a1',
                            padding: '3px 8px',
                            borderRadius: '6px',
                          }}
                        >
                          {opt}
                        </span>
                      ))}
                      {q.allowOther && (
                        <span
                          style={{
                            fontSize: '12px',
                            background: '#fef3c7',
                            color: '#92400e',
                            padding: '3px 8px',
                            borderRadius: '6px',
                            fontStyle: 'italic',
                          }}
                        >
                          + อื่น ๆ (ระบุ)
                        </span>
                      )}
                    </div>
                  )}
                </div>

                {/* Actions */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={busy}
                    onClick={() => handleToggleActive(q)}
                  >
                    {q.active ? 'ปิดใช้งาน' : 'เปิดใช้งาน'}
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={busy}
                    onClick={() => handleOpenEdit(q)}
                  >
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                      <Edit2 size={13} /> แก้ไข
                    </span>
                  </Button>
                  <Button
                    size="sm"
                    variant="danger"
                    disabled={busy}
                    onClick={() => handleDelete(q)}
                  >
                    <Trash2 size={13} />
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Modal Add / Edit */}
      {modalOpen && (
        <Modal
          title={form.id ? 'แก้ไขคำถามแบบสำรวจ' : 'เพิ่มคำถามแบบสำรวจ'}
          onClose={() => setModalOpen(false)}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div>
              <label style={{ display: 'block', fontWeight: 600, fontSize: '13.5px', marginBottom: '4px' }}>
                ประเภทแบบสำรวจ
              </label>
              <select
                value={form.target}
                disabled={Boolean(form.id)}
                onChange={(e) => setForm({ ...form, target: e.target.value as SurveyTarget })}
                style={{ width: '100%', padding: '8px 10px', borderRadius: '6px', border: '1px solid #cbd5e1' }}
              >
                <option value="BUY">แบบสำรวจ: กรณีซื้อ (BUY)</option>
                <option value="NOT_BUY">แบบสำรวจ: กรณีไม่ซื้อ (NOT_BUY)</option>
              </select>
            </div>

            <div>
              <label style={{ display: 'block', fontWeight: 600, fontSize: '13.5px', marginBottom: '4px' }}>
                หัวข้อคำถาม <span style={{ color: '#dc2626' }}>*</span>
              </label>
              <input
                type="text"
                placeholder="เช่น เหตุผลหลักในการเลือกซื้อสินค้าในวันนี้"
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                style={{ width: '100%', padding: '8px 10px', borderRadius: '6px', border: '1px solid #cbd5e1' }}
              />
            </div>

            <div>
              <label style={{ display: 'block', fontWeight: 600, fontSize: '13.5px', marginBottom: '4px' }}>
                คำอธิบายเพิ่มเติม (ถ้ามี)
              </label>
              <input
                type="text"
                placeholder="คำอธิบายสั้นๆ เพื่อให้พนักงานเข้าใจบริบทของคำถาม"
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                style={{ width: '100%', padding: '8px 10px', borderRadius: '6px', border: '1px solid #cbd5e1' }}
              />
            </div>

            <div>
              <label style={{ display: 'block', fontWeight: 600, fontSize: '13.5px', marginBottom: '4px' }}>
                รูปแบบคำถาม <span style={{ color: '#dc2626' }}>*</span>
              </label>
              <select
                value={form.questionType}
                onChange={(e) =>
                  setForm({
                    ...form,
                    questionType: e.target.value as SurveyQuestionType,
                    options:
                      e.target.value === 'TEXT'
                        ? []
                        : form.options.length > 0
                          ? form.options
                          : ['ตัวเลือกที่ 1', 'ตัวเลือกที่ 2'],
                  })
                }
                style={{ width: '100%', padding: '8px 10px', borderRadius: '6px', border: '1px solid #cbd5e1' }}
              >
                <option value="SINGLE_CHOICE">เลือกตอบข้อเดียว (Single choice)</option>
                <option value="MULTIPLE_CHOICE">เลือกตอบหลายข้อ (Multiple choice)</option>
                <option value="TEXT">พิมพ์ข้อความ (Text)</option>
              </select>
            </div>

            {form.questionType !== 'TEXT' && (
              <div>
                <label style={{ display: 'block', fontWeight: 600, fontSize: '13.5px', marginBottom: '6px' }}>
                  รายการตัวเลือก (อย่างน้อย 2 ตัวเลือก)
                </label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {form.options.map((opt, idx) => (
                    <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ fontSize: '12px', color: '#64748b', width: '20px', textAlign: 'right' }}>
                        {idx + 1}.
                      </span>
                      <input
                        type="text"
                        placeholder={`ตัวเลือกที่ ${idx + 1}`}
                        value={opt}
                        onChange={(e) => {
                          const next = [...form.options];
                          next[idx] = e.target.value;
                          setForm({ ...form, options: next });
                        }}
                        style={{ flex: 1, padding: '7px 10px', borderRadius: '6px', border: '1px solid #cbd5e1' }}
                      />
                      <button
                        type="button"
                        disabled={form.options.length <= 1}
                        onClick={() => {
                          setForm({ ...form, options: form.options.filter((_, i) => i !== idx) });
                        }}
                        style={{
                          border: 'none',
                          background: 'transparent',
                          color: '#ef4444',
                          cursor: 'pointer',
                          padding: '4px',
                        }}
                        aria-label="ลบตัวเลือก"
                      >
                        <X size={16} />
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={() => setForm({ ...form, options: [...form.options, ''] })}
                    style={{
                      alignSelf: 'flex-start',
                      marginTop: '4px',
                      background: 'none',
                      border: '1px dashed #0f766e',
                      color: '#0f766e',
                      borderRadius: '6px',
                      padding: '5px 12px',
                      fontSize: '12.5px',
                      cursor: 'pointer',
                      fontWeight: 600,
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '4px',
                    }}
                  >
                    <Plus size={14} /> เพิ่มตัวเลือก
                  </button>

                  <label
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                      fontSize: '13px',
                      marginTop: '8px',
                      padding: '8px 10px',
                      backgroundColor: '#f8fafc',
                      borderRadius: '6px',
                      border: '1px solid #e2e8f0',
                      cursor: 'pointer',
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={form.allowOther}
                      onChange={(e) => setForm({ ...form, allowOther: e.target.checked })}
                    />
                    <span style={{ fontWeight: 500, color: '#334155' }}>
                      เพิ่มตัวเลือก <strong>&ldquo;อื่น ๆ (โปรดระบุ)&rdquo;</strong>
                    </span>
                  </label>
                </div>
              </div>
            )}

            <div style={{ display: 'flex', gap: '16px', marginTop: '6px' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={form.required}
                  onChange={(e) => setForm({ ...form, required: e.target.checked })}
                />
                บังคับตอบคำถามนี้
              </label>

              <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={form.active}
                  onChange={(e) => setForm({ ...form, active: e.target.checked })}
                />
                เปิดใช้งานคำถามนี้
              </label>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '14px' }}>
              <Button variant="secondary" onClick={() => setModalOpen(false)} disabled={busy}>
                ยกเลิก
              </Button>
              <Button onClick={handleSave} disabled={busy || !form.title.trim()}>
                {busy ? 'กำลังบันทึก...' : 'บันทึก'}
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </Panel>
  );
}
