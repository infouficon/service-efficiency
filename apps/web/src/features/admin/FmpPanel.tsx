import { useCallback, useEffect, useState } from 'react';
import { RefreshCw, RotateCcw, Send } from 'lucide-react';
import { Button, Notice, Panel } from '../../components/ui';
import { useToast } from '../../components/Toast';
import { api } from '../../services/api';

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
  lastError: string | null;
}
interface FmpStatus {
  configured: boolean;
  host: string | null;
  database: string | null;
  layout: string | null;
  field: string | null;
  script: string | null;
  counts: { pending: number; sending: number; sent: number; failed: number };
  rows: FmpRow[];
}

const STATUS: Record<string, { label: string; cls: string }> = {
  pending: { label: 'รอส่ง', cls: 'status-searching' },
  sending: { label: 'กำลังส่ง', cls: 'status-searching' },
  sent: { label: 'ส่งแล้ว', cls: 'status-found' },
  failed: { label: 'ล้มเหลว (ต้องส่งซ้ำเอง)', cls: 'status-outcome' },
};
const EVENT: Record<string, string> = {
  SENT_TO_CASHIER: 'ส่งถึงแคชเชียร์',
  RESEND: 'ส่งซ้ำ',
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
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setStatus(await api<FmpStatus>('/admin/fmp'));
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
                <dt>Layout / ฟิลด์</dt>
                <dd>{status.configured ? `${status.layout} / ${status.field}` : '—'}</dd>
              </div>
              <div>
                <dt>สคริปต์ที่เรียกต่อ</dt>
                <dd>{status.script ?? 'ไม่ได้ตั้ง (สร้าง record เฉย ๆ)'}</dd>
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
                    <th>ครั้งที่ลอง</th>
                    <th>recordId (FMP)</th>
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
                        <td>{row.attempts}</td>
                        <td>
                          {row.fmpRecordId ?? '—'}
                          {row.scriptResult ? <div className="fine muted">script: {row.scriptResult}</div> : null}
                        </td>
                        <td>
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
    </>
  );
}
