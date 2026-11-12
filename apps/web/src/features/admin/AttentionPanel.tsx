import { useCallback, useEffect, useState } from 'react';
import { RefreshCw, RotateCcw } from 'lucide-react';
import { Button, Notice, Panel } from '../../components/ui';
import { useToast } from '../../components/Toast';
import { api } from '../../services/api';
import { SnCheckList, type SnCheck } from './FmpPanel';

interface WaitingRow {
  sessionId: string;
  reference: string;
  branch: string;
  branchCode: string;
  queueNo: number | null;
  stage: 'no-bill' | 'held-bill' | 'bill-open';
  since: string | null;
  minutes: number | null;
  posBillNo: string | null;
  fmp: {
    status: string;
    error: string | null;
    ackStatus: string | null;
    ackMessage: string | null;
  } | null;
}
interface ProblemRow {
  outboxId: string;
  reference: string;
  event: string;
  kind: 'failed' | 'stuck' | 'ack-error' | 'sn-skipped';
  /** D119: the serials of that message, as FileMaker checked them */
  snCheck?: SnCheck[] | null;
  attempts: number;
  message: string | null;
  at: string;
  minutes: number;
}
interface Attention {
  thresholds: { openMinutes: number; payMinutes: number; stuckMinutes: number };
  waiting: WaitingRow[];
  problems: ProblemRow[];
  total: number;
}

const REFRESH_MS = 60_000;
const STAGE: Record<WaitingRow['stage'], string> = {
  'no-bill': 'ยังไม่เปิดบิล',
  'held-bill': 'FMP เปิดบิลพักแล้ว ยังไม่ชำระ',
  'bill-open': 'เปิดบิลแล้ว ยังไม่ชำระ',
};
const KIND: Record<ProblemRow['kind'], { label: string; cls: string }> = {
  failed: { label: 'ส่งไม่สำเร็จ', cls: 'status-outcome' },
  stuck: { label: 'ค้างในคิวส่ง', cls: 'status-searching' },
  'ack-error': { label: 'FMP แจ้งผิดพลาด', cls: 'status-outcome' },
  'sn-skipped': { label: 'SN ไม่ได้ลงบิล', cls: 'status-searching' },
};
/** "45 นาที", "5 ชม. 20 น.", "2 วัน 3 ชม." */
const ageText = (minutes: number | null) => {
  if (minutes === null) return '—';
  if (minutes < 60) return `${minutes} นาที`;
  if (minutes < 24 * 60)
    return `${Math.floor(minutes / 60)} ชม. ${minutes % 60} น.`;
  return `${Math.floor(minutes / 1440)} วัน ${Math.floor((minutes % 1440) / 60)} ชม.`;
};
const fmpText = (fmp: WaitingRow['fmp']) => {
  if (!fmp) return 'ยังไม่ได้ส่ง FMP';
  // D130: ADMIN's switch held it back: U POS has no held bill, the cashier keys it in (or ADMIN closes the sale here)
  if (fmp.status === 'skipped') return 'ไม่ได้ส่ง FMP (ปิดการส่งอยู่ตอนกดส่ง)';
  if (fmp.ackStatus === 'error')
    return `FMP แจ้งผิดพลาด${fmp.ackMessage ? `: ${fmp.ackMessage}` : ''}`;
  if (fmp.status === 'failed')
    return `ส่ง FMP ไม่สำเร็จ${fmp.error ? `: ${fmp.error}` : ''}`;
  if (fmp.status === 'sent')
    return fmp.ackStatus === 'success'
      ? 'FMP รับแล้ว'
      : 'ส่ง FMP แล้ว (ยังไม่มีคำตอบ)';
  return 'รอส่ง FMP';
};

/**
 * SES-10 (D116): what needs a person, for ADMIN. Orders sent to the cashier where U POS / FileMaker has not opened a bill (or the
 * customer has not paid) after the limit, and orders whose message to FileMaker failed, is stuck or was answered with an error. It
 * refreshes by itself every minute; a failed message can be sent again here.
 */
export function AttentionPanel() {
  const toast = useToast();
  const [data, setData] = useState<Attention | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await api<Attention>('/admin/fmp/attention'));
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'โหลดข้อมูลไม่สำเร็จ');
    }
  }, []);
  useEffect(() => {
    let active = true;
    const pull = () =>
      api<Attention>('/admin/fmp/attention')
        .then((next) => {
          if (!active) return;
          setData(next);
          setError('');
        })
        .catch((err: unknown) => {
          if (active)
            setError(
              err instanceof Error ? err.message : 'โหลดข้อมูลไม่สำเร็จ',
            );
        });
    void pull();
    const timer = setInterval(() => void pull(), REFRESH_MS);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);

  const send = async (row: ProblemRow) => {
    setBusy(true);
    try {
      if (row.kind === 'ack-error')
        await api('/admin/fmp/resend', 'POST', { reference: row.reference });
      else await api(`/admin/fmp/outbox/${row.outboxId}/retry`, 'POST');
      toast.success(`สั่งส่ง ${row.reference} ไป FMP อีกครั้งแล้ว`, 5000);
      await load();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'สั่งส่งซ้ำไม่สำเร็จ',
        6000,
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {error && <Notice error>{error}</Notice>}
      <Panel
        title={
          data && data.total > 0
            ? `ออเดอร์ที่ต้องดู (${data.total})`
            : 'ออเดอร์ที่ต้องดู'
        }
      >
        {!data ? (
          <Notice>กำลังโหลด…</Notice>
        ) : (
          <>
            <p className="fine">
              เกณฑ์: ส่งถึงแคชเชียร์แล้วยังไม่เปิดบิลเกิน{' '}
              {ageText(data.thresholds.openMinutes)}, เปิดบิลแล้วยังไม่ชำระเกิน{' '}
              {ageText(data.thresholds.payMinutes)}, ข้อความไป FMP ค้างเกิน{' '}
              {ageText(data.thresholds.stuckMinutes)} (ย้อนหลัง 14 วัน
              รีเฟรชเองทุก 1 นาที) ถ้า FMP ไม่ส่งเลขบิลกลับ
              ปิดการขายเองได้ที่หน้า ประวัติ → ปิดการขาย (แทน U POS)
              <Button
                type="button"
                variant="secondary"
                disabled={busy}
                onClick={() => void load()}
              >
                <RefreshCw size={15} />
              </Button>
            </p>
            {data.total === 0 && <Notice>ไม่มีรายการที่ต้องดู</Notice>}
            {data.waiting.length > 0 && (
              <div className="table-responsive">
                <h3>ค้างรอบิล ({data.waiting.length})</h3>
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>ออเดอร์</th>
                      <th>สาขา</th>
                      <th>รอมาแล้ว</th>
                      <th>สถานะ</th>
                      <th>ฝั่ง FMP</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.waiting.map((row) => (
                      <tr key={row.sessionId}>
                        <td>
                          {row.reference}
                          {row.queueNo !== null && (
                            <div className="fine muted">
                              คิว {String(row.queueNo).padStart(3, '0')}
                            </div>
                          )}
                        </td>
                        <td>{row.branch}</td>
                        <td>
                          <strong>{ageText(row.minutes)}</strong>
                        </td>
                        <td>
                          {STAGE[row.stage]}
                          {row.posBillNo && (
                            <div className="fine muted">
                              บิล {row.posBillNo}
                            </div>
                          )}
                        </td>
                        <td>{fmpText(row.fmp)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {data.problems.length > 0 && (
              <div className="table-responsive">
                <h3>ข้อความไป FMP มีปัญหา ({data.problems.length})</h3>
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>ออเดอร์</th>
                      <th>ปัญหา</th>
                      <th>รายละเอียด</th>
                      <th>มาแล้ว</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {data.problems.map((row) => (
                      <tr key={row.outboxId}>
                        <td>{row.reference}</td>
                        <td>
                          <span className={`status-tag ${KIND[row.kind].cls}`}>
                            {KIND[row.kind].label}
                          </span>
                          {row.attempts > 0 && (
                            <div className="fine muted">
                              ลอง {row.attempts} ครั้ง
                            </div>
                          )}
                        </td>
                        <td>
                          {row.kind === 'sn-skipped'
                            ? 'เปิดบิลแล้ว แคชเชียร์ต้องสแกนเครื่องที่ไม่ได้ลงบิลเพิ่มใน FMP'
                            : (row.message ?? '—')}
                          {row.snCheck?.length ? (
                            <SnCheckList items={row.snCheck} />
                          ) : null}
                        </td>
                        <td>{ageText(row.minutes)}</td>
                        <td>
                          {row.kind !== 'sn-skipped' && (
                            <Button
                              type="button"
                              variant="secondary"
                              disabled={busy}
                              onClick={() => void send(row)}
                            >
                              <span
                                style={{
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: '6px',
                                }}
                              >
                                <RotateCcw size={14} />
                                {row.kind === 'ack-error'
                                  ? 'ส่งออเดอร์ซ้ำ'
                                  : 'ส่งซ้ำ'}
                              </span>
                            </Button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </Panel>
    </>
  );
}
