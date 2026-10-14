import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, FlaskConical, Play, RefreshCw } from 'lucide-react';
import { Button, Modal, Notice, Panel } from '../../components/ui';
import { useToast } from '../../components/Toast';
import { api } from '../../services/api';

/**
 * ADMIN view of the products and stock SES reads from the warroom database: mode, age of the
 * snapshot, manual runs (dry run first), the last runs and, per run, what happened to the catalog
 * and which warroom categories have no SES category yet.
 * API: GET /admin/warroom-sync/status and POST /admin/warroom-sync/run?dryRun=true|false&force=true|false.
 */
interface WarroomCatalogSummary {
  existing: number;
  created: number;
  /** New items that exist in the snapshot but were not created because the mode is not `on` */
  wouldCreate: number;
  updated: number;
  /** D78: ERP-made SKUs re-filed under another product / model / category (absent in older runs) */
  moved?: number;
  /** parts warroom gave no category text for */
  skippedNoCategory: number;
  /** D72: parts of a category ADMIN has not switched on yet; they are created once the category is opened (absent in older runs) */
  waitingForCategory?: number;
  /** categories this run added to the SES list, switched off (absent in older runs) */
  newCategories?: number;
  /** `mapped` is the SES category; `status`: active = products are created, off = switched off, new = will be added switched off */
  categories: {
    value: string;
    mapped: string | null;
    parts: number;
    status?: 'active' | 'off' | 'new';
  }[];
  unmapped: { value: string; parts: number }[];
}
interface CatalogResetCounts {
  sessions: number;
  customers: number;
  products: number;
  models: number;
  skus: number;
  inventoryRows: number;
}
/** The word the API wants typed before it clears the old catalog and queue history (D72). */
const RESET_CONFIRM = 'ล้างข้อมูล';
const CATEGORY_STATUS: Record<string, string> = {
  active: 'เปิดอยู่',
  off: 'ปิดอยู่ (สินค้ายังไม่เข้า)',
  new: 'ใหม่ (เพิ่มแบบปิดไว้)',
};
interface WarroomStockSummary {
  updatedRows: number;
  zeroedRows: number;
  readyUnits: number;
  transferUnits: number;
}
interface WarroomRunSummary {
  /** Server mode at the time of the run: off | shadow | on */
  mode: string;
  asOf: string | null;
  rows: number;
  parts: number;
  branches: {
    matched: number;
    unknown: { code: string; rows: number }[];
  };
  catalog: WarroomCatalogSummary;
  stock: WarroomStockSummary;
}
interface WarroomRun {
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
  /** null while running or for a run that failed before producing one */
  summary: WarroomRunSummary | null;
}
interface WarroomStatus {
  configured: boolean;
  /** off | shadow | on */
  mode: string;
  intervalMinutes: number;
  running: boolean;
  /** Time of the newest warroom snapshot SES has seen */
  lastSnapshotAt: string | null;
  /** SKUs that have ERP numbers right now */
  coveredSkus: number;
  lastRuns: WarroomRun[];
}

/** How often to refresh the status while a run is in progress. */
const POLL_MS = 5000;
/** How often the "ผ่านมา …" age of the snapshot is recomputed. */
const CLOCK_MS = 30000;
/** Rows rendered per list; a bad snapshot can report every unknown branch or category. */
const LIST_LIMIT = 100;
const TIME_ZONE = 'Asia/Bangkok';
const TRIGGER_LABEL: Record<string, string> = {
  schedule: 'อัตโนมัติ',
  manual: 'สั่งเอง',
};
const MODES: Record<string, { label: string; short: string; hint: string }> = {
  off: {
    label: 'ปิด',
    short: 'ปิด',
    hint: 'SES ยังไม่ใช้ข้อมูลสินค้าและสต็อกจาก warroom',
  },
  shadow: {
    label: 'เฝ้าดู (ยังไม่ใช้เลขจาก ERP)',
    short: 'เฝ้าดู',
    hint: 'ระบบเก็บเลขจาก warroom ไว้ให้ผู้ดูแลดูเท่านั้น พนักงานยังเห็นสต็อกที่กรอกเอง และยังไม่สร้างหรือแก้สินค้าในแค็ตตาล็อก',
  },
  on: {
    label: 'ใช้งาน',
    short: 'ใช้งาน',
    hint: 'พนักงานเห็นสต็อกจาก warroom (หักจำนวนที่ SES จองไว้แล้ว) และระบบสร้างหรืออัปเดตสินค้า รุ่น และ SKU ที่มาจาก ERP ให้อัตโนมัติ เฉพาะหมวดที่เปิดอยู่ (หมวดใหม่จาก warroom จะปิดไว้ก่อน เปิดได้ที่เมนูหมวดหมู่สินค้า)',
  },
};
/** Labels of a mode the UI does not know yet fall back to the raw value. */
const modeOf = (mode: string) =>
  MODES[mode] ?? { label: mode, short: mode, hint: '' };

/** th-TH date and time in Bangkok time; the raw value when it cannot be parsed. */
function formatTime(iso: string | null, withSeconds = false): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString('th-TH', {
    timeZone: TIME_ZONE,
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    ...(withSeconds ? { second: '2-digit' } : {}),
  });
}

/** How old a snapshot is, in the largest whole unit ("ผ่านมา 4 ชม."). */
function formatAge(iso: string, now: number): string {
  const elapsed = now - Date.parse(iso);
  if (Number.isNaN(elapsed)) return '';
  const minutes = Math.max(0, Math.floor(elapsed / 60000));
  if (minutes < 1) return 'เมื่อสักครู่';
  if (minutes < 60) return `ผ่านมา ${minutes} นาที`;
  if (minutes < 24 * 60) return `ผ่านมา ${Math.floor(minutes / 60)} ชม.`;
  return `ผ่านมา ${Math.floor(minutes / (24 * 60))} วัน`;
}

const catalogText = (c: WarroomCatalogSummary) =>
  `สร้าง ${c.created} · อัปเดต ${c.updated}${c.moved ? ` · ย้าย ${c.moved}` : ''}${c.wouldCreate ? ` · รอสร้าง ${c.wouldCreate}` : ''}${c.waitingForCategory ? ` · รอเปิดหมวด ${c.waitingForCategory}` : ''}`;

const stockText = (s: WarroomStockSummary) =>
  `อัปเดต ${s.updatedRows} · ปรับเป็นศูนย์ ${s.zeroedRows}`;

const describeRun = (run: WarroomRun) => {
  const { summary } = run;
  if (!summary) return '';
  const unmapped = (summary.catalog.unmapped ?? []).length;
  return `สินค้า ${catalogText(summary.catalog)} · สต็อก ${stockText(summary.stock)}${unmapped ? ` · หมวดที่ยังไม่ได้แมป ${unmapped}` : ''}`;
};

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
          {label} <strong>{value.toLocaleString('th-TH')}</strong>
        </span>
      ))}
    </p>
  );
}

/** Collapsible table of one list of a run (unknown branches, category mapping), capped at LIST_LIMIT rows. */
function ListTable({
  title,
  headers,
  rows,
  open = false,
}: {
  title: string;
  headers: string[];
  rows: (string | number)[][];
  open?: boolean;
}) {
  if (rows.length === 0) return <p className="fine">{title}: ไม่มี</p>;
  const shown = rows.slice(0, LIST_LIMIT);
  return (
    <details className="erp-sync-detail" open={open}>
      <summary>
        {title} ({rows.length})
      </summary>
      <div className="table-responsive erp-sync-scroll">
        <table className="admin-table">
          <thead>
            <tr>
              {headers.map((header) => (
                <th key={header}>{header}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((row, index) => (
              <tr key={`${row[0]}:${index}`}>
                {row.map((cell, column) => (
                  <td key={column}>
                    {typeof cell === 'number'
                      ? cell.toLocaleString('th-TH')
                      : cell}
                  </td>
                ))}
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

function RunDetail({ run }: { run: WarroomRun }) {
  const { summary } = run;
  if (!summary) {
    return (
      <>
        {run.error && <Notice error>{run.error}</Notice>}
        <p className="fine">
          ยังไม่มีสรุปผลของรอบนี้ (กำลังรัน หรือหยุดก่อนสรุปผล)
        </p>
      </>
    );
  }
  const { catalog, stock, branches } = summary;
  const unmapped = catalog.unmapped ?? [];
  const waitingCategories = (catalog.categories ?? []).filter(
    (c) => c.status === 'off' || c.status === 'new',
  );
  const unknownBranches = branches.unknown ?? [];
  return (
    <>
      {run.error && <Notice error>{run.error}</Notice>}
      {run.dryRun && (
        <Notice>
          ทดลองรัน: ตัวเลขการสร้าง อัปเดต และสต็อกคือสิ่งที่จะเกิดขึ้นถ้ารันจริง
          ยังไม่มีการเขียนข้อมูล
        </Notice>
      )}
      <p className="fine">
        โหมดตอนรัน: {modeOf(summary.mode).label} · ข้อมูล ณ{' '}
        {formatTime(summary.asOf)}
      </p>

      {waitingCategories.length > 0 && (
        <div className="warroom-unmapped">
          <strong>
            หมวดจาก warroom ที่ยังปิดอยู่ใน SES ({waitingCategories.length})
          </strong>
          <p className="fine">
            สินค้าของหมวดเหล่านี้ (
            {(catalog.waitingForCategory ?? 0).toLocaleString('th-TH')} รายการ)
            ยังไม่ถูกสร้าง และพนักงานยังไม่เห็น เปิดหมวดที่ต้องการที่เมนู
            หมวดหมู่สินค้า แล้วกด “ซิงก์ตอนนี้” สินค้าของหมวดนั้นจะเข้ามา
          </p>
          <ul className="warroom-chips">
            {waitingCategories.slice(0, LIST_LIMIT).map((item, index) => (
              <li className="warroom-chip" key={`${item.value}:${index}`}>
                {item.value}{' '}
                <strong>{item.parts.toLocaleString('th-TH')}</strong>
              </li>
            ))}
          </ul>
        </div>
      )}
      {unmapped.length > 0 && (
        <div className="warroom-unmapped">
          <strong>
            สินค้าที่ warroom ไม่ระบุหมวด ({unmapped.length})
          </strong>
          <p className="fine">
            ข้ามไป {catalog.skippedNoCategory.toLocaleString('th-TH')} รายการ
          </p>
        </div>
      )}
      {waitingCategories.length === 0 && unmapped.length === 0 && (
        <p className="fine">หมวดสินค้าจาก warroom เข้าหมวดใน SES ครบทุกหมวดที่เปิดอยู่</p>
      )}

      <Counters
        title="ข้อมูลจาก warroom"
        items={[
          ['แถวสต็อก (สาขา × สินค้า)', summary.rows],
          ['สินค้า (part)', summary.parts],
        ]}
      />
      <Counters
        title="แค็ตตาล็อก"
        items={[
          ['มีใน SES แล้ว', catalog.existing],
          [run.dryRun ? 'จะสร้างใหม่' : 'สร้างใหม่', catalog.created],
          ['รอสร้างเมื่อเปิดโหมดใช้งาน', catalog.wouldCreate],
          [run.dryRun ? 'จะอัปเดต' : 'อัปเดต', catalog.updated],
          [run.dryRun ? 'จะย้ายหมวด/รุ่น' : 'ย้ายหมวด/รุ่น', catalog.moved ?? 0],
          ['รอเปิดหมวด', catalog.waitingForCategory ?? 0],
          ['ข้าม (warroom ไม่ระบุหมวด)', catalog.skippedNoCategory],
        ]}
      />
      <Counters
        title="สต็อก"
        items={[
          [run.dryRun ? 'จะอัปเดต (แถว)' : 'อัปเดต (แถว)', stock.updatedRows],
          ['ปรับเป็นศูนย์ (แถว)', stock.zeroedRows],
          ['พร้อมขายรวม (ชิ้น)', stock.readyUnits],
          ['กำลังโอนรวม (ชิ้น)', stock.transferUnits],
        ]}
      />
      <Counters
        title="สาขา"
        items={[
          ['จับคู่กับ SES ได้', branches.matched],
          ['ไม่รู้จัก', unknownBranches.length],
        ]}
      />
      <ListTable
        open
        title="การแมปหมวดสินค้า"
        headers={['หมวดจาก warroom', 'หมวดใน SES', 'สถานะหมวด', 'จำนวนสินค้า']}
        rows={(catalog.categories ?? []).map((c) => [
          c.value,
          c.mapped ?? '— ไม่ระบุหมวด',
          c.status ? (CATEGORY_STATUS[c.status] ?? c.status) : '—',
          c.parts,
        ])}
      />
      <ListTable
        title="สาขาที่ไม่รู้จัก"
        headers={['รหัสสาขาจาก warroom', 'จำนวนแถว']}
        rows={unknownBranches.map((b) => [b.code, b.rows])}
      />
    </>
  );
}

export function WarroomSyncPanel() {
  const toast = useToast();
  const [status, setStatus] = useState<WarroomStatus | null>(null);
  const [loadError, setLoadError] = useState('');
  // The request that starts a run is in flight (the API answers at once, the run goes on in the server).
  const [busy, setBusy] = useState(false);
  const [confirmLive, setConfirmLive] = useState(false);
  const [force, setForce] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // The run this admin started: its outcome is announced once the polled status shows it finished.
  const startedRunId = useRef<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  // D72: "clear the old catalog and queue history": counted first, then done on a typed confirmation
  const [resetCounts, setResetCounts] = useState<CatalogResetCounts | null>(null);
  // `all` = everything (D73); `non-erp` = only what the ERP did not create, with the queues that used it (D78)
  const [resetScope, setResetScope] = useState<'all' | 'non-erp'>('all');
  const [resetTyped, setResetTyped] = useState('');
  const [resetBusy, setResetBusy] = useState(false);

  // Bumping the counter reloads the status; only the latest request may write state.
  const [refreshCount, setRefreshCount] = useState(0);
  const reload = useCallback(() => setRefreshCount((n) => n + 1), []);
  useEffect(() => {
    let active = true;
    api<WarroomStatus>('/admin/warroom-sync/status')
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

  // A run can be started elsewhere (the server's own check, another admin): follow it until it ends.
  const running = status?.running ?? false;
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(reload, POLL_MS);
    return () => clearInterval(timer);
  }, [running, reload]);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), CLOCK_MS);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const run = status?.lastRuns.find((r) => r.id === startedRunId.current);
    if (!run || run.ok === null) return;
    startedRunId.current = null;
    if (run.ok) {
      const title = run.dryRun
        ? 'ทดลองรันเสร็จ (ยังไม่เขียนข้อมูล)'
        : 'ซิงก์เสร็จเรียบร้อย';
      toast.success(`${title} · ${describeRun(run)}`, 6000);
    } else {
      toast.error(run.error ?? 'การซิงก์ไม่สำเร็จ', 6000);
    }
  }, [status, toast]);

  // `forceGuard` lifts the server's check against a snapshot with far fewer SKUs than before.
  const startRun = async (dryRun: boolean, forceGuard = false) => {
    setBusy(true);
    try {
      const run = await api<WarroomRun>(
        `/admin/warroom-sync/run?dryRun=${dryRun}&force=${forceGuard}`,
        'POST',
      );
      startedRunId.current = run.id;
      setSelectedId(run.id);
      toast.info(
        dryRun ? 'เริ่มทดลองรันแล้ว กำลังรอผล' : 'เริ่มซิงก์แล้ว กำลังรอผล',
      );
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'สั่งซิงก์ไม่สำเร็จ',
        6000,
      );
    } finally {
      reload();
      setBusy(false);
    }
  };

  const countReset = async (scope: 'all' | 'non-erp') => {
    setResetBusy(true);
    try {
      const res = await api<{ counts: CatalogResetCounts }>(
        `/admin/warroom-sync/reset-catalog?dryRun=true&scope=${scope}`,
        'POST',
      );
      setResetTyped('');
      setResetScope(scope);
      setResetCounts(res.counts);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'นับข้อมูลไม่สำเร็จ', 6000);
    } finally {
      setResetBusy(false);
    }
  };
  const doReset = async () => {
    setResetBusy(true);
    try {
      await api(`/admin/warroom-sync/reset-catalog?scope=${resetScope}`, 'POST', {
        confirm: resetTyped.trim(),
      });
      setResetCounts(null);
      setResetTyped('');
      toast.success(
        resetScope === 'non-erp'
          ? 'ลบสินค้าที่ไม่ได้มาจาก ERP เรียบร้อย'
          : 'ล้างสินค้าและประวัติคิวเดิมเรียบร้อย',
        6000,
      );
      reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'ล้างข้อมูลไม่สำเร็จ', 6000);
    } finally {
      setResetBusy(false);
    }
  };

  const runs = status?.lastRuns ?? [];
  const selected = runs.find((r) => r.id === selectedId) ?? runs[0] ?? null;

  // The server refuses runs while the mode is `off`, so do not offer them.
  const canRun =
    Boolean(status?.configured) &&
    status?.mode !== 'off' &&
    !status?.running &&
    !busy;
  const mode = modeOf(status?.mode ?? '');

  return (
    <>
      <h2 className="warroom-sync-heading">สินค้าและสต็อกจาก warroom</h2>
      <p className="muted">
        SES อ่านสินค้าและจำนวนสต็อกจากฐานข้อมูล warroom (อ่านอย่างเดียว)
        ซึ่งรับข้อมูลมาจาก ERP เป็นรอบ ๆ ในแต่ละวัน
      </p>

      <Panel title="สถานะการซิงก์สินค้าและสต็อก">
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
                <dt>การเชื่อมต่อ warroom</dt>
                <dd>
                  {status.configured ? 'ตั้งค่าแล้ว' : 'ยังไม่ได้ตั้งค่า'}
                </dd>
              </div>
              <div>
                <dt>โหมด</dt>
                <dd>{mode.label}</dd>
              </div>
              <div>
                <dt>ตรวจข้อมูลชุดใหม่ทุก</dt>
                <dd>{status.intervalMinutes} นาที</dd>
              </div>
              <div>
                <dt>ข้อมูล ณ</dt>
                <dd>
                  {status.lastSnapshotAt
                    ? `${formatTime(status.lastSnapshotAt)} (${formatAge(status.lastSnapshotAt, now)})`
                    : 'ยังไม่มีข้อมูลจาก warroom'}
                </dd>
              </div>
              <div>
                <dt>SKU ที่มีเลขจาก ERP</dt>
                <dd>{status.coveredSkus.toLocaleString('th-TH')}</dd>
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
            {mode.hint && (
              <p className="fine">
                <strong>โหมด{mode.short}:</strong> {mode.hint}
              </p>
            )}
            {!status.configured && (
              <Notice error>
                ยังไม่ได้ตั้งค่าการเชื่อมต่อฐานข้อมูล warroom บนเซิร์ฟเวอร์
                จึงสั่งซิงก์ไม่ได้
              </Notice>
            )}
            {status.configured && status.mode === 'off' && (
              <Notice>
                โหมดปิดอยู่ (ตั้งค่าที่เซิร์ฟเวอร์) จึงสั่งซิงก์ไม่ได้
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
              <Button
                disabled={!canRun}
                onClick={() => {
                  setForce(false);
                  setConfirmLive(true);
                }}
              >
                <Play size={15} />
                ซิงก์ตอนนี้
              </Button>
              <Button variant="secondary" disabled={busy} onClick={reload}>
                <RefreshCw size={15} />
                รีเฟรช
              </Button>
            </div>
          </>
        )}
      </Panel>

      <Panel title="ล้างสินค้าและประวัติคิวเดิม (ครั้งเดียวก่อนใช้ข้อมูลจริง)">
        <p className="muted" style={{ marginTop: 0 }}>
          ลบ <strong>สินค้า รุ่น SKU และสต็อกสาขาทั้งหมด</strong> รวมถึง{' '}
          <strong>คิวทุกคิว (ประวัติ) ลูกค้า และเลขคิว</strong> เพื่อเริ่มใหม่ด้วยสินค้าจริงจาก warroom
          ส่วนพนักงาน สาขา หมวดหมู่ ช่องทางชำระเงิน และการตั้งค่าไม่ถูกลบ
          ลบแล้วย้อนกลับไม่ได้ (ควรสำรองฐานข้อมูลก่อน) ระบบจะนับให้ดูก่อน หรือเลือก
          <strong> ลบเฉพาะสินค้าที่ไม่ได้มาจาก ERP</strong> (สินค้าจาก ERP ลูกค้า และเลขคิวอยู่ครบ
          ลบเฉพาะคิวที่ใช้สินค้าเก่านั้น)
        </p>
        <div className="actions">
          <Button variant="secondary" disabled={resetBusy || status?.running} onClick={() => void countReset('non-erp')}>
            นับสินค้าที่ไม่ได้มาจาก ERP
          </Button>
          <Button variant="secondary" disabled={resetBusy || status?.running} onClick={() => void countReset('all')}>
            นับสิ่งที่จะถูกลบทั้งหมด
          </Button>
        </div>
      </Panel>

      <Panel title="ประวัติการซิงก์สินค้าและสต็อกล่าสุด">
        {runs.length === 0 ? (
          <p>ยังไม่เคยซิงก์</p>
        ) : (
          <div className="table-responsive">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>เริ่มเมื่อ</th>
                  <th>รอบ</th>
                  <th>ประเภท · โหมด</th>
                  <th>ผล</th>
                  <th>ครั้งที่ลอง</th>
                  <th>ข้อมูล ณ</th>
                  <th>แค็ตตาล็อก</th>
                  <th>สต็อก</th>
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
                    <td>{formatTime(run.startedAt, true)}</td>
                    <td>
                      {TRIGGER_LABEL[run.trigger] ?? run.trigger}
                      {run.actorStaffId ? ` · ${run.actorStaffId}` : ''}
                    </td>
                    <td className="erp-sync-nowrap">
                      {run.dryRun ? (
                        <span className="status-tag status-cashier_received">
                          ทดลอง
                        </span>
                      ) : (
                        'จริง'
                      )}
                      {run.summary
                        ? ` · ${modeOf(run.summary.mode).short}`
                        : ''}
                    </td>
                    <td className="erp-sync-nowrap">
                      {run.ok === null ? (
                        <span className="status-tag status-searching">
                          <span className="spinner" />
                          กำลังรัน
                        </span>
                      ) : (
                        <span
                          className={`status-tag ${run.ok ? 'status-found' : 'status-outcome'}`}
                          title={run.error ?? undefined}
                        >
                          {run.ok ? 'สำเร็จ' : 'ล้มเหลว'}
                        </span>
                      )}
                    </td>
                    <td>{run.attempts}</td>
                    <td>{run.summary ? formatTime(run.summary.asOf) : '—'}</td>
                    <td>
                      {run.summary ? catalogText(run.summary.catalog) : '—'}
                    </td>
                    <td>{run.summary ? stockText(run.summary.stock) : '—'}</td>
                    <td className="erp-sync-nowrap">
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
          title={`รายละเอียดรอบ ${formatTime(selected.startedAt, true)}${selected.dryRun ? ' (ทดลองรัน)' : ''}`}
        >
          <RunDetail key={selected.id} run={selected} />
        </Panel>
      )}

      {resetCounts && (
        <Modal
          title={
            resetScope === 'non-erp'
              ? 'ยืนยันการลบสินค้าที่ไม่ได้มาจาก ERP'
              : 'ยืนยันการล้างสินค้าและประวัติคิวเดิม'
          }
          onClose={() => setResetCounts(null)}
          maxWidth="520px"
        >
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
            <AlertTriangle size={26} color="#dc2626" style={{ flexShrink: 0, marginTop: '2px' }} />
            <div>
              <p style={{ marginTop: 0 }}>จะลบข้อมูลต่อไปนี้ถาวร:</p>
              <ul>
                <li>คิว (ประวัติ session): <strong>{resetCounts.sessions.toLocaleString('th-TH')}</strong></li>
                {resetScope === 'all' && (
                  <li>ลูกค้า: <strong>{resetCounts.customers.toLocaleString('th-TH')}</strong></li>
                )}
                <li>สินค้าหลัก: <strong>{resetCounts.products.toLocaleString('th-TH')}</strong> · รุ่น: <strong>{resetCounts.models.toLocaleString('th-TH')}</strong> · SKU: <strong>{resetCounts.skus.toLocaleString('th-TH')}</strong></li>
                <li>แถวสต็อกสาขา: <strong>{resetCounts.inventoryRows.toLocaleString('th-TH')}</strong></li>
              </ul>
              <p className="fine">
                {resetScope === 'non-erp'
                  ? 'สินค้าจาก ERP ลูกค้า และคิวที่ไม่เกี่ยวกับสินค้าเก่าจะไม่ถูกลบ'
                  : 'หลังลบ ให้ตั้งโหมด warroom เป็น “ใช้งาน” แล้วกด “ซิงก์ตอนนี้” เพื่อนำสินค้าจริงเข้า'}
              </p>
            </div>
          </div>
          <label style={{ display: 'block', marginTop: '12px' }}>
            พิมพ์ “{RESET_CONFIRM}” เพื่อยืนยัน
            <input
              value={resetTyped}
              onChange={(e) => setResetTyped(e.target.value)}
              placeholder={RESET_CONFIRM}
              autoComplete="off"
            />
          </label>
          <div className="actions" style={{ justifyContent: 'flex-end' }}>
            <Button variant="secondary" onClick={() => setResetCounts(null)}>
              ยกเลิก
            </Button>
            <Button
              variant="danger"
              disabled={resetBusy || resetTyped.trim() !== RESET_CONFIRM}
              onClick={() => void doReset()}
            >
              ลบถาวร
            </Button>
          </div>
        </Modal>
      )}

      {confirmLive && (
        <Modal
          title="ยืนยันการซิงก์สินค้าและสต็อกตอนนี้"
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
                ระบบจะอ่านสินค้าและสต็อกล่าสุดจาก warroom แล้วเขียนลง SES
                ทันทีตามโหมดปัจจุบัน: <strong>{mode.label}</strong>
              </p>
              {mode.hint && <p className="fine">{mode.hint}</p>}
              <p className="fine">แนะนำให้ทดลองรันดูผลก่อน</p>
            </div>
          </div>
          <label className="warroom-force">
            <input
              type="checkbox"
              checked={force}
              onChange={(e) => setForce(e.target.checked)}
            />
            <span>ข้ามตัวป้องกันข้อมูลหายผิดปกติ (force)</span>
          </label>
          <p className="fine">
            ปกติระบบจะไม่รับข้อมูลชุดใหม่ที่มี SKU
            น้อยลงมากผิดปกติเมื่อเทียบกับครั้งก่อน
            เลือกข้อนี้เฉพาะเมื่อแน่ใจว่าข้อมูลชุดนี้ถูกต้อง
          </p>
          <div className="actions" style={{ justifyContent: 'flex-end' }}>
            <Button variant="secondary" onClick={() => setConfirmLive(false)}>
              ยกเลิก
            </Button>
            <Button
              onClick={() => {
                setConfirmLive(false);
                void startRun(false, force);
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
