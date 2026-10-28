import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, FlaskConical, Play, RefreshCw } from 'lucide-react';
import { Button, Modal, Notice, Panel } from '../../components/ui';
import { useToast } from '../../components/Toast';
import { api, ApiError } from '../../services/api';

/**
 * ADMIN view of the daily ERP import (D53 branches, D54 staff): schedule, manual runs and the
 * last runs. API: GET /admin/erp-sync/status and POST /admin/erp-sync/run?dryRun=true|false.
 */
interface ErpBranchSummary {
  scope: number;
  created: number;
  updated: number;
  adopted: number;
  deactivated: number;
  unchanged: number;
  notes: { code: string; reason: string }[];
}
interface ErpStaffSummary {
  eligible: number;
  created: number;
  updated: number;
  passwordChanged: number;
  reactivated: number;
  deactivated: number;
  unchanged: number;
  /** how many eligible people have a usable mobile number in the ERP tel (D85); absent in runs before it */
  phones?: { withPhone: number; without: number };
  skipped: { staffId: string; reason: string }[];
  /** people the import kept but cannot reach by OTP (no usable tel) */
  warnings?: { staffId: string; reason: string }[];
}
interface ErpSyncRun {
  id: string;
  kind: string;
  slot: string;
  trigger: string;
  dryRun: boolean;
  attempts: number;
  startedAt: string;
  finishedAt: string | null;
  /** null while the run is still going */
  ok: boolean | null;
  error: string | null;
  actorStaffId: string | null;
  /** null for a run that has not finished or failed before producing one */
  summary: { branches: ErpBranchSummary; staff: ErpStaffSummary } | null;
}
interface ErpSyncStatus {
  configured: boolean;
  schedule: string[];
  timezone: string;
  nextRunAt: string | null;
  running: boolean;
  lastRuns: ErpSyncRun[];
}

/** How often to refresh the status while a run is in progress (e.g. the 10:00 schedule). */
const POLL_MS = 5000;
/** Rows rendered per notes/skipped list; a bad run can report every ERP row. */
const LIST_LIMIT = 100;
const TRIGGER_LABEL: Record<string, string> = {
  schedule: 'ตามเวลา',
  manual: 'สั่งเอง',
};

/** th-TH date and time in the sync timezone; the raw value when it cannot be parsed. */
function formatTime(
  iso: string | null,
  timeZone: string,
  withSeconds = false,
): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  try {
    return date.toLocaleString('th-TH', {
      timeZone,
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      ...(withSeconds ? { second: '2-digit' } : {}),
    });
  } catch {
    return iso; // unknown timezone id
  }
}

const countText = (c: {
  created: number;
  updated: number;
  deactivated: number;
}) => `สร้าง ${c.created} · อัปเดต ${c.updated} · ปิด ${c.deactivated}`;

const describeRun = (run: ErpSyncRun) =>
  run.summary
    ? `พนักงาน ${countText(run.summary.staff)} · สาขา ${countText(run.summary.branches)}`
    : '';

function Counters({
  title,
  items,
}: {
  title: string;
  items: [label: string, value: number][];
}) {
  return (
    <p className="erp-sync-counters">
      <strong>{title}</strong>
      {items.map(([label, value]) => (
        <span key={label}>
          {label} <strong>{value}</strong>
        </span>
      ))}
    </p>
  );
}

/** Collapsible table of what the import reported (branch notes, skipped staff), capped at LIST_LIMIT rows. */
function IssueList({
  title,
  idHeader,
  rows,
}: {
  title: string;
  idHeader: string;
  rows: { id: string; reason: string }[];
}) {
  if (rows.length === 0) return <p className="fine">{title}: ไม่มี</p>;
  const shown = rows.slice(0, LIST_LIMIT);
  return (
    <details className="erp-sync-detail">
      <summary>
        {title} ({rows.length})
      </summary>
      <div className="table-responsive erp-sync-scroll">
        <table className="admin-table">
          <thead>
            <tr>
              <th>{idHeader}</th>
              <th>เหตุผล</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((row, index) => (
              <tr key={`${row.id}:${index}`}>
                <td>
                  <strong>{row.id}</strong>
                </td>
                <td className="erp-sync-reason">{row.reason}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length > shown.length && (
        <p className="fine">
          +{rows.length - shown.length} รายการที่ไม่ได้แสดง (แสดง {LIST_LIMIT}{' '}
          รายการแรก)
        </p>
      )}
    </details>
  );
}

function RunDetail({ run }: { run: ErpSyncRun }) {
  const { summary } = run;
  return (
    <>
      {run.error && <Notice error>{run.error}</Notice>}
      {summary ? (
        <>
          <Counters
            title="สาขา"
            items={[
              ['ในขอบเขต', summary.branches.scope],
              ['สร้างใหม่', summary.branches.created],
              ['อัปเดต', summary.branches.updated],
              ['ผูกกับ ERP', summary.branches.adopted],
              ['ปิดใช้งาน', summary.branches.deactivated],
              ['ไม่เปลี่ยน', summary.branches.unchanged],
            ]}
          />
          <Counters
            title="พนักงาน"
            items={[
              ['เข้าเกณฑ์', summary.staff.eligible],
              ['สร้างใหม่', summary.staff.created],
              ['อัปเดต', summary.staff.updated],
              ['เปลี่ยนรหัสผ่าน', summary.staff.passwordChanged],
              ['เปิดใช้อีกครั้ง', summary.staff.reactivated],
              ['ปิดใช้งาน', summary.staff.deactivated],
              ['ไม่เปลี่ยน', summary.staff.unchanged],
              ...(summary.staff.phones
                ? ([
                    ['มีเบอร์ (OTP)', summary.staff.phones.withPhone],
                    ['ไม่มีเบอร์', summary.staff.phones.without],
                  ] as [string, number][])
                : []),
            ]}
          />
          <IssueList
            title="หมายเหตุสาขา"
            idHeader="รหัสสาขา"
            rows={(summary.branches.notes ?? []).map((n) => ({
              id: n.code,
              reason: n.reason,
            }))}
          />
          <IssueList
            title="คำเตือนพนักงาน (เช่น ไม่มีเบอร์ใน ERP จึงเข้าด้วย OTP ไม่ได้)"
            idHeader="Staff ID"
            rows={(summary.staff.warnings ?? []).map((s) => ({
              id: s.staffId,
              reason: s.reason,
            }))}
          />
          <IssueList
            title="พนักงานที่ถูกข้าม"
            idHeader="Staff ID"
            rows={(summary.staff.skipped ?? []).map((s) => ({
              id: s.staffId,
              reason: s.reason,
            }))}
          />
        </>
      ) : (
        <p className="fine">
          ยังไม่มีสรุปผลของรอบนี้ (กำลังรัน หรือหยุดก่อนสรุปผล)
        </p>
      )}
    </>
  );
}

export function ErpSyncPanel() {
  const toast = useToast();
  const [status, setStatus] = useState<ErpSyncStatus | null>(null);
  const [loadError, setLoadError] = useState('');
  // A request to start a run is in flight (the API answers when the run ends).
  const [busy, setBusy] = useState(false);
  const [confirmLive, setConfirmLive] = useState(false);
  const [manualRun, setManualRun] = useState<ErpSyncRun | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Bumping the counter reloads the status; only the latest request may write state.
  const [refreshCount, setRefreshCount] = useState(0);
  const reload = useCallback(() => setRefreshCount((n) => n + 1), []);
  useEffect(() => {
    let active = true;
    api<ErpSyncStatus>('/admin/erp-sync/status')
      .then((next) => {
        if (!active) return;
        setStatus(next);
        setLoadError('');
      })
      .catch((err: unknown) => {
        if (active)
          setLoadError(
            err instanceof Error ? err.message : 'โหลดสถานะการซิงก์ไม่สำเร็จ',
          );
      });
    return () => {
      active = false;
    };
  }, [refreshCount]);

  // A run can be started elsewhere (the schedule, another admin): follow it until it ends.
  const running = status?.running ?? false;
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(reload, POLL_MS);
    return () => clearInterval(timer);
  }, [running, reload]);

  const startRun = async (dryRun: boolean) => {
    setBusy(true);
    try {
      const run = await api<ErpSyncRun>(
        `/admin/erp-sync/run?dryRun=${dryRun}`,
        'POST',
      );
      setManualRun(run);
      setSelectedId(run.id);
      if (run.ok === false) {
        toast.error(run.error ?? 'การซิงก์ไม่สำเร็จ', 6000);
      } else if (run.ok) {
        const title = dryRun
          ? 'ทดลองรันเสร็จ (ยังไม่เขียนข้อมูล)'
          : 'ซิงก์เสร็จเรียบร้อย';
        toast.success(`${title} · ${describeRun(run)}`, 6000);
      } else {
        toast.info('เริ่มซิงก์แล้ว กำลังรอผล');
      }
    } catch (err) {
      // 0/502/504: the connection or proxy gave up, but the run may still be going on the server.
      const lostConnection =
        err instanceof ApiError && [0, 502, 504].includes(err.status);
      toast.error(
        lostConnection
          ? 'การเชื่อมต่อหมดเวลา ระบบอาจยังซิงก์อยู่ รอสักครู่แล้วดูผลในตารางประวัติ'
          : err instanceof Error
            ? err.message
            : 'สั่งซิงก์ไม่สำเร็จ',
        6000,
      );
    } finally {
      reload();
      setBusy(false);
    }
  };

  // The answer to a click can be missing from lastRuns (if the server does not keep dry runs): keep showing it
  // until the list holds a newer run.
  const runs = useMemo(() => {
    const recent = status?.lastRuns ?? [];
    const manualIsExtra =
      manualRun !== null &&
      !recent.some((r) => r.id === manualRun.id) &&
      (recent.length === 0 ||
        Date.parse(manualRun.startedAt) > Date.parse(recent[0].startedAt));
    return manualIsExtra ? [manualRun, ...recent] : recent;
  }, [status, manualRun]);
  const selected = runs.find((r) => r.id === selectedId) ?? runs[0] ?? null;

  const timeZone = status?.timezone ?? 'Asia/Bangkok';
  const canRun = Boolean(status?.configured) && !status?.running && !busy;

  return (
    <>
      <Panel title="สถานะการซิงก์">
        {loadError && (
          <Notice error>
            {loadError}
            <Button variant="secondary" onClick={reload}>
              ลองโหลดใหม่
            </Button>
          </Notice>
        )}
        {!status && !loadError && <Notice>กำลังโหลด…</Notice>}
        {status && (
          <>
            <dl className="erp-sync-facts">
              <div>
                <dt>การเชื่อมต่อ ERP</dt>
                <dd>
                  {status.configured ? 'ตั้งค่าแล้ว' : 'ยังไม่ได้ตั้งค่า'}
                </dd>
              </div>
              <div>
                <dt>รอบอัตโนมัติ</dt>
                <dd>
                  {status.schedule.length
                    ? `ทุกวัน ${status.schedule.join(', ')} (${status.timezone === 'Asia/Bangkok' ? 'เวลาไทย' : status.timezone})`
                    : 'ไม่มี'}
                </dd>
              </div>
              <div>
                <dt>รอบถัดไป</dt>
                <dd>{formatTime(status.nextRunAt, timeZone)}</dd>
              </div>
              <div>
                <dt>สถานะ</dt>
                <dd>
                  {status.running ? (
                    <>
                      <span className="spinner" />
                      กำลังซิงก์
                    </>
                  ) : (
                    'ว่าง'
                  )}
                </dd>
              </div>
            </dl>
            {!status.configured && (
              <Notice error>
                ยังไม่ได้ตั้งค่าการเชื่อมต่อ ERP บนเซิร์ฟเวอร์
                จึงสั่งซิงก์ไม่ได้
              </Notice>
            )}
            {status.running && (
              <Notice>กำลังซิงก์อยู่ ระบบจะรีเฟรชสถานะให้อัตโนมัติ</Notice>
            )}
            <div className="actions">
              <Button
                variant="secondary"
                disabled={!canRun}
                onClick={() => void startRun(true)}
              >
                <FlaskConical size={15} />
                ทดลองรัน (ไม่เขียนข้อมูล)
              </Button>
              <Button disabled={!canRun} onClick={() => setConfirmLive(true)}>
                <Play size={15} />
                ซิงก์ตอนนี้
              </Button>
              <Button variant="secondary" disabled={busy} onClick={reload}>
                <RefreshCw size={15} />
                รีเฟรช
              </Button>
            </div>
            {busy && (
              <p className="fine" role="status">
                <span className="spinner" />
                กำลังติดต่อ ERP อาจใช้เวลาสักครู่ กรุณาอย่าปิดหน้านี้
              </p>
            )}
          </>
        )}
      </Panel>

      <Panel title="ประวัติการซิงก์ล่าสุด">
        {runs.length === 0 ? (
          <p>ยังไม่เคยซิงก์</p>
        ) : (
          <div className="table-responsive">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>เริ่มเมื่อ</th>
                  <th>รอบ</th>
                  <th>โหมด</th>
                  <th>ผล</th>
                  <th>ครั้งที่ลอง</th>
                  <th>พนักงาน</th>
                  <th>สาขา</th>
                  <th aria-label="รายละเอียด" />
                </tr>
              </thead>
              <tbody>
                {runs.map((run) => (
                  <tr
                    key={run.id}
                    className={
                      run.id === selected?.id ? 'erp-run-selected' : undefined
                    }
                  >
                    <td>{formatTime(run.startedAt, timeZone, true)}</td>
                    <td>
                      {TRIGGER_LABEL[run.trigger] ?? run.trigger}
                      {run.actorStaffId ? ` · ${run.actorStaffId}` : ''}
                    </td>
                    <td>
                      {run.dryRun ? (
                        <span className="status-tag status-cashier_received">
                          ทดลอง
                        </span>
                      ) : (
                        'จริง'
                      )}
                    </td>
                    <td>
                      {run.ok === null ? (
                        <span className="status-tag status-searching">
                          <span className="spinner" />
                          กำลังรัน
                        </span>
                      ) : (
                        <span
                          className={`status-tag ${run.ok ? 'status-found' : 'status-outcome'}`}
                        >
                          {run.ok ? 'สำเร็จ' : 'ล้มเหลว'}
                        </span>
                      )}
                    </td>
                    <td>{run.attempts}</td>
                    <td>{run.summary ? countText(run.summary.staff) : '—'}</td>
                    <td>
                      {run.summary ? countText(run.summary.branches) : '—'}
                    </td>
                    <td>
                      <button
                        type="button"
                        className="text-button"
                        onClick={() => setSelectedId(run.id)}
                      >
                        ดูรายละเอียด
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {selected && (
        <Panel
          title={`รายละเอียดรอบ ${formatTime(selected.startedAt, timeZone, true)}${selected.dryRun ? ' (ทดลองรัน)' : ''}`}
        >
          <RunDetail key={selected.id} run={selected} />
        </Panel>
      )}

      {confirmLive && (
        <Modal
          title="ยืนยันการซิงก์ ERP ตอนนี้"
          onClose={() => setConfirmLive(false)}
          maxWidth="480px"
        >
          <div
            style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}
          >
            <AlertTriangle
              size={26}
              color="#d97706"
              style={{ flexShrink: 0, marginTop: '2px' }}
            />
            <div>
              <p style={{ marginTop: 0 }}>
                ระบบจะอ่านสาขาและพนักงานจาก ERP แล้วเขียนลง SES ทันที (สร้าง
                อัปเดต หรือปิดใช้งานสาขาและบัญชีที่มาจาก ERP ให้ตรงกับ ERP)
              </p>
              <p className="fine">
                บัญชีที่สร้างเองใน SES ไม่ถูกแตะต้อง แนะนำให้ทดลองรันดูผลก่อน
              </p>
            </div>
          </div>
          <div className="actions" style={{ justifyContent: 'flex-end' }}>
            <Button variant="secondary" onClick={() => setConfirmLive(false)}>
              ยกเลิก
            </Button>
            <Button
              onClick={() => {
                setConfirmLive(false);
                void startRun(false);
              }}
            >
              ยืนยันซิงก์ตอนนี้
            </Button>
          </div>
        </Modal>
      )}
    </>
  );
}
