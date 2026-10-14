import { useState } from 'react';
import { Button } from '../../components/ui';
import { rejectReasons } from '../../constants/options';
import { itemLabel, itemName } from '../session/workflow';
import type { MockSession } from '../../types/session';

interface CashierRejectFormProps {
  session: MockSession;
  onSubmit: (
    reason: string,
    text: string,
    wrongItems?: string[],
    wrongItemIds?: string[],
    wrongItemDetails?: Record<string, { reason: string; note?: string }>,
  ) => void;
  onBack: () => void;
}

export function CashierRejectForm({
  session,
  onSubmit,
  onBack,
}: CashierRejectFormProps) {
  const [selectedWrongIds, setSelectedWrongIds] = useState<string[]>([]);
  const [itemReasons, setItemReasons] = useState<Record<string, string>>({});
  const [itemNotes, setItemNotes] = useState<Record<string, string>>({});

  const items = session.selection.items;
  const accessories = Object.entries(session.selection.accessories);

  const toggleItem = (id: string) => {
    setSelectedWrongIds((prev) => {
      if (prev.includes(id)) {
        return prev.filter((i) => i !== id);
      } else {
        if (!itemReasons[id]) {
          setItemReasons((r) => ({ ...r, [id]: rejectReasons[0] }));
        }
        return [...prev, id];
      }
    });
  };

  const isFormValid = () => {
    if (selectedWrongIds.length === 0) return false;
    for (const id of selectedWrongIds) {
      const reason = itemReasons[id] || rejectReasons[0];
      if (reason === 'อื่น ๆ') {
        if (!itemNotes[id] || itemNotes[id].trim() === '') {
          return false;
        }
      }
    }
    return true;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!isFormValid()) return;

    const wrongItems: string[] = [];
    const wrongItemIds: string[] = [];
    const wrongItemDetails: Record<string, { reason: string; note?: string }> = {};
    const reasonSummarySet = new Set<string>();

    for (const item of items) {
      const itemId = item.id ?? item.product.id;
      if (selectedWrongIds.includes(itemId)) {
        const itemReason = itemReasons[itemId] || rejectReasons[0];
        const note = itemNotes[itemId]?.trim() || undefined;
        wrongItemIds.push(itemId);
        wrongItemDetails[itemId] = { reason: itemReason, note };
        reasonSummarySet.add(itemReason);

        const reasonText =
          itemReason === 'อื่น ๆ' && note
            ? `อื่น ๆ: ${note}`
            : itemReason;
        wrongItems.push(`${itemLabel(item)} (${reasonText})`);
      }
    }

    for (const [name, qty] of accessories) {
      if (selectedWrongIds.includes(name)) {
        const itemReason = itemReasons[name] || rejectReasons[0];
        const note = itemNotes[name]?.trim() || undefined;
        wrongItemIds.push(name);
        wrongItemDetails[name] = { reason: itemReason, note };
        reasonSummarySet.add(itemReason);

        const reasonText =
          itemReason === 'อื่น ๆ' && note
            ? `อื่น ๆ: ${note}`
            : itemReason;
        wrongItems.push(`${name} (x${qty}) (${reasonText})`);
      }
    }

    const overallReason =
      Array.from(reasonSummarySet).join(', ') || rejectReasons[0];

    onSubmit(
      overallReason,
      '',
      wrongItems,
      wrongItemIds,
      wrongItemDetails,
    );
  };

  return (
    <form onSubmit={handleSubmit}>
      <div style={{ marginBottom: '16px' }}>
        <h4 style={{ margin: '0 0 6px', fontSize: '14px', color: '#1f2937' }}>
          เลือกรายการสินค้าที่หยิบผิด / มีปัญหา:
        </h4>
        <p style={{ margin: '0 0 12px', fontSize: '12px', color: '#6b7280' }}>
          * ติ๊กเลือกสินค้าที่มีปัญหา และเลือกเหตุผลเฉพาะของแต่ละชิ้น (เช่น หยิบสินค้าผิด, สินค้าชำรุด/มีตำหนิ, อื่น ๆ)
        </p>

        <div className="accessory-list">
          {items.map((item) => {
            const itemId = item.id ?? item.product.id;
            const isSelected = selectedWrongIds.includes(itemId);
            const currentReason = itemReasons[itemId] || rejectReasons[0];

            return (
              <div
                key={itemId}
                className={`accessory-item ${isSelected ? 'out-of-stock-item' : ''}`}
                style={
                  isSelected
                    ? { borderColor: '#ef4444', backgroundColor: '#fff5f5' }
                    : undefined
                }
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '12px',
                    width: '100%',
                  }}
                >
                  <label
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      cursor: 'pointer',
                      margin: 0,
                      flex: 1,
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleItem(itemId)}
                    />
                    <span>
                      <strong>สินค้าหลัก:</strong> {itemName(item)} ({item.product.sku}) จำนวน{' '}
                      {item.quantity} ชิ้น
                    </span>
                  </label>

                  {isSelected && (
                    <div style={{ flexShrink: 0 }}>
                      <select
                        value={currentReason}
                        onChange={(e) => {
                          const val = e.target.value;
                          setItemReasons((prev) => ({ ...prev, [itemId]: val }));
                        }}
                        style={{
                          fontSize: '12px',
                          fontWeight: 500,
                          padding: '4px 8px',
                          borderRadius: '6px',
                          border: '1px solid #f87171',
                          backgroundColor: '#ffffff',
                          color: '#b91c1c',
                          cursor: 'pointer',
                        }}
                      >
                        {rejectReasons.map((r) => (
                          <option key={r} value={r}>
                            {r}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>

                {isSelected && currentReason === 'อื่น ๆ' && (
                  <div
                    style={{
                      marginTop: '8px',
                      paddingTop: '8px',
                      borderTop: '1px dashed #fecaca',
                    }}
                  >
                    <label
                      style={{
                        display: 'block',
                        fontSize: '12px',
                        color: '#b91c1c',
                        fontWeight: 600,
                        marginBottom: '4px',
                      }}
                    >
                      ข้อความเพิ่มเติม (ระบุรายละเอียด) *
                    </label>
                    <input
                      type="text"
                      required
                      placeholder="ระบุรายละเอียด เช่น กล่องบุบ, ซีเรียลไม่ตรง, อุปกรณ์ไม่ครบ..."
                      value={itemNotes[itemId] || ''}
                      onChange={(e) => {
                        const val = e.target.value;
                        setItemNotes((prev) => ({ ...prev, [itemId]: val }));
                      }}
                      style={{
                        width: '100%',
                        padding: '6px 10px',
                        fontSize: '13px',
                        border: '1px solid #f87171',
                        borderRadius: '4px',
                        backgroundColor: '#ffffff',
                        boxSizing: 'border-box',
                      }}
                      autoFocus
                    />
                  </div>
                )}
              </div>
            );
          })}

          {accessories.map(([name, qty]) => {
            const isSelected = selectedWrongIds.includes(name);
            const currentReason = itemReasons[name] || rejectReasons[0];

            return (
              <div
                key={name}
                className={`accessory-item ${isSelected ? 'out-of-stock-item' : ''}`}
                style={
                  isSelected
                    ? { borderColor: '#ef4444', backgroundColor: '#fff5f5' }
                    : undefined
                }
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '12px',
                    width: '100%',
                  }}
                >
                  <label
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      cursor: 'pointer',
                      margin: 0,
                      flex: 1,
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleItem(name)}
                    />
                    <span>
                      <strong>อุปกรณ์เสริม:</strong> {name} (จำนวน: {qty} ชิ้น)
                    </span>
                  </label>

                  {isSelected && (
                    <div style={{ flexShrink: 0 }}>
                      <select
                        value={currentReason}
                        onChange={(e) => {
                          const val = e.target.value;
                          setItemReasons((prev) => ({ ...prev, [name]: val }));
                        }}
                        style={{
                          fontSize: '12px',
                          fontWeight: 500,
                          padding: '4px 8px',
                          borderRadius: '6px',
                          border: '1px solid #f87171',
                          backgroundColor: '#ffffff',
                          color: '#b91c1c',
                          cursor: 'pointer',
                        }}
                      >
                        {rejectReasons.map((r) => (
                          <option key={r} value={r}>
                            {r}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>

                {isSelected && currentReason === 'อื่น ๆ' && (
                  <div
                    style={{
                      marginTop: '8px',
                      paddingTop: '8px',
                      borderTop: '1px dashed #fecaca',
                    }}
                  >
                    <label
                      style={{
                        display: 'block',
                        fontSize: '12px',
                        color: '#b91c1c',
                        fontWeight: 600,
                        marginBottom: '4px',
                      }}
                    >
                      ข้อความเพิ่มเติม (ระบุรายละเอียด) *
                    </label>
                    <input
                      type="text"
                      required
                      placeholder="ระบุรายละเอียด เช่น อุปกรณ์มีรอย, กล่องไม่ตรงรุ่น..."
                      value={itemNotes[name] || ''}
                      onChange={(e) => {
                        const val = e.target.value;
                        setItemNotes((prev) => ({ ...prev, [name]: val }));
                      }}
                      style={{
                        width: '100%',
                        padding: '6px 10px',
                        fontSize: '13px',
                        border: '1px solid #f87171',
                        borderRadius: '4px',
                        backgroundColor: '#ffffff',
                        boxSizing: 'border-box',
                      }}
                      autoFocus
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {selectedWrongIds.length === 0 && (
          <p
            style={{
              margin: '8px 0 0',
              fontSize: '12px',
              color: '#b91c1c',
              fontWeight: 500,
            }}
          >
            * กรุณาเลือกสินค้าที่มีปัญหาอย่างน้อย 1 รายการ
          </p>
        )}
      </div>

      <div
        className="actions"
        style={{
          display: 'flex',
          justifyContent: 'flex-end',
          gap: '8px',
        }}
      >
        <Button variant="secondary" onClick={onBack} type="button">
          กลับ
        </Button>
        <Button type="submit" disabled={!isFormValid()}>
          ยืนยันส่งกลับ Stock
        </Button>
      </div>
    </form>
  );
}
