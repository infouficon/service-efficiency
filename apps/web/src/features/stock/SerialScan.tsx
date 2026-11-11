import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Camera, Check, X } from 'lucide-react';
import { Notice } from '../../components/ui';
import type { MockSession, SelectionItem } from '../../types/session';
import { addSerialApi, removeSerialApi, serialCheckApi, type SerialCheck } from '../../services/sessionApi';
import { itemName, serialsLeft } from '../session/workflow';
import { CameraScan } from './CameraScan';
import { createWedgeReader, serialKindOf, serialProblem } from './scanning';

/** The camera needs a secure page and a browser that can reach it. */
const canUseCamera = () => typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia);

type Scan = { itemId: string; sn: string };
/** D104: FileMaker's word on one scanned serial (null: the check is off, the default since D111, or could not answer). */
type StockCheck = Extract<SerialCheck, { status: 'ok' }> | null;

/** D104: the little stock mark next to a saved serial. */
function StockMark({ check }: { check: StockCheck | undefined }) {
  if (!check) return null;
  const title = 'FileMaker ตอนนี้';
  if (check.verdict === 'here')
    return (
      <span className="fmp-mark ok" title={`${title}: ready ที่สาขานี้`} style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
        <Check size={12} strokeWidth={1.75} /> สต็อก
      </span>
    );
  const text =
    check.verdict === 'other-branch'
      ? `อยู่ ${check.branchCode ?? 'สาขาอื่น'}`
      : check.verdict === 'not-ready'
        ? `สถานะ ${check.stockStatus || '-'}`
        : check.verdict === 'other-model'
          ? 'รุ่นไม่ตรง'
          : 'ไม่พบในสต็อก';
  return (
    <span className="fmp-mark warn" title={title}>
      {text}
    </span>
  );
}

/**
 * D101: STOCK scans the serial number of each unit at the shelf, one at a time, and every scan is saved at once (the server
 * stamps it), so the order's times are the real ones. One box per main product while units are left; a barcode scanner types
 * the number and presses Enter. The box clears straight away and the scans are saved in order behind it, so a fast scanner
 * never types into a box still waiting for the server. A wrong scan is taken back with ×. The server checks everything again
 * (the unit is in no other open order, no repeat, not more than the quantity).
 * D111: there is no "found" tick any more (D102 is gone): a main product is found when all its units are scanned, and "send" needs that.
 * D104: with `SERIAL_CHECK=fmp` every saved serial is checked against FileMaker (ready here / another branch / not ready / another
 * model / not in stock); it only informs, nothing waits for it. D111: off by default; FileMaker checks the serials when STOCK sends.
 * D108: the phone camera can read the label (📷 on each product), and a barcode scanner works without tapping a box first: a
 * scan typed while nothing editable has the focus goes to the first product with units left.
 */
export function SerialScan({
  session,
  badge,
  onSaved,
  focusKey,
}: {
  session: MockSession;
  /** Changes every time the order is opened, so the scanner box gets the focus again (a phone keeps the panel mounted). */
  focusKey?: number;
  /** Marks on a product row (sent back by the cashier, the new product of a swap). */
  badge?: (item: SelectionItem) => ReactNode;
  /** The order as the server has it after each saved or removed scan. */
  onSaved: (updated: MockSession) => void;
}) {
  const items = session.selection.items.filter((item) => item.id);
  const [values, setValues] = useState<Record<string, string>>({});
  const [problems, setProblems] = useState<Record<string, string>>({});
  const [queued, setQueued] = useState<Scan[]>([]);
  const [removing, setRemoving] = useState(false);
  const [checks, setChecks] = useState<Record<string, StockCheck>>({});
  const [cameraFor, setCameraFor] = useState<string | null>(null);
  const [allDone, setAllDone] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);
  const boxes = useRef<Record<string, HTMLInputElement | null>>({});
  const queue = useRef<Scan[]>([]);
  const draining = useRef(false);
  const latestOnSaved = useRef(onSaved);
  useEffect(() => {
    latestOnSaved.current = onSaved;
  });

  const waiting = (itemId: string) => queued.filter((scan) => scan.itemId === itemId).length;
  const left = (item: SelectionItem) => Math.max(0, serialsLeft(item) - waiting(item.id as string));
  const firstOpen = (except?: string) => items.find((item) => item.id !== except && left(item) > 0)?.id;

  // the first product with units left is ready for the scanner as soon as the panel opens (and it is on screen)
  useEffect(() => {
    const target = firstOpen();
    const box = target ? boxes.current[target] : null;
    if (box?.offsetParent) box.focus();
    // only when the panel opens for this order
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.id, focusKey]);

  /** D104: asks about one serial; "off", "unavailable" or a failure only mean no mark. */
  const checkSerial = (part: string, sn: string) => {
    serialCheckApi(sn, part)
      .then((answer) => setChecks((current) => ({ ...current, [sn]: answer.status === 'ok' ? answer : null })))
      .catch(() => undefined);
  };

  // the serials already saved when the panel opens (scanned at the shelf, now at the hand-over) get their mark too
  useEffect(() => {
    for (const item of items) for (const serial of item.serials ?? []) checkSerial(item.product.sku, serial.sn);
    // only when the panel opens for this order
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.id]);

  const drain = async () => {
    if (draining.current || !session.id) return;
    draining.current = true;
    while (queue.current.length) {
      const scan = queue.current[0];
      try {
        const updated = await addSerialApi(session.id, scan.itemId, scan.sn);
        latestOnSaved.current(updated);
        const part = updated.selection.items.find((item) => item.id === scan.itemId)?.product.sku;
        if (part) checkSerial(part, scan.sn);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'บันทึกไม่สำเร็จ';
        setProblems((current) => ({ ...current, [scan.itemId]: `${scan.sn}: ${message}` }));
      }
      queue.current = queue.current.slice(1);
      setQueued(queue.current);
    }
    draining.current = false;
  };

  /** One serial for one product, from the box, the camera or a scanner without focus: checked here, then queued for the server. */
  const submit = (item: SelectionItem, raw: string) => {
    const itemId = item.id as string;
    const sn = raw.trim().toUpperCase();
    if (!sn) return;
    // D124/D125: an IMEI that is not 15 digits with a valid check digit, or the wrong kind of number for this product
    const kind = serialKindOf(item.product.category, item.product.product, item.product.model);
    const problem = serialProblem(sn, kind)
      ? serialProblem(sn, kind)
      : session.selection.items.some((one) => one.serials?.some((serial) => serial.sn === sn)) ||
          queue.current.some((scan) => scan.sn === sn)
        ? 'สแกนเครื่องนี้ไปแล้วในออเดอร์นี้'
        : '';
    if (problem) {
      setProblems((current) => ({ ...current, [itemId]: problem }));
      return;
    }
    queue.current = [...queue.current, { itemId, sn }];
    setQueued(queue.current);
    setValues((current) => ({ ...current, [itemId]: '' }));
    setProblems((current) => ({ ...current, [itemId]: '' }));
    // this product is done: the scanner goes on with the next one
    if (left(item) - 1 <= 0) {
      const next = firstOpen(itemId);
      if (next) boxes.current[next]?.focus();
    }
    void drain();
  };

  // D108: a scanner used while no box has the focus; `scanAnywhere` always sees the latest state
  const scanAnywhere = useRef<(text: string) => void>(() => undefined);
  useEffect(() => {
    scanAnywhere.current = (text: string) => {
      const target = items.find((item) => item.id === firstOpen());
      if (!target) {
        setAllDone(`${text.trim().toUpperCase()}: ทุกเครื่องในออเดอร์นี้สแกนครบแล้ว`);
        return;
      }
      setAllDone('');
      submit(target, text);
    };
  });
  useEffect(() => {
    const read = createWedgeReader((text) => scanAnywhere.current(text));
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || !rootRef.current?.offsetParent) return;
      const target = e.target instanceof HTMLElement ? e.target : null;
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) return; // that box takes the typing itself
      if (read(e.key, e.timeStamp)) {
        e.preventDefault(); // the scanner's Enter must not press a focused button
        e.stopPropagation();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  const remove = async (item: SelectionItem, serialId: string) => {
    if (!session.id) return;
    setRemoving(true);
    try {
      latestOnSaved.current(await removeSerialApi(session.id, serialId));
      setProblems((current) => ({ ...current, [item.id as string]: '' }));
    } catch (err: unknown) {
      setProblems((current) => ({ ...current, [item.id as string]: err instanceof Error ? err.message : 'ลบไม่สำเร็จ' }));
    } finally {
      setRemoving(false);
    }
  };

  const total = items.reduce((sum, item) => sum + item.quantity, 0);
  const saved = items.reduce((sum, item) => sum + Math.min(item.quantity, item.serials?.length ?? 0), 0);

  return (
    <div className="stock-note-section serial-scan" ref={rootRef}>
      <strong>
        สแกน Serial Number เครื่องที่หยิบจริง ({saved}/{total})
      </strong>
      <p className="muted" style={{ margin: '4px 0 10px' }}>
        สแกนบาร์โค้ด Serial No. บนกล่องทีละเครื่องตอนหยิบ (Mac / iPad Wi-Fi / Watch GPS ใช้ Serial No. ขึ้นต้นด้วยตัวอักษร · iPhone / iPad Cellular / Watch Cellular ใช้ IMEI 15 หลัก) เครื่องสแกนยิงได้เลยไม่ต้องกดที่ช่อง
        หรือกดปุ่มกล้องเพื่อใช้กล้องมือถือ สแกนผิดกด × แล้วสแกนใหม่ ต้องครบทุกเครื่องก่อนกดส่ง (อุปกรณ์เสริมไม่ต้องสแกน)
      </p>
      {allDone && <span className="serial-scan-problem">{allDone}</span>}
      {items.map((item) => {
        const itemId = item.id as string;
        const remaining = left(item);
        const done = serialsLeft(item) === 0;
        const problem = problems[itemId];
        const warned = (item.serials ?? []).map((serial) => checks[serial.sn]).find((check) => check && check.verdict !== 'here');
        return (
          <div key={itemId} className="serial-scan-item">
            <div className="serial-scan-head">
              <strong>{itemName(item)}</strong> <span className="muted">× {item.quantity}</span>
              <span className="product-sku-chip">{item.product.sku || '—'}</span>
              {badge?.(item)}
              <span className={`status-tag ${done ? 'status-found' : 'status-searching'}`} style={{ marginLeft: 'auto' }}>
                {done ? 'ครบแล้ว' : `สแกนแล้ว ${item.serials?.length ?? 0}/${item.quantity}`}
              </span>
            </div>
            {(item.serials?.length || waiting(itemId) > 0) && (
              <div className="serial-chips">
                {item.serials?.map((serial) => (
                  <span key={serial.id} className="serial-chip">
                    {serial.sn}
                    <StockMark check={checks[serial.sn]} />
                    <button
                      type="button"
                      aria-label={`ลบ SN ${serial.sn}`}
                      title="สแกนผิด ลบแล้วสแกนใหม่"
                      disabled={removing || queued.length > 0}
                      onClick={() => remove(item, serial.id)}
                    >
                      <X size={12} />
                    </button>
                  </span>
                ))}
                {queued
                  .filter((scan) => scan.itemId === itemId)
                  .map((scan) => (
                    <span key={scan.sn} className="serial-chip saving">
                      {scan.sn} · กำลังบันทึก…
                    </span>
                  ))}
              </div>
            )}
            {remaining > 0 && (
              <div className="serial-scan-row">
                <label className="serial-scan-box">
                  <span className="fine muted">
                    เครื่องที่ {item.quantity - remaining + 1}/{item.quantity}
                  </span>
                  <input
                    ref={(element) => {
                      boxes.current[itemId] = element;
                    }}
                    value={values[itemId] ?? ''}
                    maxLength={80}
                    autoComplete="off"
                    spellCheck={false}
                    enterKeyHint="done"
                    placeholder="สแกน SN"
                    aria-label={`${itemName(item)} Serial Number เครื่องที่ ${item.quantity - remaining + 1}`}
                    aria-invalid={Boolean(problem)}
                    onChange={(e) => setValues((current) => ({ ...current, [itemId]: e.target.value.toUpperCase() }))}
                    onKeyDown={(e) => {
                      if (e.key !== 'Enter') return;
                      e.preventDefault(); // a scanner ends with Enter: never submit anything by accident
                      submit(item, values[itemId] ?? '');
                    }}
                  />
                </label>
                <div className="serial-scan-actions">
                  {canUseCamera() && (
                    <button type="button" className="serial-scan-camera" onClick={() => setCameraFor(itemId)}>
                      <Camera size={18} />
                      กล้อง
                    </button>
                  )}
                </div>
              </div>
            )}
            {cameraFor === itemId && (
              <CameraScan
                title={itemName(item)}
                expect={remaining}
                skip={[
                  ...session.selection.items.flatMap((one) => (one.serials ?? []).map((serial) => serial.sn)),
                  ...queued.map((scan) => scan.sn),
                ]}
                problem={problem}
                accepts={(sn) => !serialProblem(sn, serialKindOf(item.product.category, item.product.product, item.product.model))}
                onScan={(sn) => submit(item, sn)}
                onClose={() => setCameraFor(null)}
              />
            )}
            {problem && <span className="serial-scan-problem">{problem}</span>}
            {warned && (
              // D104: FileMaker's `ses` script would refuse (v2) or leave out (v3.1) such a unit
              <span className="serial-pending">
                {warned.verdict === 'other-model'
                  ? 'SN นี้เป็นรุ่นอื่น: หยิบผิด → ลบแล้วสแกนเครื่องที่ถูกรุ่น'
                  : 'ตาม FileMaker เครื่องนี้ยังไม่ ready ที่สาขานี้: หยิบผิด → ลบแล้วสแกนเครื่องอื่น · เครื่องโอนมายังไม่รับโอน → แจ้งรับโอนใน FileMaker'}
              </span>
            )}
          </div>
        );
      })}
      {items.length === 0 && <Notice>ออเดอร์นี้ไม่มีสินค้าหลักที่ต้องสแกน</Notice>}
    </div>
  );
}
