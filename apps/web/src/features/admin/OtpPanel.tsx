import { useCallback, useEffect, useState } from 'react';
import { RefreshCw, Send } from 'lucide-react';
import { Button, Notice, Panel } from '../../components/ui';
import { useToast } from '../../components/Toast';
import { api } from '../../services/api';

interface OtpRow {
  id: string;
  staffId: string;
  phoneLast4: string;
  createdAt: string;
  consumedAt: string | null;
  attempts: number;
  smsStatus: string;
  smsError: string | null;
}
interface OtpStatus {
  configured: boolean;
  sender: string | null;
  webhookConfigured: boolean;
  dailyLimit: number;
  last24h: number;
  activeWithoutPhone: number;
  rows: OtpRow[];
}

const SMS_STATUS: Record<string, { label: string; cls: string }> = {
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
 * ADMIN view of the SMS OTP login (D85): is ThaiBulkSMS configured, the webhook address to give it, a test SMS, and the latest
 * login codes with how their SMS went (never the code, never the full number).
 */
export function OtpPanel() {
  const toast = useToast();
  const [status, setStatus] = useState<OtpStatus | null>(null);
  const [error, setError] = useState('');
  const [phone, setPhone] = useState('');
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

  const origin = typeof window === 'undefined' ? '' : window.location.origin;
  return (
    <>
      {error && <Notice error>{error}</Notice>}
      <Panel title="เข้าสู่ระบบด้วย OTP ทาง SMS (ThaiBulkSMS)">
        {!status ? (
          <Notice>กำลังโหลด…</Notice>
        ) : (
          <>
            <dl className="erp-sync-facts">
              <div>
                <dt>การเข้าสู่ระบบ</dt>
                <dd>{status.configured ? 'OTP ทาง SMS' : 'รหัสผ่านแบบเดิม (ยังไม่ตั้งค่า SMS)'}</dd>
              </div>
              <div>
                <dt>ThaiBulkSMS key / secret</dt>
                <dd>{status.configured ? 'ตั้งค่าแล้ว' : 'ยังไม่ได้ตั้งค่า'}</dd>
              </div>
              <div>
                <dt>ชื่อผู้ส่ง (sender)</dt>
                <dd>{status.sender ?? 'ค่าเริ่มต้นของ ThaiBulkSMS'}</dd>
              </div>
              <div>
                <dt>Webhook</dt>
                <dd>{status.webhookConfigured ? 'ตั้งค่าแล้ว' : 'ยังไม่ได้ตั้งค่า'}</dd>
              </div>
              <div>
                <dt>ส่งแล้วใน 24 ชม.</dt>
                <dd>
                  {status.last24h.toLocaleString('th-TH')} / {status.dailyLimit.toLocaleString('th-TH')}
                </dd>
              </div>
              <div>
                <dt>บัญชีที่ใช้งานแต่ไม่มีเบอร์</dt>
                <dd>{status.activeWithoutPhone.toLocaleString('th-TH')}</dd>
              </div>
            </dl>
            {!status.configured && (
              <Notice>
                ตั้ง <code>THAIBULKSMS_API_KEY</code> และ <code>THAIBULKSMS_API_SECRET</code> ใน Coolify ของ api แล้ว restart
                ระบบจะสลับมาใช้ OTP เอง (พนักงานที่ซิงก์จาก ERP จะเข้าด้วยรหัสผ่านไม่ได้อีก)
              </Notice>
            )}
            <p className="fine">
              Webhook URL ให้ ThaiBulkSMS: <code>{origin}/api/webhooks/thaibulksms/&lt;THAIBULKSMS_WEBHOOK_TOKEN&gt;</code> (method POST)
            </p>
            {status.activeWithoutPhone > 0 && (
              <p className="fine">
                พนักงานที่ไม่มีเบอร์เข้าด้วย OTP ไม่ได้ เบอร์ของบัญชีที่ซิงก์จาก ERP มาจากฟิลด์ <code>tel</code> ใน ERP
                (ซิงก์ทุกวัน 10:00) ส่วนบัญชีที่สร้างเองตั้งได้ที่เมนู จัดการผู้ใช้
              </p>
            )}
            <form
              className="payment-add-form"
              onSubmit={(e) => {
                e.preventDefault();
                setBusy(true);
                api<{ usedCredit: number }>('/admin/otp/test-sms', 'POST', { phone })
                  .then((res) => {
                    toast.success(`ส่ง SMS ทดสอบแล้ว (ใช้ ${res.usedCredit} เครดิต)`, 6000);
                    return load();
                  })
                  .catch((err: unknown) =>
                    toast.error(err instanceof Error ? err.message : 'ส่ง SMS ไม่สำเร็จ', 6000),
                  )
                  .finally(() => setBusy(false));
              }}
            >
              <input
                required
                inputMode="tel"
                maxLength={10}
                pattern="0[689][0-9]{8}"
                placeholder="เบอร์สำหรับส่ง SMS ทดสอบ เช่น 0812345678"
                value={phone}
                onChange={(e) => setPhone(e.target.value.replace(/\D/g, ''))}
              />
              <Button type="submit" disabled={busy || !status.configured || phone.length !== 10}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                  <Send size={15} />
                  ส่ง SMS ทดสอบ (1 เครดิต)
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
                    <th>เบอร์ (4 ตัวท้าย)</th>
                    <th>SMS</th>
                    <th>ใช้แล้ว</th>
                    <th>ลองผิด</th>
                  </tr>
                </thead>
                <tbody>
                  {status.rows.map((row) => {
                    const s = SMS_STATUS[row.smsStatus] ?? { label: row.smsStatus, cls: '' };
                    return (
                      <tr key={row.id}>
                        <td>{fmt(row.createdAt)}</td>
                        <td>{row.staffId}</td>
                        <td>••••{row.phoneLast4}</td>
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
