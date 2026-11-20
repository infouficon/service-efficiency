import { useState } from 'react';
import { Search } from 'lucide-react';
import { BusyOverlay } from '../../components/BusyOverlay';
import { branchUnitsApi, type BranchUnits, type BranchUnitsAnswer } from '../../services/sessionApi';
import type { FmpStatus } from '../../types/session';
import { SN_CODE } from '../admin/FmpPanel';

/** Shown before the list is cut, so a branch with many units of one model does not fill the screen. */
const SHOW_FIRST = 30;

const timeText = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' }) : '';

/** D185: why FileMaker left a serial off the bill, in the shop's words (ADMIN's FMP panel keeps the short codes, SN_CODE). */
const SN_REASON: Record<string, string> = {
  SN_NOT_FOUND: 'ไม่พบเครื่องนี้ในสต็อก',
  SN_WRONG_BRANCH: 'เครื่องนี้อยู่สาขาอื่น',
  SN_NOT_READY_FOR_SALE: 'เครื่องนี้ยังไม่พร้อมขาย (เช่น ยังไม่รับโอน)',
  SN_MODEL_MISMATCH: 'เป็นเครื่องคนละรุ่นกับที่สั่ง',
  SN_ALREADY_SOLD_OR_HELD: 'เครื่องนี้ขายไปแล้ว หรือติดบิลอื่นอยู่',
};

/**
 * D183: "MJXQ4ZP/A ready at this branch: 13 units", then the units, so STOCK can find the box it should have scanned.
 * A unit another open SES order already holds says which queue (it cannot be used again, D92).
 * D185: with `onPick`, a free unit can be tapped to use it (SerialScan asks STOCK to check it against the box first). `used` are
 * the serials this order has already, marked as such even if the list was fetched before they were scanned.
 */
export function BranchUnitsList({
  model,
  units,
  target,
  asOf,
  onRefresh,
  onPick,
  used = [],
}: {
  model: string;
  units: BranchUnits;
  target?: 'PRODUCTION' | 'UAT';
  asOf?: string | null;
  /** shown as "ถามใหม่" when given */
  onRefresh?: () => void;
  onPick?: (sn: string) => void;
  used?: string[];
}) {
  const [all, setAll] = useState(false);
  const shown = all ? units.units : units.units.slice(0, SHOW_FIRST);
  const when = [target === 'UAT' ? 'U•POS ทดสอบ' : '', asOf ? `ข้อมูล ${timeText(asOf)}` : ''].filter(Boolean).join(' · ');
  return (
    <div className="branch-units">
      <div>
        {units.count === 0 ? (
          <>
            ไม่มีรุ่น <strong>{model}</strong> พร้อมขายที่สาขานี้ ให้เช็ครับโอน/สต็อกใน U•POS
          </>
        ) : (
          <>
            รุ่น <strong>{model}</strong> พร้อมขายที่สาขานี้{' '}
            <strong>
              {units.count}
              {units.more ? '+' : ''}
            </strong>{' '}
            เครื่อง
          </>
        )}
        {when && <span className="muted"> ({when})</span>}
        {onRefresh && (
          <>
            {' '}
            <button type="button" className="branch-units-more" onClick={onRefresh}>
              ถามใหม่
            </button>
          </>
        )}
      </div>
      {onPick && units.units.length > 0 && <div className="muted fine">แตะเลขเพื่อเลือก แล้วเทียบกับเลขบนกล่องก่อนยืนยัน</div>}
      {units.units.length > 0 && (
        <div className="branch-units-list">
          {shown.map((unit) => {
            const taken = used.includes(unit.sn) ? 'ออเดอร์นี้' : unit.taken;
            const label = `${unit.sn}${taken ? ` · ${taken}` : ''}`;
            const title = taken ? `สแกนอยู่ใน${taken}แล้ว (ออเดอร์ที่ยังไม่จบ) ใช้ซ้ำไม่ได้` : 'พร้อมขายที่สาขานี้';
            return onPick && !taken ? (
              <button key={unit.sn} type="button" className="branch-unit pick" title="แตะเพื่อเลือกเครื่องนี้" onClick={() => onPick(unit.sn)}>
                {label}
              </button>
            ) : (
              <span key={unit.sn} className={`branch-unit ${taken ? 'taken' : ''}`} title={title}>
                {label}
              </span>
            );
          })}
          {!all && units.units.length > SHOW_FIRST && (
            <button type="button" className="branch-units-more" onClick={() => setAll(true)}>
              ดูทั้งหมด {units.units.length} เครื่อง
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * D183: a button that asks the FileMaker the bill went to (`target`) what the branch has of one model, then shows the list (or why
 * it cannot). The parent keys it by order, so an answer never shows on another order's summary.
 * D184: the page is locked while FileMaker answers (up to ~6 s after a quiet spell), so the button is not pressed again.
 * D185: on the stock screen it is the "can't find it" way out under the scan box (`label`, `onPick`, `used`).
 */
export function BranchUnitsLookup({
  part,
  branchCode,
  target,
  sessionId,
  label,
  onPick,
  used,
}: {
  part: string;
  branchCode?: string | null;
  target?: 'PRODUCTION' | 'UAT' | 'NONE' | null;
  sessionId?: string | null;
  label?: string;
  onPick?: (sn: string) => void;
  used?: string[];
}) {
  const [answer, setAnswer] = useState<BranchUnitsAnswer | null>(null);
  const [busy, setBusy] = useState(false);
  const ask = () => {
    if (busy) return;
    setBusy(true);
    branchUnitsApi(part, { branch: branchCode, target: target === 'UAT' || target === 'PRODUCTION' ? target : null, session: sessionId })
      .then(setAnswer)
      .catch((err: unknown) => setAnswer({ status: 'unavailable', reason: err instanceof Error ? err.message : 'ถาม U•POS ไม่ได้ตอนนี้' }))
      .finally(() => setBusy(false));
  };
  const waiting = <BusyOverlay show={busy} text="กำลังดึงรายการ IMEI/SN จาก U•POS" />;
  if (answer?.status === 'ok')
    return (
      <>
        <BranchUnitsList
          model={answer.model}
          units={answer}
          target={answer.target}
          asOf={answer.asOf}
          onRefresh={busy ? undefined : ask}
          onPick={onPick}
          used={used}
        />
        {waiting}
      </>
    );
  return (
    <span className="branch-units-lookup">
      <button type="button" className="branch-units-more" onClick={ask} disabled={busy}>
        <Search size={12} /> {label ?? `ดู IMEI/SN รุ่น ${part} ที่มีในสาขา`}
      </button>
      {answer && <span className="muted"> {answer.reason}</span>}
      {waiting}
    </span>
  );
}

/**
 * D183: the serials FileMaker left off this order's held bill and why, each with a lookup of what the branch does have of that
 * model, so the shop can swap the box without opening FileMaker. D185: in the shop's words, inside the U•POS box.
 */
export function SnMissingList({
  fmp,
  branchCode,
  sessionId,
}: {
  fmp: FmpStatus | null | undefined;
  branchCode?: string | null;
  sessionId?: string | null;
}) {
  const missing = fmp?.snMissing ?? [];
  if (!missing.length) return null;
  const parts = [...new Set(missing.map((one) => one.partNo).filter((part): part is string => Boolean(part)))];
  return (
    <div className="sn-missing">
      <div>เครื่องที่ยังไม่อยู่ในบิล:</div>
      <ul>
        {missing.map((one) => (
          <li key={one.sn}>
            <strong>{one.sn}</strong>
            {one.partNo ? ` (รุ่น ${one.partNo})` : ''}: {SN_REASON[one.code ?? ''] ?? SN_CODE[one.code ?? ''] ?? one.code ?? 'ไม่ทราบสาเหตุ'}
            {one.code === 'SN_WRONG_BRANCH' && one.branch ? ` (อยู่ ${one.branch})` : ''}
            {one.code === 'SN_MODEL_MISMATCH' && one.model ? ` (เป็นรุ่น ${one.model})` : ''}
          </li>
        ))}
      </ul>
      {parts.map((part) => (
        <BranchUnitsLookup key={`${sessionId ?? ''}:${fmp?.target ?? ''}:${part}`} part={part} branchCode={branchCode} target={fmp?.target} sessionId={sessionId} />
      ))}
    </div>
  );
}
