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

/**
 * D183: "MJXQ4ZP/A: FileMaker has 13 units ready in this branch", then the units, so STOCK can find the box it should have scanned.
 * A unit another open SES order already holds says which queue (it cannot be used again, D92).
 */
export function BranchUnitsList({
  model,
  units,
  target,
  asOf,
  onRefresh,
}: {
  model: string;
  units: BranchUnits;
  target?: 'PRODUCTION' | 'UAT';
  asOf?: string | null;
  /** shown as "ถามใหม่" when given */
  onRefresh?: () => void;
}) {
  const [all, setAll] = useState(false);
  const where = target === 'UAT' ? 'FileMaker UAT (ทดสอบ)' : 'FileMaker';
  const shown = all ? units.units : units.units.slice(0, SHOW_FIRST);
  return (
    <div className="branch-units">
      <div>
        รุ่น <strong>{model}</strong> ที่สาขานี้ {where} มี ready <strong>{units.count}{units.more ? '+' : ''}</strong> เครื่อง
        {asOf ? <span className="muted"> (ณ {timeText(asOf)})</span> : null}
        {units.count === 0 ? ' · ไม่มีเครื่องรุ่นนี้ ready ที่สาขานี้ ให้เช็ครับโอน/สต็อกใน FileMaker' : ':'}
        {onRefresh && (
          <>
            {' '}
            <button type="button" className="branch-units-more" onClick={onRefresh}>
              ถามใหม่
            </button>
          </>
        )}
      </div>
      {units.units.length > 0 && (
        <div className="branch-units-list">
          {shown.map((unit) => (
            <span
              key={unit.sn}
              className={`branch-unit ${unit.taken ? 'taken' : ''}`}
              title={unit.taken ? `สแกนอยู่ใน${unit.taken}แล้ว (ออเดอร์ที่ยังไม่จบ) ใช้ซ้ำไม่ได้` : 'ready ที่สาขานี้'}
            >
              {unit.sn}
              {unit.taken ? ` · ${unit.taken}` : ''}
            </span>
          ))}
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
 */
export function BranchUnitsLookup({
  part,
  branchCode,
  target,
  sessionId,
}: {
  part: string;
  branchCode?: string | null;
  target?: 'PRODUCTION' | 'UAT' | 'NONE' | null;
  sessionId?: string | null;
}) {
  const [answer, setAnswer] = useState<BranchUnitsAnswer | null>(null);
  const [busy, setBusy] = useState(false);
  const ask = () => {
    if (busy) return;
    setBusy(true);
    branchUnitsApi(part, { branch: branchCode, target: target === 'UAT' || target === 'PRODUCTION' ? target : null, session: sessionId })
      .then(setAnswer)
      .catch((err: unknown) => setAnswer({ status: 'unavailable', reason: err instanceof Error ? err.message : 'ถาม FileMaker ไม่ได้ตอนนี้' }))
      .finally(() => setBusy(false));
  };
  const waiting = <BusyOverlay show={busy} text={`กำลังถาม FileMaker ว่าสาขามีรุ่น ${part} อยู่กี่เครื่อง…`} />;
  if (answer?.status === 'ok')
    return (
      <>
        <BranchUnitsList model={answer.model} units={answer} target={answer.target} asOf={answer.asOf} onRefresh={busy ? undefined : ask} />
        {waiting}
      </>
    );
  return (
    <span className="branch-units-lookup">
      <button type="button" className="branch-units-more" onClick={ask} disabled={busy}>
        <Search size={12} /> {busy ? 'กำลังถาม FileMaker…' : `ดู IMEI/SN รุ่น ${part} ที่มีในสาขา`}
      </button>
      {answer && <span className="muted"> {answer.reason}</span>}
      {waiting}
    </span>
  );
}

/**
 * D183: the serials FileMaker left off this order's held bill and why, each with a lookup of what the branch does have of that
 * model, so the shop can swap the box without opening FileMaker.
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
      {missing.map((one) => (
        <div key={one.sn}>
          <strong>{one.sn}</strong> ไม่ได้ลงบิล: {SN_CODE[one.code ?? ''] ?? one.code ?? 'ไม่ทราบสาเหตุ'}
          {one.code === 'SN_WRONG_BRANCH' && one.branch ? ` (อยู่ ${one.branch})` : ''}
          {one.code === 'SN_MODEL_MISMATCH' && one.model ? ` (เป็นรุ่น ${one.model})` : ''}
          {one.partNo ? <span className="muted"> · รุ่นที่สั่ง {one.partNo}</span> : null}
        </div>
      ))}
      {parts.map((part) => (
        <BranchUnitsLookup key={`${sessionId ?? ''}:${fmp?.target ?? ''}:${part}`} part={part} branchCode={branchCode} target={fmp?.target} sessionId={sessionId} />
      ))}
    </div>
  );
}
