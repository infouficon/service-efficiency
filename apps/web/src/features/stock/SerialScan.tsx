import { useEffect, useRef, useState, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { Notice } from '../../components/ui';
import type { MockSession, SelectionItem } from '../../types/session';
import { addSerialApi, fmpUnitsApi, removeSerialApi, type FmpUnits } from '../../services/sessionApi';
import { itemName, serialsLeft } from '../session/workflow';

/** What the server accepts as a serial number (D92): printable ASCII, no spaces, 1 to 64 characters. */
const SERIAL = /^[\x21-\x7E]{1,64}$/;

type Scan = { itemId: string; sn: string };
/** D104: FileMaker's word on one scanned serial (null: the check is off). */
type FmpCheck = NonNullable<Extract<FmpUnits, { status: 'ok' }>['sn']> | { verdict: 'unavailable'; reason: string } | null;

const fmpCheckOf = (answer: FmpUnits): FmpCheck =>
  answer.status === 'ok' ? (answer.sn ?? null) : answer.status === 'unavailable' ? { verdict: 'unavailable', reason: answer.reason } : null;

/** D104: the little FileMaker mark next to a saved serial. */
function FmpMark({ check }: { check: FmpCheck | undefined }) {
  if (!check || check.verdict === 'unavailable') return null;
  if (check.verdict === 'here')
    return (
      <span className="fmp-mark ok" title="FileMaker: เครื่องนี้ ready ที่สาขานี้">
        ✓ FMP
      </span>
    );
  return (
    <span className="fmp-mark warn" title="FileMaker ยังไม่มีเครื่องนี้ ready ที่สาขานี้">
      {check.verdict === 'other-branch' ? `FMP: อยู่ ${check.branchCode ?? 'สาขาอื่น'}` : 'FMP: ไม่มีใน ready'}
    </span>
  );
}

/**
 * D101: STOCK scans the serial number of each unit at the shelf, one at a time, and every scan is saved at once (the server
 * stamps it), so the order's times are the real ones. One box per main product while units are left; a barcode scanner types
 * the number and presses Enter. The box clears straight away and the scans are saved in order behind it, so a fast scanner
 * never types into a box still waiting for the server. A wrong scan is taken back with ×. The server checks everything again
 * (the unit is in no other open order, no repeat, not more than the quantity).
 * D102: while searching a product can also be ticked "found" without scanning; its serials are then scanned before "send".
 * D104: every saved serial is checked against FileMaker (ready here / in another branch / not ready) and the units FileMaker holds
 * here can be listed; both only inform, nothing waits for them.
 */
export function SerialScan({
  session,
  badge,
  picked,
  onPick,
  onSaved,
}: {
  session: MockSession;
  /** Marks on a product row (sent back by the cashier, the new product of a swap). */
  badge?: (item: SelectionItem) => ReactNode;
  /** D102: the products ticked "found" without (all) their scans; with `onPick`, each row gets that tick box. */
  picked?: string[];
  onPick?: (itemId: string) => void;
  /** The order as the server has it after each saved or removed scan. */
  onSaved: (updated: MockSession) => void;
}) {
  const items = session.selection.items.filter((item) => item.id);
  const [values, setValues] = useState<Record<string, string>>({});
  const [problems, setProblems] = useState<Record<string, string>>({});
  const [queued, setQueued] = useState<Scan[]>([]);
  const [removing, setRemoving] = useState(false);
  const [checks, setChecks] = useState<Record<string, FmpCheck>>({});
  const [lists, setLists] = useState<Record<string, FmpUnits | 'loading'>>({});
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

  // the first product with units left is ready for the scanner as soon as the panel opens
  useEffect(() => {
    const target = firstOpen();
    if (target) boxes.current[target]?.focus();
    // only when the panel opens for this order
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.id]);

  /** D104: asks FileMaker about one serial; a failure only means no mark. */
  const checkSerial = (part: string, sn: string) => {
    fmpUnitsApi(part, sn)
      .then((answer) => setChecks((current) => ({ ...current, [sn]: fmpCheckOf(answer) })))
      .catch(() => undefined);
  };

  // the serials already saved when the panel opens (scanned at the shelf, now at the hand-over) get their mark too
  useEffect(() => {
    for (const item of items) for (const serial of item.serials ?? []) checkSerial(item.product.sku, serial.sn);
    // only when the panel opens for this order
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.id]);

  /** D104: shows (or hides) the units FileMaker holds as ready in this branch for one product. */
  const showFmpUnits = (item: SelectionItem) => {
    const itemId = item.id as string;
    if (lists[itemId]) {
      setLists((current) => Object.fromEntries(Object.entries(current).filter(([key]) => key !== itemId)));
      return;
    }
    setLists((current) => ({ ...current, [itemId]: 'loading' }));
    fmpUnitsApi(item.product.sku)
      .then((answer) => setLists((current) => ({ ...current, [itemId]: answer })))
      .catch(() => setLists((current) => ({ ...current, [itemId]: { status: 'unavailable', reason: 'ตรวจกับ FileMaker ไม่ได้ตอนนี้' } })));
  };

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

  const submit = (item: SelectionItem) => {
    const itemId = item.id as string;
    const sn = (values[itemId] ?? '').trim().toUpperCase();
    if (!sn) return;
    const problem = !SERIAL.test(sn)
      ? 'ใช้ตัวอักษร/ตัวเลขที่พิมพ์ได้ ไม่มีเว้นวรรค ไม่เกิน 64 ตัว'
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
    <div className="stock-note-section serial-scan">
      <strong>
        สแกน Serial Number เครื่องที่หยิบจริง ({saved}/{total})
      </strong>
      <p className="muted" style={{ margin: '4px 0 10px' }}>
        สแกนบาร์โค้ด Serial No. บนกล่องทีละเครื่องตอนหยิบจากชั้น (Mac/iPad ขึ้นต้นด้วย S, iPhone ใช้ IMEI) ระบบบันทึกทันทีพร้อมเวลา
        สแกนผิดกด × แล้วสแกนใหม่
        {onPick ? ' ยังไม่สะดวกสแกน ติ๊ก "พบแล้ว" ไปก่อนได้ แล้วสแกนให้ครบก่อนกดส่ง' : ' ต้องครบก่อนกดส่ง'}
      </p>
      {items.map((item) => {
        const itemId = item.id as string;
        const remaining = left(item);
        const done = serialsLeft(item) === 0;
        const isPicked = done || Boolean(picked?.includes(itemId));
        const problem = problems[itemId];
        const list = lists[itemId];
        const saved = new Set((item.serials ?? []).map((serial) => serial.sn));
        const notHere = (item.serials ?? []).some((serial) => {
          const check = checks[serial.sn];
          return check?.verdict === 'other-branch' || check?.verdict === 'not-ready';
        });
        return (
          <div key={itemId} className="serial-scan-item">
            <div className="serial-scan-head">
              <strong>{itemName(item)}</strong> <span className="muted">× {item.quantity}</span>
              <span className="product-sku-chip">{item.product.sku || '—'}</span>
              {badge?.(item)}
              {onPick && !done && (
                <label className="serial-scan-pick">
                  <input type="checkbox" checked={isPicked} onChange={() => onPick(itemId)} />
                  พบแล้ว
                </label>
              )}
              <span className={`status-tag ${isPicked ? 'status-found' : 'status-searching'}`} style={{ marginLeft: onPick && !done ? undefined : 'auto' }}>
                {done ? 'ครบแล้ว' : `สแกนแล้ว ${item.serials?.length ?? 0}/${item.quantity}`}
              </span>
            </div>
            {(item.serials?.length || waiting(itemId) > 0) && (
              <div className="serial-chips">
                {item.serials?.map((serial) => (
                  <span key={serial.id} className="serial-chip">
                    {serial.sn}
                    <FmpMark check={checks[serial.sn]} />
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
                    submit(item);
                  }}
                />
              </label>
            )}
            {problem && <span className="serial-scan-problem">{problem}</span>}
            {notHere && (
              // D104: FileMaker's `ses` script would refuse (v2) or leave out (v3.1) such a unit
              <span className="serial-pending">
                FileMaker ยังไม่มีเครื่องนี้ ready ที่สาขานี้: หยิบผิด → ลบแล้วสแกนเครื่องอื่น · เครื่องโอนมายังไม่รับโอน → แจ้งรับโอนใน FileMaker
              </span>
            )}
            <div className="fmp-units">
              <button type="button" className="link-button" onClick={() => showFmpUnits(item)}>
                {list ? 'ซ่อนเครื่องใน FileMaker' : 'ดูเครื่องที่ FileMaker มีที่สาขานี้'}
              </button>
              {list === 'loading' && <span className="fine muted">กำลังถาม FileMaker…</span>}
              {list && list !== 'loading' && list.status !== 'ok' && <span className="fine muted">{list.reason}</span>}
              {list && list !== 'loading' && list.status === 'ok' && (
                <>
                  {list.here.filter((sn) => !saved.has(sn)).length ? (
                    <span className="fmp-units-list">
                      {list.here
                        .filter((sn) => !saved.has(sn))
                        .map((sn) => (
                          <button
                            key={sn}
                            type="button"
                            className="serial-chip"
                            title="ใส่ในช่องสแกน (เทียบกับกล่องจริงก่อนกด Enter)"
                            disabled={remaining === 0}
                            onClick={() => {
                              setValues((current) => ({ ...current, [itemId]: sn }));
                              boxes.current[itemId]?.focus();
                            }}
                          >
                            {sn}
                          </button>
                        ))}
                    </span>
                  ) : (
                    <span className="fine muted">FileMaker ไม่มีเครื่อง ready ที่สาขานี้</span>
                  )}
                  {list.elsewhere.length > 0 && (
                    <span className="fine muted">
                      สาขาอื่น: {list.elsewhere.map((e) => `${e.branchCode ?? `#${e.erpBranchId ?? '?'}`} ${e.count}`).join(', ')}
                    </span>
                  )}
                </>
              )}
            </div>
          </div>
        );
      })}
      {items.length === 0 && <Notice>ออเดอร์นี้ไม่มีสินค้าหลักที่ต้องสแกน</Notice>}
    </div>
  );
}
