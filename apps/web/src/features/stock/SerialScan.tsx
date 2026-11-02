import { useEffect, useMemo, useRef, useState } from 'react';
import { Send } from 'lucide-react';
import { Button, Notice } from '../../components/ui';
import type { MockSession } from '../../types/session';
import { itemName } from '../session/workflow';

/** What the server accepts as a serial number (D92): printable ASCII, no spaces, 1 to 64 characters. */
const SERIAL = /^[\x21-\x7E]{1,64}$/;

export type SerialsByItem = { itemId: string; sn: string[] }[];

/**
 * D92: STOCK scans the serial number of every unit before sending the goods to the cashier (the FileMaker bill script opens the
 * bill from them). One box per unit, grouped by product. A barcode scanner types the number and presses Enter, which moves on to
 * the next box; the send button wakes up when every box is filled, valid and different. The server checks all of it again.
 */
export function SerialScan({
  session,
  busy,
  onSend,
  onCancel,
}: {
  session: MockSession;
  busy: boolean;
  onSend: (serials: SerialsByItem) => void;
  onCancel: () => void;
}) {
  const items = useMemo(() => session.selection.items.filter((item) => item.id), [session.selection.items]);
  const [values, setValues] = useState<Record<string, string[]>>(() =>
    Object.fromEntries(items.map((item) => [item.id as string, Array.from({ length: item.quantity }, (_, i) => item.serials?.[i] ?? '')])),
  );
  const boxes = useRef<Record<string, HTMLInputElement | null>>({});
  const actions = useRef<HTMLDivElement | null>(null);
  const order = useMemo(() => items.flatMap((item) => Array.from({ length: item.quantity }, (_, i) => `${item.id}:${i}`)), [items]);

  // the first empty box is ready for the scanner as soon as the panel opens
  useEffect(() => {
    const firstEmpty = order.find((key) => !(values[key.split(':')[0]]?.[Number(key.split(':')[1])] ?? '').trim());
    boxes.current[firstEmpty ?? order[0]]?.focus();
    // only when the panel opens for this order
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.id]);

  const all = Object.values(values).flat().map((v) => v.trim());
  const seen = new Map<string, number>();
  for (const v of all) if (v) seen.set(v.toLowerCase(), (seen.get(v.toLowerCase()) ?? 0) + 1);
  const problem = (value: string): string => {
    const v = value.trim();
    if (!v) return '';
    if (!SERIAL.test(v)) return 'ใช้ตัวอักษร/ตัวเลขที่พิมพ์ได้ ไม่มีเว้นวรรค ไม่เกิน 64 ตัว';
    if ((seen.get(v.toLowerCase()) ?? 0) > 1) return 'ซ้ำกับเครื่องอื่นในออเดอร์นี้';
    return '';
  };
  const total = order.length;
  const filled = all.filter(Boolean).length;
  const ready = total > 0 && filled === total && all.every((v) => !problem(v));

  const setValue = (itemId: string, index: number, value: string) =>
    setValues((current) => ({ ...current, [itemId]: current[itemId].map((v, i) => (i === index ? value : v)) }));

  const next = (key: string) => {
    const after = order[order.indexOf(key) + 1];
    if (after) boxes.current[after]?.focus();
    else actions.current?.querySelector('button')?.focus();
  };

  return (
    <div className="stock-note-section serial-scan">
      <strong>สแกน Serial Number ของสินค้าทุกเครื่อง ({filled}/{total})</strong>
      <p className="muted" style={{ margin: '4px 0 10px' }}>
        สแกนหรือพิมพ์ SN ของเครื่องที่หยิบจริง ทีละเครื่อง กด Enter เพื่อไปช่องถัดไป ต้องครบก่อนจึงส่งไปแคชเชียร์ได้
      </p>
      {items.map((item) => (
        <div key={item.id} className="serial-scan-item">
          <div>
            <strong>{itemName(item)}</strong> <span className="muted">× {item.quantity}</span>
            <span className="product-sku-chip" style={{ marginLeft: '6px' }}>
              {item.product.sku || '—'}
            </span>
          </div>
          {Array.from({ length: item.quantity }, (_, index) => {
            const key = `${item.id}:${index}`;
            const value = values[item.id as string]?.[index] ?? '';
            const why = problem(value);
            return (
              <label key={key} className="serial-scan-box">
                <span className="fine muted">เครื่องที่ {index + 1}</span>
                <input
                  ref={(element) => {
                    boxes.current[key] = element;
                  }}
                  value={value}
                  maxLength={80}
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="สแกน SN"
                  aria-label={`${itemName(item)} เครื่องที่ ${index + 1} Serial Number`}
                  aria-invalid={Boolean(why)}
                  disabled={busy}
                  onChange={(e) => setValue(item.id as string, index, e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key !== 'Enter') return;
                    e.preventDefault(); // a scanner ends with Enter: never submit anything by accident
                    if (value.trim() && !why) next(key);
                  }}
                />
                {why && <span className="serial-scan-problem">{why}</span>}
              </label>
            );
          })}
        </div>
      ))}
      {total === 0 && <Notice>ออเดอร์นี้ไม่มีสินค้าหลักที่ต้องสแกน</Notice>}
      <div className="actions" style={{ marginTop: '12px' }} ref={actions}>
        <Button
          disabled={busy || (total > 0 && !ready)}
          onClick={() => onSend(items.map((item) => ({ itemId: item.id as string, sn: (values[item.id as string] ?? []).map((v) => v.trim()) })))}
        >
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
            <Send size={16} />
            ส่งสินค้าไปที่แคชเชียร์ (SENT_TO_CASHIER)
          </span>
        </Button>
        <Button variant="danger" onClick={onCancel}>
          ลูกค้ายกเลิก
        </Button>
      </div>
    </div>
  );
}
