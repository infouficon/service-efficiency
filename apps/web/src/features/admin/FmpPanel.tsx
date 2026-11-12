import { useCallback, useEffect, useState } from 'react';
import { Check, RefreshCw, RotateCcw, Send, X } from 'lucide-react';
import { Button, Notice, Panel } from '../../components/ui';
import { useToast } from '../../components/Toast';
import { api } from '../../services/api';
import { fetchSettingsApi, saveFmpPushModeApi } from '../../services/sessionApi';
import type { FmpPushMode } from '../../types/session';

/** D119: one serial number as the FileMaker `ses` script v3.3 checked it */
export interface SnCheck {
  sn: string;
  partNo: string | null;
  found: boolean;
  written: boolean;
  code: string | null;
  model: string | null;
  upc: string | null;
  status: string | null;
  branch: string | null;
  name: string | null;
  price: number | null;
}
/** Thai words for the script's serial codes */
export const SN_CODE: Record<string, string> = {
  SN_NOT_FOUND: 'ไม่มีในสต็อก FMP',
  SN_WRONG_BRANCH: 'อยู่สาขาอื่น',
  SN_NOT_READY_FOR_SALE: 'ยังไม่พร้อมขาย',
  SN_MODEL_MISMATCH: 'รุ่นไม่ตรง',
  SN_ALREADY_SOLD_OR_HELD: 'ขายแล้ว/ติดบิลอื่น',
  DUPLICATE_SN_IN_PAYLOAD: 'SN ซ้ำ',
  EMPTY_SN: 'SN ว่าง',
  PRICE_NOT_FOUND: 'ไม่มีราคาขาย',
  SN_CHECK_ERROR: 'ตรวจ SN ไม่ได้',
};
/** The serials of one message: a green tag for each one on the bill, a red one with the reason (and where FMP has it) otherwise. */
export function SnCheckList({ items }: { items: SnCheck[] }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginTop: '4px' }}>
      {items.map((c) => (
        <span
          key={c.sn}
          className={`status-tag ${c.written ? 'status-found' : 'status-outcome'}`}
          title={[c.name, c.model && `รุ่น ${c.model}`, c.upc && `UPC ${c.upc}`, c.branch && `สาขา ${c.branch}`, c.status && `สถานะ ${c.status}`]
            .filter(Boolean)
            .join(' · ')}
        >
          {c.written ? <Check size={11} strokeWidth={2} /> : <X size={11} strokeWidth={2} />} {c.sn}
          {!c.written && ` ${SN_CODE[c.code ?? ''] ?? c.code ?? ''}${c.branch && c.code === 'SN_WRONG_BRANCH' ? ` (${c.branch})` : ''}${c.model && c.code === 'SN_MODEL_MISMATCH' ? ` (${c.model})` : ''}`}
        </span>
      ))}
    </div>
  );
}

interface FmpRow {
  id: string;
  reference: string;
  event: string;
  status: string;
  attempts: number;
  nextAttemptAt: string;
  createdAt: string;
  sentAt: string | null;
  fmpRecordId: string | null;
  scriptResult: string | null;
  snCheck: SnCheck[] | null;
  lastError: string | null;
  ackStatus: string | null;
  ackMessage: string | null;
  ackAt: string | null;
  ackTimeText: string | null;
  ackReceivedAt: string | null;
  /** D130: PRODUCTION | UAT | NONE (held back) */
  target: string;
}
interface FmpLogRow {
  id: string;
  createdAt: string;
  direction: 'OUT' | 'IN' | 'SES';
  kind: string;
  reference: string | null;
  method: string | null;
  path: string | null;
  httpStatus: number | null;
  fmCode: string | null;
  ok: boolean;
  durationMs: number | null;
  summary: string;
}
interface FmpLogDetail extends FmpLogRow {
  batchId: string | null;
  outboxId: string | null;
  request: string | null;
  response: string | null;
}
interface FmpStatus {
  configured: boolean;
  host: string | null;
  database: string | null;
  layout: string | null;
  field: string | null;
  script: string | null;
  callback: { path: string; keySet: boolean };
  /** D130: ADMIN's switch and the test FileMaker it can point at */
  mode: { mode: FmpPushMode; updatedAt: string | null; updatedBy: string | null };
  uat: { configured: boolean; host: string | null; database: string | null };
  counts: { pending: number; sending: number; sent: number; failed: number; skipped: number };
  rows: FmpRow[];
}

/** D130: the three ways orders sent to the cashier can go, in ADMIN's words, with what each one does. */
const MODE: Record<FmpPushMode, { label: string; tag: string; effect: string }> = {
  production: {
    label: 'ส่งจริง',
    tag: 'status-found',
    effect: 'ออเดอร์ที่ STOCK กด "ส่งให้แคชเชียร์" จะเปิดร่างบิลใน U POS (FileMaker จริง) ทันที',
  },
  off: {
    label: 'ปิด',
    tag: 'status-outcome',
    effect:
      'ไม่ส่งอะไรออกจาก SES: ออเดอร์ที่ส่งแคชเชียร์ระหว่างนี้จะจดไว้ใน log ว่า "ไม่ได้ส่ง" และไม่ถูกส่งตามทีหลัง (แคชเชียร์คีย์บิลเองใน U POS) · คิวที่ค้างจากก่อนปิดจะรอ แล้วส่งต่อเมื่อเปิดกลับ',
  },
  uat: {
    label: 'UAT (ทดสอบ)',
    tag: 'status-searching',
    effect:
      'ออเดอร์ใหม่ไป FileMaker ทดสอบ (FMP_UAT_*) พร้อม test=true ไม่เข้า U POS จริง · ยกเว้นการเอาร่างบิลออก (ส่งกลับ STOCK / ยกเลิก) ของออเดอร์ที่ไปถึงของจริงแล้ว ยังไปที่ของจริง',
  },
};
const TARGET: Record<string, string> = { PRODUCTION: 'จริง', UAT: 'UAT', NONE: '—' };

const STATUS: Record<string, { label: string; cls: string }> = {
  pending: { label: 'รอส่ง', cls: 'status-searching' },
  sending: { label: 'กำลังส่ง', cls: 'status-searching' },
  sent: { label: 'ส่งแล้ว', cls: 'status-found' },
  failed: { label: 'ล้มเหลว (ต้องส่งซ้ำเอง)', cls: 'status-outcome' },
  skipped: { label: 'ไม่ได้ส่ง (ปิดการส่งอยู่)', cls: 'status-outcome' },
};
const ACK: Record<string, { label: string; cls: string }> = {
  success: { label: 'สำเร็จ', cls: 'status-found' },
  error: { label: 'FMP แจ้งผิดพลาด', cls: 'status-outcome' },
  reported: { label: 'รายงานกลับ', cls: 'status-searching' },
};
const DIRECTION: Record<string, string> = { OUT: 'SES → FMP', IN: 'FMP → SES', SES: 'ภายใน SES' };
const KIND: Record<string, string> = {
  login: 'ขอ token (login)',
  create: 'สร้าง record',
  update: 'แก้ record เดิม (ส่งซ้ำ)',
  find: 'ค้น record เดิมก่อนส่งซ้ำ',
  script: 'ผลสคริปต์ FMP',
  'record-gone': 'record หายจาก FMP',
  logout: 'คืน token (logout)',
  callback: 'FMP รายงานกลับ',
  queued: 'ใส่คิวส่ง',
  retry: 'สั่งส่งซ้ำ (คิวเดิม)',
  resend: 'สั่งส่งออเดอร์ซ้ำ',
  'will-retry': 'ไม่สำเร็จ จะลองใหม่',
  'gave-up': 'ไม่สำเร็จ เลิกส่ง',
  skipped: 'ไม่ได้ส่ง (สวิตช์)',
  mode: 'ADMIN เปลี่ยนการส่ง',
};
const EVENT: Record<string, string> = {
  SENT_TO_CASHIER: 'ส่งถึงแคชเชียร์',
  RESEND: 'ส่งซ้ำ',
  // D123: these take the held bill away in FileMaker (and free its serials)
  RETURNED_TO_STOCK: 'ส่งกลับ STOCK (เอาบิลพักออก)',
  CANCELLED: 'ยกเลิกออเดอร์ (เอาบิลพักออก)',
};
const fmt = (iso: string) =>
  new Date(iso).toLocaleString('th-TH', {
    timeZone: 'Asia/Bangkok',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

/**
 * ADMIN view of the orders SES sends to FileMaker (D88): is it configured, what is waiting / sent / failed, the latest messages
 * with the FileMaker recordId, a retry for failed ones and a way to send an existing order again. Never shows credentials or
 * the message bodies.
 */
export function FmpPanel() {
  const toast = useToast();
  const [status, setStatus] = useState<FmpStatus | null>(null);
  const [error, setError] = useState('');
  const [reference, setReference] = useState('');
  const [logReference, setLogReference] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);
  const [busy, setBusy] = useState(false);
  const [askMode, setAskMode] = useState<FmpPushMode | null>(null);

  const load = useCallback(async () => {
    try {
      setStatus(await api<FmpStatus>('/admin/fmp'));
      setRefreshKey((k) => k + 1);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'โหลดข้อมูลไม่สำเร็จ');
    }
  }, []);
  useEffect(() => {
    let active = true;
    api<FmpStatus>('/admin/fmp')
      .then((next) => {
        if (active) setStatus(next);
      })
      .catch((err: unknown) => {
        if (active) setError(err instanceof Error ? err.message : 'โหลดข้อมูลไม่สำเร็จ');
      });
    return () => {
      active = false;
    };
  }, []);

  const run = async (work: () => Promise<unknown>, done: string) => {
    setBusy(true);
    try {
      await work();
      toast.success(done, 5000);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'ทำรายการไม่สำเร็จ', 6000);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {error && <Notice error>{error}</Notice>}
      <Panel title="ส่งออเดอร์ไป FileMaker (FMP)">
        {!status ? (
          <Notice>กำลังโหลด…</Notice>
        ) : (
          <>
            <div style={{ marginBottom: '1rem' }}>
              <strong>การส่งเข้า U POS (FileMaker): </strong>
              <span className={`status-tag ${MODE[status.mode.mode].tag}`}>{MODE[status.mode.mode].label}</span>
              {status.mode.updatedBy && (
                <span className="fine muted">
                  {' '}
                  · เปลี่ยนล่าสุดโดย {status.mode.updatedBy}
                  {status.mode.updatedAt ? ` ${fmt(status.mode.updatedAt)}` : ''}
                </span>
              )}
              <p className="fine muted" style={{ margin: '4px 0 8px' }}>
                {MODE[status.mode.mode].effect}
              </p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                {(Object.keys(MODE) as FmpPushMode[]).map((mode) => (
                  <Button
                    key={mode}
                    type="button"
                    size="sm"
                    variant={mode === status.mode.mode ? 'primary' : 'secondary'}
                    disabled={
                      busy ||
                      mode === status.mode.mode ||
                      (mode === 'uat' && !status.uat.configured) ||
                      (mode === 'production' && !status.configured)
                    }
                    onClick={() => setAskMode(mode)}
                  >
                    {MODE[mode].label}
                  </Button>
                ))}
              </div>
              {!status.uat.configured && (
                <p className="fine muted" style={{ marginTop: '4px' }}>
                  UAT ใช้ไม่ได้จนกว่าจะตั้ง <code>FMP_UAT_HOST</code>, <code>FMP_UAT_DATABASE</code>, <code>FMP_UAT_USER</code>,{' '}
                  <code>FMP_UAT_PASSWORD</code> ใน Coolify ของ api (เซิร์ฟเวอร์ FileMaker ทดสอบที่ทีม FMP เตรียม)
                </p>
              )}
              {askMode && (
                <Notice error={askMode === 'production'}>
                  <div>
                    เปลี่ยนเป็น <strong>{MODE[askMode].label}</strong>: {MODE[askMode].effect}
                  </div>
                  <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
                    <Button
                      type="button"
                      size="sm"
                      disabled={busy}
                      onClick={() => {
                        const mode = askMode;
                        setAskMode(null);
                        void run(() => saveFmpPushModeApi(mode), `เปลี่ยนการส่งเข้า U POS เป็น "${MODE[mode].label}" แล้ว`);
                      }}
                    >
                      ยืนยัน
                    </Button>
                    <Button type="button" size="sm" variant="secondary" onClick={() => setAskMode(null)}>
                      ยกเลิก
                    </Button>
                  </div>
                </Notice>
              )}
            </div>
            <dl className="erp-sync-facts">
              <div>
                <dt>การเชื่อมต่อ</dt>
                <dd>{status.configured ? 'ตั้งค่าแล้ว' : 'ยังไม่ได้ตั้งค่า (ไม่ส่งอะไร)'}</dd>
              </div>
              <div>
                <dt>เซิร์ฟเวอร์ / ฐานข้อมูล</dt>
                <dd>{status.configured ? `${status.host} / ${status.database}` : '—'}</dd>
              </div>
              <div>
                <dt>FileMaker UAT (ทดสอบ)</dt>
                <dd>{status.uat.configured ? `${status.uat.host} / ${status.uat.database}` : 'ยังไม่ได้ตั้งค่า'}</dd>
              </div>
              <div>
                <dt>Layout / ฟิลด์</dt>
                <dd>{status.configured ? `${status.layout} / ${status.field}` : '—'}</dd>
              </div>
              <div>
                <dt>สคริปต์ที่เรียกต่อ</dt>
                <dd>{status.script ?? 'ไม่ได้ตั้ง (สร้าง record เฉย ๆ)'}</dd>
              </div>
              <div>
                <dt>Webhook ให้ FMP รายงานกลับ</dt>
                <dd>
                  POST {window.location.origin}
                  {status.callback.path}
                  <div className="fine muted">
                    {status.callback.keySet
                      ? 'ตั้งคีย์แล้ว (FMP_CALLBACK_KEY) · ส่ง Authorization: Bearer <คีย์>'
                      : 'ยังไม่ได้ตั้ง FMP_CALLBACK_KEY (อย่างน้อย 32 ตัวอักษร) ใน Coolify → ประตูนี้ปิดอยู่ (404)'}
                  </div>
                </dd>
              </div>
              <div>
                <dt>รอส่ง / กำลังส่ง</dt>
                <dd>
                  {status.counts.pending} / {status.counts.sending}
                </dd>
              </div>
              <div>
                <dt>ส่งแล้ว / ล้มเหลว</dt>
                <dd>
                  {status.counts.sent} / <strong>{status.counts.failed}</strong>
                </dd>
              </div>
              <div>
                <dt>ไม่ได้ส่ง (ปิดการส่งอยู่)</dt>
                <dd>{status.counts.skipped}</dd>
              </div>
            </dl>
            {!status.configured && (
              <Notice>
                ตั้ง <code>FMP_HOST</code>, <code>FMP_DATABASE</code>, <code>FMP_USER</code>, <code>FMP_PASSWORD</code> ใน Coolify ของ api
                แล้ว restart (รายละเอียดใน docs/coolify-deployment.md) ออเดอร์ที่ถึงแคชเชียร์หลังจากนั้นจะถูกส่งไป FileMaker
                เป็น record ใหม่ใน layout <code>ses</code> ฟิลด์ <code>ses_body</code> (ข้อความ JSON)
              </Notice>
            )}
            {status.counts.failed > 0 && (
              <Notice error>
                มี {status.counts.failed} รายการที่ส่งไม่สำเร็จจนครบจำนวนครั้ง ดูข้อความผิดพลาดในตารางแล้วกด “ส่งซ้ำ” เมื่อ FileMaker พร้อม
              </Notice>
            )}
            <form
              className="payment-add-form"
              onSubmit={(e) => {
                e.preventDefault();
                void run(async () => {
                  await api('/admin/fmp/resend', 'POST', { reference: reference.trim() });
                  setReference('');
                }, 'ใส่คิวส่งซ้ำแล้ว ระบบจะส่งภายในไม่กี่วินาที');
              }}
            >
              <input
                required
                maxLength={32}
                placeholder="ส่งออเดอร์เดิมซ้ำ: ใส่ reference เช่น SES-20261029-000001"
                value={reference}
                onChange={(e) => setReference(e.target.value)}
              />
              <Button type="submit" disabled={busy || !status.configured || !reference.trim()}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                  <Send size={15} />
                  ส่งซ้ำ
                </span>
              </Button>
              <Button type="button" variant="secondary" disabled={busy} onClick={() => void load()}>
                <RefreshCw size={15} />
              </Button>
            </form>
          </>
        )}
      </Panel>
      {status && (
        <Panel title="ข้อความล่าสุด (50 รายการ)">
          {status.rows.length === 0 ? (
            <p>ยังไม่เคยส่ง</p>
          ) : (
            <div className="table-responsive">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>เวลา</th>
                    <th>Reference</th>
                    <th>เหตุการณ์</th>
                    <th>สถานะ</th>
                    <th>ปลายทาง</th>
                    <th>ครั้งที่ลอง</th>
                    <th>recordId (FMP)</th>
                    <th>FMP รายงานกลับ</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {status.rows.map((row) => {
                    const s = STATUS[row.status] ?? { label: row.status, cls: '' };
                    return (
                      <tr key={row.id}>
                        <td>{fmt(row.createdAt)}</td>
                        <td>{row.reference}</td>
                        <td>{EVENT[row.event] ?? row.event}</td>
                        <td>
                          <span className={`status-tag ${s.cls}`}>{s.label}</span>
                          {row.status === 'pending' && row.attempts > 0 && (
                            <div className="fine muted">ลองอีกครั้ง {fmt(row.nextAttemptAt)}</div>
                          )}
                          {row.lastError && <div className="fine muted">{row.lastError}</div>}
                        </td>
                        <td>{TARGET[row.target] ?? row.target}</td>
                        <td>{row.attempts}</td>
                        <td>
                          {row.fmpRecordId ?? '—'}
                          {row.scriptResult ? <div className="fine muted">script: {row.scriptResult}</div> : null}
                          {row.snCheck?.length ? <SnCheckList items={row.snCheck} /> : null}
                        </td>
                        <td>
                          {row.ackStatus ? (
                            <>
                              <span className={`status-tag ${(ACK[row.ackStatus] ?? ACK.reported).cls}`}>
                                {(ACK[row.ackStatus] ?? ACK.reported).label}
                              </span>
                              {row.ackMessage && <div className="fine muted">{row.ackMessage}</div>}
                              <div className="fine muted">
                                {row.ackAt
                                  ? `เวลาจาก FMP ${fmt(row.ackAt)}`
                                  : row.ackTimeText
                                    ? `FMP ส่งเวลา "${row.ackTimeText}" (อ่านไม่ได้)`
                                    : 'FMP ไม่ได้ส่งเวลา'}
                              </div>
                              {row.ackReceivedAt && <div className="fine muted">SES รับเมื่อ {fmt(row.ackReceivedAt)}</div>}
                            </>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td>
                          <Button variant="secondary" size="sm" onClick={() => setLogReference(row.reference)}>
                            ดู log
                          </Button>
                          {(row.status === 'failed' || row.status === 'pending') && (
                            <Button
                              variant="secondary"
                              size="sm"
                              disabled={busy}
                              onClick={() => void run(() => api(`/admin/fmp/outbox/${encodeURIComponent(row.id)}/retry`, 'POST'), 'ใส่คิวส่งซ้ำแล้ว')}
                            >
                              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                                <RotateCcw size={13} />
                                ส่งซ้ำ
                              </span>
                            </Button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      )}
      {status && <FmpLogs reference={logReference} onReference={setLogReference} refreshKey={refreshKey} />}
    </>
  );
}

const fmtMs = (ms: number | null) => (ms === null ? '' : ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`);

/**
 * D90: the log of everything between SES and FileMaker: the calls SES makes (login, create, logout), what FileMaker answered,
 * the reports FileMaker sends back, and SES's own steps (queued, retry, gave up). A row opens to show what was sent and what
 * came back (personal data and the session token are masked before they are stored).
 */
function FmpLogs({ reference, onReference, refreshKey }: { reference: string; onReference: (value: string) => void; refreshKey: number }) {
  const [direction, setDirection] = useState('');
  const [problems, setProblems] = useState(false);
  const [rows, setRows] = useState<FmpLogRow[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState<string | null>(null);
  const [detail, setDetail] = useState<FmpLogDetail | null>(null);
  const [tick, setTick] = useState(0);

  const query = useCallback(
    (after?: string) => {
      const params = new URLSearchParams({ take: '50' });
      if (reference.trim()) params.set('reference', reference.trim());
      if (direction) params.set('direction', direction);
      if (problems) params.set('problems', 'true');
      if (after) params.set('after', after);
      return api<{ rows: FmpLogRow[]; next: string | null }>(`/admin/fmp/logs?${params.toString()}`);
    },
    [reference, direction, problems],
  );

  useEffect(() => {
    let active = true;
    query()
      .then((page) => {
        if (!active) return;
        setRows(page.rows);
        setNext(page.next);
        setError('');
      })
      .catch((err: unknown) => {
        if (active) setError(err instanceof Error ? err.message : 'โหลด log ไม่สำเร็จ');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [query, refreshKey, tick]);

  const more = async () => {
    if (!next) return;
    try {
      const page = await query(next);
      setRows((current) => [...current, ...page.rows]);
      setNext(page.next);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'โหลด log ไม่สำเร็จ');
    }
  };

  const toggle = async (row: FmpLogRow) => {
    if (open === row.id) {
      setOpen(null);
      setDetail(null);
      return;
    }
    setOpen(row.id);
    setDetail(null);
    try {
      setDetail(await api<FmpLogDetail>(`/admin/fmp/logs/${encodeURIComponent(row.id)}`));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'โหลดรายละเอียดไม่สำเร็จ');
    }
  };

  return (
    <Panel title="บันทึกการสื่อสาร SES ↔ FileMaker (Log)">
      <p className="muted" style={{ marginTop: 0 }}>
        ทุกครั้งที่ SES เรียก FileMaker (login, สร้าง record, logout) คำตอบที่ได้ รายงานที่ FileMaker ส่งกลับมา และขั้นตอนของ SES เอง (ใส่คิว, ส่งซ้ำ, เลิกส่ง)
        กดแถวเพื่อดูสิ่งที่ส่งและสิ่งที่ตอบกลับ เบอร์ลูกค้าและ token ถูกปิดบังก่อนบันทึก เก็บไว้ 90 วัน
      </p>
      <div className="payment-add-form">
        <input placeholder="กรองตาม reference (บางส่วนก็ได้)" maxLength={32} value={reference} onChange={(e) => onReference(e.target.value)} />
        <select aria-label="ทิศทาง" value={direction} onChange={(e) => setDirection(e.target.value)}>
          <option value="">ทุกทิศทาง</option>
          <option value="OUT">SES → FMP (เรียก FileMaker)</option>
          <option value="IN">FMP → SES (รายงานกลับ)</option>
          <option value="SES">ภายใน SES</option>
        </select>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', whiteSpace: 'nowrap' }}>
          <input type="checkbox" checked={problems} onChange={(e) => setProblems(e.target.checked)} style={{ flex: 'none' }} />
          เฉพาะที่มีปัญหา
        </label>
        <Button type="button" variant="secondary" onClick={() => setTick((n) => n + 1)}>
          <RefreshCw size={15} />
        </Button>
      </div>
      {error && <Notice error>{error}</Notice>}
      {loading ? (
        <Notice>กำลังโหลด…</Notice>
      ) : rows.length === 0 ? (
        <p>ไม่มีรายการ</p>
      ) : (
        <div className="table-responsive">
          <table className="admin-table">
            <thead>
              <tr>
                <th>เวลา</th>
                <th>ทิศทาง</th>
                <th>ขั้นตอน</th>
                <th>Reference</th>
                <th>ผล</th>
                <th>ใช้เวลา</th>
                <th>สรุป</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <FmpLogLine key={row.id} row={row} open={open === row.id} detail={open === row.id ? detail : null} onToggle={() => void toggle(row)} />
              ))}
            </tbody>
          </table>
        </div>
      )}
      {next && (
        <Button variant="secondary" onClick={() => void more()} style={{ marginTop: '10px' }}>
          โหลดเพิ่ม
        </Button>
      )}
    </Panel>
  );
}

function FmpLogLine({ row, open, detail, onToggle }: { row: FmpLogRow; open: boolean; detail: FmpLogDetail | null; onToggle: () => void }) {
  return (
    <>
      <tr onClick={onToggle} style={{ cursor: 'pointer' }} aria-expanded={open}>
        <td>{fmt(row.createdAt)}</td>
        <td>{DIRECTION[row.direction] ?? row.direction}</td>
        <td>{KIND[row.kind] ?? row.kind}</td>
        <td>{row.reference ?? '—'}</td>
        <td>
          <span className={`status-tag ${row.ok ? 'status-found' : 'status-outcome'}`}>{row.ok ? 'ปกติ' : 'ผิดพลาด'}</span>
          {row.httpStatus !== null && (
            <div className="fine muted">
              HTTP {row.httpStatus}
              {row.fmCode ? ` · code ${row.fmCode}` : ''}
            </div>
          )}
        </td>
        <td>{fmtMs(row.durationMs)}</td>
        <td>{row.summary}</td>
      </tr>
      {open && (
        <tr>
          <td colSpan={7}>
            {!detail ? (
              'กำลังโหลด…'
            ) : (
              <div className="fmp-log-detail">
                {detail.method && detail.path && (
                  <div>
                    <strong>เส้นทาง:</strong> <code>{detail.method} {detail.path}</code>
                  </div>
                )}
                <div className="fine muted">
                  id {detail.id}
                  {detail.outboxId ? ` · outboxId ${detail.outboxId}` : ''}
                  {detail.batchId ? ` · รอบส่ง ${detail.batchId}` : ''}
                </div>
                <strong>{detail.direction === 'IN' ? 'FileMaker ส่งมา' : 'SES ส่งไป'}</strong>
                <pre className="fmp-log-body">{detail.request ?? '(ไม่มีเนื้อหา)'}</pre>
                <strong>{detail.direction === 'IN' ? 'SES ตอบกลับ' : 'ตอบกลับมา'}</strong>
                <pre className="fmp-log-body">{detail.response ?? '(ไม่มีเนื้อหา)'}</pre>
              </div>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

/**
 * D130: everybody at the stock screen: a one-line warning while orders sent to the cashier do NOT open a held bill in the real
 * U POS (ADMIN switched the push off, or to the test FileMaker), so the cashier knows to key the bill in by hand.
 */
export function FmpPushBanner() {
  const [mode, setMode] = useState<FmpPushMode | null>(null);
  useEffect(() => {
    let active = true;
    fetchSettingsApi()
      .then((settings) => {
        if (active) setMode(settings.fmpPushMode ?? 'production');
      })
      .catch(() => undefined); // the banner is a reminder only: no settings, no banner
    return () => {
      active = false;
    };
  }, []);
  if (!mode || mode === 'production') return null;
  return (
    <div style={{ marginBottom: '1rem' }}>
      <Notice error>
        {mode === 'off'
          ? 'ตอนนี้ ADMIN ปิดการส่งเข้า U POS: กด "ส่งให้แคชเชียร์" แล้ว U POS จะไม่มีร่างบิล แคชเชียร์คีย์บิลเอง'
          : 'โหมดทดสอบ (UAT): ออเดอร์ไป FileMaker ทดสอบ ไม่เข้า U POS จริง แคชเชียร์คีย์บิลเองถ้าเป็นการขายจริง'}
      </Notice>
    </div>
  );
}
