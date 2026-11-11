import { useCallback, useEffect, useState } from 'react';
import { ArrowDown, ArrowUp, CreditCard, GripVertical, Plus, Trash2 } from 'lucide-react';
import { Button, Modal, Notice, Panel } from '../../components/ui';
import { useToast } from '../../components/Toast';
import {
  createPaymentCardOptionApi,
  createPaymentMethodApi,
  deletePaymentCardOptionApi,
  fetchPaymentMethodsApi,
  movePaymentMethodApi,
  reorderPaymentCardOptionsApi,
  reorderPaymentMethodsApi,
  setPaymentMethodActiveApi,
  setPaymentMethodFmpTypeApi,
  updatePaymentCardOptionApi,
} from '../../services/sessionApi';
import { fmpPaymentTypes } from '../../constants/options';
import type { PaymentCardOption, PaymentMethod } from '../../types/session';

function parseInstallmentMonths(raw: string): number[] {
  return raw
    .split(/[\s,]+/)
    .map((n) => parseInt(n.trim(), 10))
    .filter((n) => !isNaN(n) && n > 0);
}

/**
 * Back-office list of payment methods (F6). New ones are added here, with no deploy. A name is what sessions store, so a
 * method is switched off, never renamed or deleted; the order here is the order staff see.
 */
export function PaymentMethodsPanel() {
  const toast = useToast();
  const [methods, setMethods] = useState<PaymentMethod[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [name, setName] = useState('');
  const [newFmpType, setNewFmpType] = useState('');
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [canDrag, setCanDrag] = useState(false);
  const [selectedMethodForCards, setSelectedMethodForCards] = useState<PaymentMethod | null>(null);
  const [newCardName, setNewCardName] = useState('');
  const [newCardMonths, setNewCardMonths] = useState('3, 4, 5, 6, 9, 10, 12, 15, 18, 20, 24, 36, 48');
  const [editingCardId, setEditingCardId] = useState<string | null>(null);
  const [editCardNameValue, setEditCardNameValue] = useState('');
  const [editMonthsValue, setEditMonthsValue] = useState('');
  const [cardDraggedIndex, setCardDraggedIndex] = useState<number | null>(null);
  const [cardDragOverIndex, setCardDragOverIndex] = useState<number | null>(null);
  const [cardCanDrag, setCardCanDrag] = useState(false);

  const load = useCallback(async () => {
    try {
      setMethods(await fetchPaymentMethodsApi(true));
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'โหลดข้อมูลไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    fetchPaymentMethodsApi(true)
      .then((list) => {
        if (active) setMethods(list);
      })
      .catch((err: unknown) => {
        if (active)
          setError(err instanceof Error ? err.message : 'โหลดข้อมูลไม่สำเร็จ');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const run = async (work: () => Promise<unknown>, done?: string) => {
    setBusy(true);
    try {
      await work();
      await load();
      if (done) toast.success(done);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'บันทึกไม่สำเร็จ';
      setError(message);
      toast.error(message);
    } finally {
      setBusy(false);
    }
  };

  const handleReorder = async (sourceIndex: number, targetIndex: number) => {
    if (sourceIndex === targetIndex || busy) return;
    const previous = [...methods];
    const updated = [...methods];
    const [moved] = updated.splice(sourceIndex, 1);
    updated.splice(targetIndex, 0, moved);
    setMethods(updated);
    setBusy(true);
    try {
      const result = await reorderPaymentMethodsApi(updated.map((m) => m.id));
      setMethods(result);
      toast.success('บันทึกลำดับช่องทางชำระเงินเรียบร้อย');
      setError('');
    } catch (err) {
      setMethods(previous);
      const message =
        err instanceof Error ? err.message : 'บันทึกลำดับไม่สำเร็จ';
      setError(message);
      toast.error(message);
    } finally {
      setBusy(false);
      setDraggedIndex(null);
      setDragOverIndex(null);
      setCanDrag(false);
    }
  };

  const handleCardReorder = async (
    paymentMethodId: string,
    cardList: PaymentCardOption[],
    sourceIndex: number,
    targetIndex: number,
  ) => {
    if (
      sourceIndex === targetIndex ||
      sourceIndex < 0 ||
      targetIndex < 0 ||
      sourceIndex >= cardList.length ||
      targetIndex >= cardList.length ||
      busy
    ) {
      return;
    }
    const previous = methods;
    const updatedCards = [...cardList];
    const [moved] = updatedCards.splice(sourceIndex, 1);
    updatedCards.splice(targetIndex, 0, moved);

    setMethods((prev) =>
      prev.map((m) =>
        m.id === paymentMethodId ? { ...m, cardOptions: updatedCards } : m,
      ),
    );
    setBusy(true);
    try {
      const reordered = await reorderPaymentCardOptionsApi(
        paymentMethodId,
        updatedCards.map((c) => c.id),
      );
      setMethods((prev) =>
        prev.map((m) =>
          m.id === paymentMethodId ? { ...m, cardOptions: reordered } : m,
        ),
      );
      toast.success('บันทึกลำดับประเภทบัตรเรียบร้อย');
      setError('');
    } catch (err) {
      setMethods(previous);
      const message =
        err instanceof Error ? err.message : 'บันทึกลำดับประเภทบัตรไม่สำเร็จ';
      setError(message);
      toast.error(message);
    } finally {
      setBusy(false);
      setCardDraggedIndex(null);
      setCardDragOverIndex(null);
      setCardCanDrag(false);
    }
  };

  return (
    <>
      {error && <Notice error>{error}</Notice>}
      <Panel title="ช่องทางชำระเงิน (Payment Methods)">
        <p className="muted" style={{ marginTop: 0 }}>
          เพิ่มช่องทางใหม่ได้ที่นี่ทันที (ไม่ต้อง deploy)
          ชื่อใช้บันทึกในรายการขาย จึงแก้ชื่อหรือลบไม่ได้ ทำได้เพียงปิดใช้งาน
          สามารถคลิกค้างที่ไอคอน ⠿ เพื่อลากจัดลำดับ หรือใช้ปุ่มลูกศร
          ลำดับในตารางคือลำดับที่พนักงานเห็น
        </p>
        <p className="muted" style={{ marginTop: 0 }}>
          “ประเภทใน FileMaker” คือประเภทที่ทีม FileMaker ใช้ในใบขาย
          ระบบจะส่งไปคู่กับชื่อช่องทาง (ฟิลด์ <code>paymentTypes</code>)
          ช่องทางที่ยังไม่กำหนดจะถูกส่งเป็น “อื่นๆ”
        </p>
        <form
          className="payment-add-form"
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              await createPaymentMethodApi(name.trim(), newFmpType || undefined);
              setName('');
              setNewFmpType('');
            }, 'เพิ่มช่องทางชำระเงินเรียบร้อย');
          }}
        >
          <input
            required
            maxLength={64}
            placeholder="ชื่อช่องทางใหม่ เช่น LINE Pay"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <select
            aria-label="ประเภทใน FileMaker ของช่องทางใหม่"
            value={newFmpType}
            onChange={(e) => setNewFmpType(e.target.value)}
          >
            <option value="">ประเภทใน FileMaker: ยังไม่กำหนด</option>
            {fmpPaymentTypes.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
          <Button type="submit" disabled={busy || !name.trim()}>
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
              }}
            >
              <Plus size={16} />
              เพิ่ม
            </span>
          </Button>
        </form>
        {loading ? (
          <Notice>กำลังโหลด…</Notice>
        ) : (
          <div className="table-responsive">
            <table className="admin-table">
              <thead>
                <tr>
                  <th style={{ width: '40px', textAlign: 'center' }}></th>
                  <th style={{ width: '70px' }}>ลำดับ</th>
                  <th>ชื่อช่องทาง</th>
                  <th>ประเภทใน FileMaker</th>
                  <th>สถานะ</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {methods.map((method, index) => {
                  const isDragging = draggedIndex === index;
                  const isOver =
                    dragOverIndex === index && draggedIndex !== index;
                  return (
                    <tr
                      key={method.id}
                      draggable={canDrag && !busy}
                      onDragStart={(e) => {
                        e.dataTransfer.setData('text/plain', String(index));
                        e.dataTransfer.effectAllowed = 'move';
                        setDraggedIndex(index);
                      }}
                      onDragOver={(e) => {
                        e.preventDefault();
                        e.dataTransfer.dropEffect = 'move';
                        if (dragOverIndex !== index) {
                          setDragOverIndex(index);
                        }
                      }}
                      onDragLeave={() => {
                        if (dragOverIndex === index) {
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
                        if (draggedIndex !== null && draggedIndex !== index) {
                          void handleReorder(draggedIndex, index);
                        } else {
                          setDraggedIndex(null);
                          setDragOverIndex(null);
                          setCanDrag(false);
                        }
                      }}
                      style={{
                        opacity: isDragging ? 0.35 : 1,
                        backgroundColor: isOver ? '#f0fdfa' : undefined,
                        boxShadow: isOver
                          ? draggedIndex !== null && draggedIndex < index
                            ? 'inset 0 -2px 0 0 #0abab5'
                            : 'inset 0 2px 0 0 #0abab5'
                          : undefined,
                        transition:
                          'background-color 0.15s ease, opacity 0.15s ease',
                      }}
                    >
                      <td
                        style={{
                          textAlign: 'center',
                          cursor: busy ? 'default' : 'grab',
                          color: '#94a3b8',
                          userSelect: 'none',
                        }}
                        onMouseEnter={() => setCanDrag(true)}
                        onMouseLeave={() => {
                          if (draggedIndex === null) setCanDrag(false);
                        }}
                        onMouseDown={() => setCanDrag(true)}
                        title="คลิกค้างแล้วลากเพื่อจัดอันดับ"
                      >
                        <GripVertical size={16} />
                      </td>
                      <td>{index + 1}</td>
                      <td>
                        <strong>{method.name}</strong>
                      </td>
                      <td>
                        <select
                          aria-label={`ประเภทใน FileMaker ของ ${method.name}`}
                          value={method.fmpType ?? ''}
                          disabled={busy}
                          onChange={(e) =>
                            void run(
                              () =>
                                setPaymentMethodFmpTypeApi(
                                  method.id,
                                  e.target.value || null,
                                ),
                              'บันทึกประเภทใน FileMaker เรียบร้อย',
                            )
                          }
                        >
                          <option value="">ยังไม่กำหนด (ส่งเป็น อื่นๆ)</option>
                          {fmpPaymentTypes.map((type) => (
                            <option key={type} value={type}>
                              {type}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <span
                          className={`status-tag ${method.active ? 'status-found' : 'status-outcome'}`}
                        >
                          {method.active ? 'ใช้งาน' : 'ปิดใช้งาน'}
                        </span>
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: '6px' }}>
                          <Button
                            variant="secondary"
                            size="sm"
                            disabled={busy || index === 0}
                            aria-label={`เลื่อน ${method.name} ขึ้น`}
                            onClick={() =>
                              void run(() =>
                                movePaymentMethodApi(method.id, 'up'),
                              )
                            }
                          >
                            <ArrowUp size={14} />
                          </Button>
                          <Button
                            variant="secondary"
                            size="sm"
                            disabled={busy || index === methods.length - 1}
                            aria-label={`เลื่อน ${method.name} ลง`}
                            onClick={() =>
                              void run(() =>
                                movePaymentMethodApi(method.id, 'down'),
                              )
                            }
                          >
                            <ArrowDown size={14} />
                          </Button>
                          <Button
                            variant="secondary"
                            size="sm"
                            disabled={busy}
                            onClick={() =>
                              void run(
                                () =>
                                  setPaymentMethodActiveApi(
                                    method.id,
                                    !method.active,
                                  ),
                                method.active
                                  ? 'ปิดใช้งานแล้ว'
                                  : 'เปิดใช้งานแล้ว',
                              )
                            }
                          >
                            {method.active ? 'ปิดใช้งาน' : 'เปิดใช้งาน'}
                          </Button>
                          {(method.name === 'Full Credit Card' ||
                            method.name === '0% Credit Card') && (
                            <Button
                              variant="secondary"
                              size="sm"
                              onClick={() => setSelectedMethodForCards(method)}
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '4px',
                              }}
                            >
                              <CreditCard size={14} />
                              ตั้งค่าบัตร
                              {method.cardOptions?.length
                                ? ` (${method.cardOptions.length})`
                                : ''}
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {selectedMethodForCards && (() => {
          const currentMethod =
            methods.find((m) => m.id === selectedMethodForCards.id) ??
            selectedMethodForCards;
          const isZeroPercent = currentMethod.name === '0% Credit Card';
          const cardList = currentMethod.cardOptions ?? [];

          const saveCardEdit = (cardId: string) => {
            const trimmedName = editCardNameValue.trim();
            if (!trimmedName) {
              toast.error('กรุณาระบุชื่อประเภทบัตร');
              return;
            }
            const parsedMonths = isZeroPercent
              ? parseInstallmentMonths(editMonthsValue)
              : undefined;
            if (isZeroPercent && parsedMonths && parsedMonths.length === 0) {
              toast.error('กรุณาระบุจำนวนเดือนผ่อนเป็นตัวเลขอย่างน้อย 1 ค่า');
              return;
            }
            void run(async () => {
              await updatePaymentCardOptionApi(cardId, {
                name: trimmedName,
                ...(isZeroPercent ? { installmentMonths: parsedMonths } : {}),
              });
              setEditingCardId(null);
            }, 'บันทึกข้อมูลประเภทบัตรเรียบร้อย');
          };

          const cancelCardEdit = () => {
            setEditingCardId(null);
            setEditCardNameValue('');
            setEditMonthsValue('');
          };

          return (
            <Modal
              isOpen={true}
              title={
                <span
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                  }}
                >
                  <CreditCard size={18} />
                  ตั้งค่าประเภทบัตร: {currentMethod.name}
                </span>
              }
              onClose={() => {
                setSelectedMethodForCards(null);
                cancelCardEdit();
                setCardDraggedIndex(null);
                setCardDragOverIndex(null);
                setCardCanDrag(false);
              }}
              maxWidth="820px"
            >
              <p className="muted" style={{ marginTop: 0 }}>
                {isZeroPercent
                  ? 'กำหนดประเภทบัตรและจำนวนเดือนผ่อนที่รองรับสำหรับ 0% Credit Card (ลากไอคอน ⠿ เพื่อสลับลำดับ)'
                  : 'กำหนดประเภทบัตรเครดิตที่ยอมรับสำหรับ Full Credit Card (ลากไอคอน ⠿ เพื่อสลับลำดับ)'}
              </p>
              <form
                className="payment-add-form"
                style={{ marginBottom: '16px' }}
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!newCardName.trim()) return;
                  const months = isZeroPercent
                    ? parseInstallmentMonths(newCardMonths)
                    : null;
                  if (isZeroPercent && months && months.length === 0) {
                    toast.error('กรุณาระบุจำนวนเดือนผ่อนเป็นตัวเลขอย่างน้อย 1 ค่า');
                    return;
                  }
                  void run(async () => {
                    await createPaymentCardOptionApi(
                      currentMethod.id,
                      newCardName.trim(),
                      months,
                    );
                    setNewCardName('');
                    if (isZeroPercent) setNewCardMonths('3, 4, 5, 6, 9, 10, 12, 15, 18, 20, 24, 36, 48');
                  }, `เพิ่มประเภทบัตร "${newCardName.trim()}" เรียบร้อย`);
                }}
              >
                <input
                  required
                  maxLength={64}
                  placeholder="ชื่อประเภทบัตร เช่น KBank, SCB"
                  value={newCardName}
                  onChange={(e) => setNewCardName(e.target.value)}
                  style={{ flex: 1 }}
                />
                {isZeroPercent && (
                  <input
                    required
                    placeholder="จำนวนเดือน เช่น 3, 4, 5, 6, 9, 10, 12, 15, 18, 20, 24, 36, 48"
                    value={newCardMonths}
                    onChange={(e) => setNewCardMonths(e.target.value)}
                    style={{ width: '160px' }}
                    title="ระบุจำนวนเดือนคั่นด้วยเครื่องหมายจุลภาค เช่น 3, 4, 5, 6, 9, 10, 12, 15, 18, 20, 24, 36, 48"
                  />
                )}
                <Button
                  type="submit"
                  disabled={busy || !newCardName.trim()}
                >
                  <span
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '4px',
                    }}
                  >
                    <Plus size={16} />
                    เพิ่มบัตร
                  </span>
                </Button>
              </form>

              {cardList.length === 0 ? (
                <Notice>ยังไม่มีประเภทบัตร กดเพิ่มบัตรด้านบนได้ทันที</Notice>
              ) : (
                <div
                  className="table-responsive"
                  style={{ maxHeight: 'min(420px, 50vh)', overflowY: 'auto' }}
                >
                  <table className="admin-table">
                    <thead>
                      <tr>
                        <th style={{ width: '36px', textAlign: 'center' }}></th>
                        <th style={{ width: '50px' }}>ลำดับ</th>
                        <th>ชื่อประเภทบัตร</th>
                        {isZeroPercent && <th>จำนวนเดือนที่ผ่อน</th>}
                        <th style={{ width: '90px' }}>สถานะ</th>
                        <th style={{ width: '140px' }}>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {cardList.map((card, idx) => {
                        const monthsList = Array.isArray(card.installmentMonths)
                          ? (card.installmentMonths as number[])
                          : [];
                        const isEditing = editingCardId === card.id;
                        const isDragging = cardDraggedIndex === idx;
                        const isOver =
                          cardDragOverIndex === idx && cardDraggedIndex !== idx;

                        return (
                          <tr
                            key={card.id}
                            draggable={
                              cardCanDrag && !busy && editingCardId === null
                            }
                            onDragStart={(e) => {
                              e.dataTransfer.setData('text/plain', String(idx));
                              e.dataTransfer.effectAllowed = 'move';
                              setCardDraggedIndex(idx);
                            }}
                            onDragOver={(e) => {
                              e.preventDefault();
                              e.dataTransfer.dropEffect = 'move';
                              if (cardDragOverIndex !== idx) {
                                setCardDragOverIndex(idx);
                              }
                            }}
                            onDragLeave={() => {
                              if (cardDragOverIndex === idx) {
                                setCardDragOverIndex(null);
                              }
                            }}
                            onDragEnd={() => {
                              setCardDraggedIndex(null);
                              setCardDragOverIndex(null);
                              setCardCanDrag(false);
                            }}
                            onDrop={(e) => {
                              e.preventDefault();
                              if (
                                cardDraggedIndex !== null &&
                                cardDraggedIndex !== idx
                              ) {
                                void handleCardReorder(
                                  currentMethod.id,
                                  cardList,
                                  cardDraggedIndex,
                                  idx,
                                );
                              } else {
                                setCardDraggedIndex(null);
                                setCardDragOverIndex(null);
                                setCardCanDrag(false);
                              }
                            }}
                            style={{
                              opacity: isDragging ? 0.35 : 1,
                              backgroundColor: isOver ? '#f0fdfa' : undefined,
                              boxShadow: isOver
                                ? cardDraggedIndex !== null &&
                                  cardDraggedIndex < idx
                                  ? 'inset 0 -2px 0 0 #0abab5'
                                  : 'inset 0 2px 0 0 #0abab5'
                                : undefined,
                              transition:
                                'background-color 0.15s ease, opacity 0.15s ease',
                            }}
                          >
                            <td
                              style={{
                                textAlign: 'center',
                                cursor:
                                  busy || editingCardId !== null
                                    ? 'default'
                                    : 'grab',
                                color: '#94a3b8',
                                userSelect: 'none',
                              }}
                              onMouseEnter={() => {
                                if (editingCardId === null) setCardCanDrag(true);
                              }}
                              onMouseLeave={() => {
                                if (cardDraggedIndex === null)
                                  setCardCanDrag(false);
                              }}
                              onMouseDown={() => {
                                if (editingCardId === null) setCardCanDrag(true);
                              }}
                              title="คลิกค้างแล้วลากเพื่อสลับลำดับ"
                            >
                              <GripVertical size={16} />
                            </td>
                            <td>{idx + 1}</td>
                            <td>
                              {isEditing ? (
                                <input
                                  type="text"
                                  maxLength={64}
                                  aria-label={`ชื่อประเภทบัตร ${card.name}`}
                                  value={editCardNameValue}
                                  onChange={(e) =>
                                    setEditCardNameValue(e.target.value)
                                  }
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') {
                                      e.preventDefault();
                                      saveCardEdit(card.id);
                                    } else if (e.key === 'Escape') {
                                      e.preventDefault();
                                      cancelCardEdit();
                                    }
                                  }}
                                  style={{
                                    width: '100%',
                                    minWidth: '120px',
                                    padding: '4px 6px',
                                    fontSize: '13px',
                                  }}
                                  placeholder="ชื่อประเภทบัตร"
                                  autoFocus
                                />
                              ) : (
                                <strong>{card.name}</strong>
                              )}
                            </td>
                            {isZeroPercent && (
                              <td>
                                {isEditing ? (
                                  <input
                                    type="text"
                                    aria-label={`จำนวนเดือนผ่อน ${card.name}`}
                                    value={editMonthsValue}
                                    onChange={(e) =>
                                      setEditMonthsValue(e.target.value)
                                    }
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter') {
                                        e.preventDefault();
                                        saveCardEdit(card.id);
                                      } else if (e.key === 'Escape') {
                                        e.preventDefault();
                                        cancelCardEdit();
                                      }
                                    }}
                                    style={{
                                      width: '100%',
                                      minWidth: '150px',
                                      padding: '4px 6px',
                                      fontSize: '12px',
                                    }}
                                    placeholder="เช่น 3, 4, 5, 6, 9, 10, 12, 15, 18, 20, 24, 36, 48"
                                  />
                                ) : (
                                  <div
                                    style={{
                                      display: 'flex',
                                      gap: '4px',
                                      alignItems: 'center',
                                      flexWrap: 'wrap',
                                    }}
                                  >
                                    {monthsList.map((m) => (
                                      <span
                                        key={m}
                                        style={{
                                          padding: '2px 6px',
                                          borderRadius: '4px',
                                          background: '#e0f2fe',
                                          color: '#0369a1',
                                          fontSize: '11px',
                                          fontWeight: 600,
                                        }}
                                      >
                                        {m} เดือน
                                      </span>
                                    ))}
                                  </div>
                                )}
                              </td>
                            )}
                            <td>
                              <span
                                className={`status-tag ${card.active ? 'status-found' : 'status-outcome'}`}
                              >
                                {card.active ? 'ใช้งาน' : 'ปิดใช้งาน'}
                              </span>
                            </td>
                            <td>
                              {isEditing ? (
                                <div style={{ display: 'flex', gap: '4px' }}>
                                  <Button
                                    size="sm"
                                    disabled={
                                      busy || !editCardNameValue.trim()
                                    }
                                    onClick={() => saveCardEdit(card.id)}
                                  >
                                    บันทึก
                                  </Button>
                                  <Button
                                    variant="secondary"
                                    size="sm"
                                    disabled={busy}
                                    onClick={cancelCardEdit}
                                  >
                                    ยกเลิก
                                  </Button>
                                </div>
                              ) : (
                                <div style={{ display: 'flex', gap: '4px' }}>
                                  <Button
                                    variant="secondary"
                                    size="sm"
                                    disabled={busy}
                                    onClick={() => {
                                      setEditingCardId(card.id);
                                      setEditCardNameValue(card.name);
                                      setEditMonthsValue(monthsList.join(', '));
                                    }}
                                  >
                                    แก้ไข
                                  </Button>
                                  <Button
                                    variant="secondary"
                                    size="sm"
                                    disabled={busy}
                                    onClick={() =>
                                      void run(
                                        () =>
                                          updatePaymentCardOptionApi(card.id, {
                                            active: !card.active,
                                          }),
                                        card.active
                                          ? 'ปิดใช้งานประเภทบัตรแล้ว'
                                          : 'เปิดใช้งานประเภทบัตรแล้ว',
                                      )
                                    }
                                  >
                                    {card.active ? 'ปิด' : 'เปิด'}
                                  </Button>
                                  <Button
                                    variant="secondary"
                                    size="sm"
                                    disabled={busy}
                                    aria-label="ลบประเภทบัตร"
                                    onClick={() => {
                                      if (
                                        window.confirm(
                                          `ยืนยันลบประเภทบัตร "${card.name}" หรือไม่?`,
                                        )
                                      ) {
                                        void run(
                                          () =>
                                            deletePaymentCardOptionApi(card.id),
                                          'ลบประเภทบัตรเรียบร้อย',
                                        );
                                      }
                                    }}
                                  >
                                    <Trash2 size={14} />
                                  </Button>
                                </div>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </Modal>
          );
        })()}
      </Panel>
    </>
  );
}
