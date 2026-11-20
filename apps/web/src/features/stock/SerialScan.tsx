import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AlertCircle, Camera, Check, X } from 'lucide-react';
import { BusyOverlay } from '../../components/BusyOverlay';
import { Button, Modal, Notice } from '../../components/ui';
import type { MockSession, SelectionItem } from '../../types/session';
import { addSerialApi, removeSerialApi, serialCheckApi, type SerialCheck } from '../../services/sessionApi';
import { itemName, serialsLeft } from '../session/workflow';
import { BranchUnitsList, BranchUnitsLookup } from './BranchUnits';
import { CameraScan } from './CameraScan';
import { createWedgeReader, serialKindOf, serialProblem } from './scanning';

/** D184: the screen waits for one FileMaker check at most this long (the server gives UAT 15 s); a late answer still sets the mark. */
const CHECK_WAIT_MS = 15_000;

/** D184: a page under a BusyOverlay is inert; a barcode scanner still types into the window, so its scans are refused then. */
const pageLocked = () => document.getElementById('root')?.inert === true;

/** The camera needs a secure page and a browser that can reach it. */
const canUseCamera = () => typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia);

type Scan = { itemId: string; sn: string };
/** D104: FileMaker's word on one scanned serial (null: the check is off, the default since D111, or could not answer). */
type StockCheck = Extract<SerialCheck, { status: 'ok' }> | null;

/** D104: the little stock mark next to a saved serial. */
function StockMark({ check }: { check: StockCheck | undefined }) {
  if (!check) return null;
  const title = check.target === 'UAT' ? 'FileMaker UAT (ทดสอบ) ตอนนี้' : 'FileMaker ตอนนี้';
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
 * model / not in stock); the answer only informs. D111: off by default; FileMaker checks the serials when STOCK sends.
 * D184: while a scan is being saved or checked, the whole page is locked (BusyOverlay) until the answer is back, so nothing is
 * pressed twice and STOCK sees it is working. A scan fired at the locked page is not saved and says so: scan it again after.
 * D185: scanning the box stays the way. When STOCK cannot find the unit, "หาไม่เจอ?" under the box lists what U•POS has ready of
 * that model here; a unit tapped there (or in the list after a wrong scan) is only used after STOCK confirms it matches the box.
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
  /** D184: serials whose FileMaker check is still out (a serial can be in twice: once per check) */
  const [checking, setChecking] = useState<string[]>([]);
  const [cameraFor, setCameraFor] = useState<string | null>(null);
  /** a scan that went nowhere: every unit is scanned already, or the page was locked (D184) */
  const [notice, setNotice] = useState('');
  /** D185: a unit tapped in a branch list, waiting for STOCK to confirm it matches the box in hand */
  const [picking, setPicking] = useState<{ item: SelectionItem; sn: string; codeLabel: string } | null>(null);
  const [showGuideModal, setShowGuideModal] = useState(false);
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

  /** D104: asks about one serial; "off", "unavailable" or a failure only mean no mark. D184: the page waits for it (CHECK_WAIT_MS at most). */
  const checkSerial = (part: string, sn: string) => {
    setChecking((current) => [...current, sn]);
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      setChecking((current) => {
        const at = current.indexOf(sn);
        return at < 0 ? current : [...current.slice(0, at), ...current.slice(at + 1)];
      });
    };
    const giveUp = window.setTimeout(finish, CHECK_WAIT_MS);
    serialCheckApi(sn, part, session.id)
      .then((answer) => setChecks((current) => ({ ...current, [sn]: answer.status === 'ok' ? answer : null })))
      .catch(() => undefined)
      .finally(() => {
        window.clearTimeout(giveUp);
        finish();
      });
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
    const kind = serialKindOf(
      item.product.category,
      item.product.product,
      item.product.modelName,
      item.product.model,
      item.product.attributes ? JSON.stringify(item.product.attributes) : '',
    );
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
    setNotice('');
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
      const sn = text.trim().toUpperCase();
      if (pageLocked()) {
        setNotice(`${sn} ยังไม่ได้บันทึก: รอตรวจสอบเสร็จก่อน แล้วสแกนเครื่องนี้ใหม่`);
        return;
      }
      const target = items.find((item) => item.id === firstOpen());
      if (!target) {
        setNotice(`${sn}: ทุกเครื่องในออเดอร์นี้สแกนครบแล้ว`);
        return;
      }
      setNotice('');
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
  // D184: what the locked page is waiting for
  const waitingFor = queued.length ? 'กำลังบันทึก IMEI/SN' : checking.length ? 'กำลังตรวจสอบ IMEI/SN กับ U•POS' : '';
  // D185: serials this order has (saved or on their way), so a branch list never offers them again
  const used = [...session.selection.items.flatMap((one) => (one.serials ?? []).map((serial) => serial.sn)), ...queued.map((scan) => scan.sn)];

  return (
    <div className="stock-note-section serial-scan" ref={rootRef}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', marginBottom: '8px' }}>
        <strong>
          สแกน Serial Number / IMEI ({saved}/{total})
        </strong>
        <button
          type="button"
          onClick={() => setShowGuideModal(true)}
          aria-label="ดูคำแนะนำการสแกน Serial Number"
          title="ดูคำแนะนำการสแกน"
          style={{
            border: 'none',
            background: 'rgba(10, 186, 181, 0.12)',
            color: 'var(--primary)',
            borderRadius: '50%',
            width: '24px',
            height: '24px',
            minWidth: '24px',
            minHeight: '24px',
            maxWidth: '24px',
            maxHeight: '24px',
            aspectRatio: '1 / 1',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            padding: 0,
            flexShrink: 0,
            alignSelf: 'center',
            transition: 'background-color 150ms ease',
          }}
        >
          <AlertCircle size={15} />
        </button>
      </div>

      <Modal
        isOpen={showGuideModal}
        onClose={() => setShowGuideModal(false)}
        title={
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', color: 'var(--primary-dark)' }}>
            <AlertCircle size={20} color="var(--primary)" />
            คำแนะนำการสแกน Serial Number
          </span>
        }
        maxWidth="520px"
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', fontSize: '14px', lineHeight: '1.5' }}>
          <div>
            <h4 style={{ margin: '0 0 6px', fontSize: '14px', fontWeight: 700, color: 'var(--text-primary)' }}>
              1. ชนิดของรหัสที่ต้องสแกนตามหมวดสินค้า
            </h4>
            <ul style={{ margin: '0', paddingLeft: '20px', color: 'var(--text-secondary)' }}>
              <li>
                <strong>Mac / iPad รุ่น Wi-Fi / Watch รุ่น GPS:</strong> ใช้ <em>Serial Number</em> (ขึ้นต้นด้วยตัวอักษร)
              </li>
              <li>
                <strong>iPhone / iPad รุ่น Cellular / Watch รุ่น Cellular:</strong> ใช้ <em>IMEI</em> (เลข 15 หลัก)
              </li>
            </ul>
          </div>

          <div>
            <h4 style={{ margin: '0 0 6px', fontSize: '14px', fontWeight: 700, color: 'var(--text-primary)' }}>
              2. วิธีการสแกน
            </h4>
            <ul style={{ margin: '0', paddingLeft: '20px', color: 'var(--text-secondary)' }}>
              <li>
                <strong>เครื่องสแกนบาร์โค้ด (Wedge Scanner):</strong> สามารถยิงบาร์โค้ดบนกล่องได้ทันทีโดยไม่ต้องคลิกโฟกัสที่ช่องใดๆ
              </li>
              <li>
                <strong>กล้องสมาร์ทโฟน/แท็บเล็ต:</strong> กดปุ่มไอคอนกล้อง <Camera size={13} style={{ verticalAlign: 'middle' }} /> เพื่อเปิดกล้องสแกน
              </li>
            </ul>
          </div>

          <div>
            <h4 style={{ margin: '0 0 6px', fontSize: '14px', fontWeight: 700, color: 'var(--text-primary)' }}>
              3. การแก้ไขข้อผิดพลาด
            </h4>
            <ul style={{ margin: '0', paddingLeft: '20px', color: 'var(--text-secondary)' }}>
              <li>หากสแกนผิดกล่องหรือผิดเครื่อง ให้กดปุ่ม <strong>×</strong> บนกล่อง Serial นั้นเพื่อลบออก แล้วสแกนใหม่</li>
            </ul>
          </div>

          <div>
            <h4 style={{ margin: '0 0 6px', fontSize: '14px', fontWeight: 700, color: 'var(--text-primary)' }}>
              4. เงื่อนไขการส่งต่อ
            </h4>
            <ul style={{ margin: '0', paddingLeft: '20px', color: 'var(--text-secondary)' }}>
              <li>ต้องสแกนให้ครบถ้วนทุกเครื่องตามจำนวนที่แสดง จึงจะสามารถกดส่งมอบได้ (อุปกรณ์เสริมไม่ต้องสแกน)</li>
            </ul>
          </div>

          <div style={{ marginTop: '8px', display: 'flex', justifyContent: 'flex-end' }}>
            <Button variant="primary" onClick={() => setShowGuideModal(false)}>
              เข้าใจแล้ว
            </Button>
          </div>
        </div>
      </Modal>
      <BusyOverlay show={Boolean(waitingFor)} text={waitingFor} note={notice || undefined} />
      <Modal isOpen={picking !== null} onClose={() => setPicking(null)} title="ใช้เครื่องนี้?" maxWidth="420px">
        {picking && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', fontSize: '14px', lineHeight: 1.5 }}>
            <div className="pick-confirm-sn">{picking.sn}</div>
            <div>
              เทียบเลขนี้กับเลข {picking.codeLabel} บนกล่องที่หยิบมาให้ตรงทุกหลักก่อนยืนยัน
              <div className="muted fine">ถ้าไม่ตรง เลขในบิลจะไม่ตรงกับเครื่องที่ส่งให้ลูกค้า</div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
              <Button variant="secondary" onClick={() => setPicking(null)}>
                ยกเลิก
              </Button>
              <Button
                onClick={() => {
                  submit(picking.item, picking.sn);
                  setPicking(null);
                }}
              >
                ตรงกับกล่อง ใช้เครื่องนี้
              </Button>
            </div>
          </div>
        )}
      </Modal>
      {notice && <span className="serial-scan-problem">{notice}</span>}
      {items.map((item) => {
        const itemId = item.id as string;
        const remaining = left(item);
        const done = serialsLeft(item) === 0;
        const problem = problems[itemId];
        const warned = (item.serials ?? []).map((serial) => checks[serial.sn]).find((check) => check && check.verdict !== 'here');
        const kind = serialKindOf(
          item.product.category,
          item.product.product,
          item.product.modelName,
          item.product.model,
          item.product.sku,
          item.product.attributes ? JSON.stringify(item.product.attributes) : '',
        );
        const isImei = kind === 'imei';
        const codeLabel = isImei ? 'IMEI' : 'Serial Number';
        const codeLabelShort = isImei ? 'IMEI' : 'SN';
        const scanPlaceholder = isImei ? 'สแกน IMEI' : 'สแกน SN';
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
                      aria-label={`ลบ ${codeLabelShort} ${serial.sn}`}
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
                  <input
                    ref={(element) => {
                      boxes.current[itemId] = element;
                    }}
                    value={values[itemId] ?? ''}
                    maxLength={80}
                    autoComplete="off"
                    spellCheck={false}
                    enterKeyHint="done"
                    placeholder={scanPlaceholder}
                    aria-label={`${itemName(item)} ${codeLabel} เครื่องที่ ${item.quantity - remaining + 1}`}
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
                    <button
                      type="button"
                      className="serial-scan-camera"
                      onClick={() => setCameraFor(itemId)}
                      aria-label={`สแกน ${codeLabelShort} ด้วยกล้อง: ${itemName(item)}`}
                    >
                      <Camera size={18} />
                      กล้อง
                    </button>
                  )}
                </div>
              </div>
            )}
            {cameraFor === itemId && (
              <CameraScan
                title={`${itemName(item)} (${codeLabelShort})`}
                expect={remaining}
                skip={[
                  ...session.selection.items.flatMap((one) => (one.serials ?? []).map((serial) => serial.sn)),
                  ...queued.map((scan) => scan.sn),
                ]}
                problem={problem}
                accepts={(sn) => !serialProblem(sn, kind)}
                onScan={(sn) => submit(item, sn)}
                onClose={() => setCameraFor(null)}
              />
            )}
            {problem && <span className="serial-scan-problem">{problem}</span>}
            {warned && (
              // D104: FileMaker's `ses` script would refuse (v2) or leave out (v3.1) such a unit
              <span className="serial-pending">
                {warned.verdict === 'other-model'
                  ? 'เครื่องนี้เป็นรุ่นอื่น: กด × แล้วสแกนเครื่องที่ถูกรุ่น'
                  : 'U•POS ไม่พบเครื่องนี้พร้อมขายที่สาขานี้: ถ้าหยิบผิด กด × แล้วสแกนเครื่องอื่น · ถ้าเป็นเครื่องที่โอนมา ให้รับโอนใน U•POS ก่อน'}
              </span>
            )}
            {/* D183: what this branch does have of the model, so the right box can be found; D185: tap one to use it */}
            {warned?.model && warned.branchUnits ? (
              <BranchUnitsList
                model={warned.model}
                units={warned.branchUnits}
                target={warned.target}
                asOf={warned.asOf}
                used={used}
                onPick={remaining > 0 ? (sn) => setPicking({ item, sn, codeLabel }) : undefined}
              />
            ) : (
              remaining > 0 &&
              item.product.sku && (
                // D185: the way out when the box cannot be found or its label will not scan; scanning stays the first way
                <BranchUnitsLookup
                  part={item.product.sku}
                  branchCode={session.branchCode}
                  sessionId={session.id}
                  label={`หาไม่เจอ? ดู ${codeLabel} รุ่นนี้ที่มีในสาขา`}
                  used={used}
                  onPick={(sn) => setPicking({ item, sn, codeLabel })}
                />
              )
            )}
          </div>
        );
      })}
      {items.length === 0 && <Notice>ออเดอร์นี้ไม่มีสินค้าหลักที่ต้องสแกน</Notice>}
    </div>
  );
}
