import { useCallback, useEffect, useState } from 'react';
import { MessageCircle, RefreshCw } from 'lucide-react';
import { Button, Notice, Panel } from '../../components/ui';
import { useToast } from '../../components/Toast';
import { api } from '../../services/api';

interface OtpRow {
  id: string;
  staffId: string;
  createdAt: string;
  consumedAt: string | null;
  attempts: number;
  /** 'sms' only on the rows from before D117 */
  channel: 'line' | 'sms';
  smsStatus: string;
  smsError: string | null;
}
interface OtpStatus {
  otp: boolean;
  /** D113: the UFiconStaff LINE OA, and how many active ERP accounts the ERP import gave a LINE userId */
  line: { configured: boolean; ufhrConfigured: boolean; erpActive: number; erpWithLine: number };
  dailyLimit: number;
  last24h: number;
  rows: OtpRow[];
}

const OTP_STATUS: Record<string, { label: string; cls: string }> = {
  pending: { label: 'กำลังส่ง', cls: 'status-searching' },
  sent: { label: 'ส่งแล้ว', cls: 'status-found' },
  delivered: { label: 'ถึงเครื่องแล้ว', cls: 'status-found' },
  undelivered: { label: 'ส่งไม่ถึง', cls: 'status-outcome' },
  failed: { label: 'ส่งไม่สำเร็จ', cls: 'status-outcome' },
  reported: { label: 'มีรายงานกลับ', cls: 'status-cashier_received' },
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
 * ADMIN view of the OTP login (D113, D117): the UFiconStaff LINE OA, where LINE userIds come from (UFHR or the ERP), how many
 * accounts have one, a test message, and the latest login codes with how they went (never the code). SMS is gone.
 */
export function OtpPanel() {
  const toast = useToast();
  const [status, setStatus] = useState<OtpStatus | null>(null);
  const [error, setError] = useState('');
  const [lineStaffId, setLineStaffId] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setStatus(await api<OtpStatus>('/admin/otp'));
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'โหลดข้อมูลไม่สำเร็จ');
    }
  }, []);
  useEffect(() => {
    let active = true;
    api<OtpStatus>('/admin/otp')
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

  return (
    <>
      {error && <Notice error>{error}</Notice>}
      {status && (
        <Panel title="เข้าสู่ระบบด้วย OTP ทาง LINE (UFiconStaff)">
          <dl className="erp-sync-facts">
            <div>
              <dt>การเข้าสู่ระบบ</dt>
              <dd>
                {status.otp ? 'OTP ทาง LINE' : 'รหัสผ่านแบบเดิม (ยังไม่ตั้งค่า LINE)'}
              </dd>
            </div>
            <div>
              <dt>LINE channel access token</dt>
              <dd>{status.line.configured ? 'ตั้งค่าแล้ว' : 'ยังไม่ได้ตั้งค่า'}</dd>
            </div>
            <div>
              <dt>ถาม LINE จาก UFHR</dt>
              <dd>{status.line.ufhrConfigured ? 'ตั้งค่าแล้ว (ถาม UFHR ก่อนทุกครั้ง)' : 'ยังไม่ได้ตั้งค่า (ใช้ LINE จาก ERP อย่างเดียว)'}</dd>
            </div>
            <div>
              <dt>บัญชี ERP ที่มี LINE ใน ERP</dt>
              <dd>
                {status.line.erpWithLine.toLocaleString('th-TH')} / {status.line.erpActive.toLocaleString('th-TH')}
              </dd>
            </div>
            <div>
              <dt>ส่งรหัสแล้วใน 24 ชม.</dt>
              <dd>
                {status.last24h.toLocaleString('th-TH')} / {status.dailyLimit.toLocaleString('th-TH')}
              </dd>
            </div>
          </dl>
          {!status.line.configured && (
            <Notice>
              ตั้ง <code>LINE_CHANNEL_ACCESS_TOKEN</code> (OA UFiconStaff) ใน Coolify ของ api แล้ว restart เพื่อเปิดการเข้าสู่ระบบด้วย OTP
              ทาง LINE (ไม่มี SMS แล้ว) พนักงานที่ซิงก์จาก ERP จะเข้าด้วยรหัสผ่านไม่ได้ และคนที่ยังไม่มี LINE userId จะเข้าไม่ได้จนกว่าจะมี
            </Notice>
          )}
          {status.line.configured && status.line.erpWithLine < status.line.erpActive && (
            <Notice>
              {(status.line.erpActive - status.line.erpWithLine).toLocaleString('th-TH')} บัญชี ERP ยังไม่มี LINE userId ใน ERP
              {status.line.ufhrConfigured ? ' (ถาม UFHR ได้อีกทาง)' : ' และยังไม่ได้ต่อ UFHR'} คนเหล่านี้ขอรหัส OTP ไม่ได้ ดูว่าใครอยู่ที่เมนู
              จัดการผู้ใช้ (ป้าย “ไม่มี LINE”) ให้กรอก <code>line_user_id</code> ใน ERP แล้วซิงก์ หรือรอ UFHR
            </Notice>
          )}
          <p className="fine">
            LINE userId มาจาก UFHR (ระบบ HR ที่พนักงานผูก LINE ตอนลงเวลา) เมื่อตั้ง <code>UFHR_API_BASE</code> กับ{' '}
            <code>UFHR_API_KEY</code> ถ้าไม่ได้ตั้งหรือ UFHR ไม่มี ใช้ <code>line_user_id</code> ที่ซิงก์จาก ERP แทน
          </p>
          <form
            className="payment-add-form"
            onSubmit={(e) => {
              e.preventDefault();
              setBusy(true);
              api<{ source: 'ufhr' | 'erp' }>('/admin/otp/test-line', 'POST', { staffId: lineStaffId.trim() })
                .then((res) => {
                  toast.success(`ส่ง LINE ทดสอบแล้ว (LINE userId จาก ${res.source === 'ufhr' ? 'UFHR' : 'ERP'})`, 6000);
                  return load();
                })
                .catch((err: unknown) => toast.error(err instanceof Error ? err.message : 'ส่ง LINE ไม่สำเร็จ', 8000))
                .finally(() => setBusy(false));
            }}
          >
            <input
              required
              maxLength={64}
              placeholder="Staff ID สำหรับส่ง LINE ทดสอบ"
              value={lineStaffId}
              onChange={(e) => setLineStaffId(e.target.value)}
            />
            <Button type="submit" disabled={busy || !status.line.configured || !lineStaffId.trim()}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                <MessageCircle size={15} />
                ส่ง LINE ทดสอบ
              </span>
            </Button>
            <Button type="button" variant="secondary" disabled={busy} onClick={() => void load()}>
              <RefreshCw size={15} />
            </Button>
          </form>
        </Panel>
      )}
      {status && (
        <Panel title="รหัส OTP ล่าสุด (50 รายการ)">
          {status.rows.length === 0 ? (
            <p>ยังไม่เคยส่งรหัส</p>
          ) : (
            <div className="table-responsive">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>เวลา</th>
                    <th>Staff ID</th>
                    <th>ช่องทาง</th>
                    <th>ผลการส่ง</th>
                    <th>ใช้แล้ว</th>
                    <th>ลองผิด</th>
                  </tr>
                </thead>
                <tbody>
                  {status.rows.map((row) => {
                    const s = OTP_STATUS[row.smsStatus] ?? { label: row.smsStatus, cls: '' };
                    return (
                      <tr key={row.id}>
                        <td>{fmt(row.createdAt)}</td>
                        <td>{row.staffId}</td>
                        <td>{row.channel === 'line' ? 'LINE' : 'SMS (เดิม)'}</td>
                        <td>
                          <span className={`status-tag ${s.cls}`} title={row.smsError ?? undefined}>
                            {s.label}
                          </span>
                          {row.smsError && <div className="fine muted">{row.smsError}</div>}
                        </td>
                        <td>{row.consumedAt ? fmt(row.consumedAt) : '—'}</td>
                        <td>{row.attempts}</td>
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
