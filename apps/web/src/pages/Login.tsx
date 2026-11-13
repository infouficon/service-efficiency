import { useEffect, useRef, useState } from 'react';
import { KeyRound, Lock, LogIn, MessageSquare, ShieldCheck, User } from 'lucide-react';
import { Button, Notice } from '../components/ui';
import { useToast } from '../components/Toast';
import { api } from '../services/api';
import type { Account } from '../types/accounts';

const RESEND_SECONDS = 60;

/**
 * Sign-in. Shows two tabs: "OTP ทาง LINE" (default) and "รหัสผ่าน".
 * Staff sign in with a 6-digit code sent to their LINE on UFiconStaff OA (D113/D117).
 * The password form stays accessible for accounts not synced from ERP (first ADMIN, hand-made accounts).
 */
export function Login({ onLogin }: { onLogin: (user: Account) => void }) {
  const toast = useToast();
  const [usePassword, setUsePassword] = useState(false);
  const [staffId, setStaffId] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const [wait, setWait] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const codeInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (wait <= 0) return;
    const timer = setTimeout(() => setWait((n) => n - 1), 1000);
    return () => clearTimeout(timer);
  }, [wait]);

  const chooseMode = (passwordMode: boolean) => {
    setUsePassword(passwordMode);
    setError('');
    setCodeSent(false);
    setCode('');
  };
  const fail = (err: unknown, fallback: string) => {
    const msg = err instanceof Error ? err.message : fallback;
    setError(msg);
    toast.error(msg);
  };
  const done = (account: Account) => {
    toast.success(`เข้าสู่ระบบสำเร็จ: ${account.name || account.staffId}`);
    onLogin(account);
    setPassword('');
    setCode('');
  };

  const requestCode = async () => {
    setBusy(true);
    setError('');
    try {
      await api('/auth/otp/request', 'POST', { staffId: staffId.trim() });
      setCodeSent(true);
      setCode('');
      setWait(RESEND_SECONDS);
      toast.info('ส่งรหัส OTP แล้ว ดูใน LINE UFiconStaff (ต้องผูก LINE กับระบบ HR ไว้แล้ว)');
      setTimeout(() => codeInput.current?.focus(), 50);
    } catch (err) {
      fail(err, 'ขอรหัส OTP ไม่สำเร็จ');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login">
      <div className="login-story">
        <img
          src="/Uficon-ses-logo.png"
          alt="Service Efficiency"
          className="brand-logo login-brand-logo"
          width={44}
          height={44}
        />
        <p className="eyebrow">ระบบบริการหน้าร้าน iStudio</p>
        <h1>
          ทุกขั้นตอน
          <br />
          <span style={{ color: 'var(--primary-accent)' }}>ของการบริการ</span>
        </h1>
        <p>Staff · Stock</p>
      </div>
      <div className="login-pane">
        <section className="login-card">
          <div className="login-card-header">
            <div className="login-badge-icon" aria-hidden="true">
              <ShieldCheck size={24} />
            </div>
            <div className="login-card-titles">
              <h2>เข้าสู่ระบบ</h2>
              <p className="login-card-subtitle">Service Efficiency</p>
            </div>
          </div>

          <div className="login-tabs">
            <button
              type="button"
              className={`login-tab ${!usePassword ? 'active' : ''}`}
              onClick={() => chooseMode(false)}
            >
              <MessageSquare size={14} /> OTP ทาง LINE
            </button>
            <button
              type="button"
              className={`login-tab ${usePassword ? 'active' : ''}`}
              onClick={() => chooseMode(true)}
            >
              <KeyRound size={14} /> รหัสผ่าน
            </button>
          </div>

          {!usePassword && (
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                if (!codeSent) {
                  await requestCode();
                  return;
                }
                setBusy(true);
                setError('');
                try {
                  done(
                    await api<Account>('/auth/otp/verify', 'POST', {
                      staffId: staffId.trim(),
                      code,
                    }),
                  );
                } catch (err) {
                  fail(err, 'เข้าสู่ระบบไม่สำเร็จ');
                } finally {
                  setBusy(false);
                }
              }}
            >
              <div className="login-field">
                <label htmlFor="login-staff-id" className="login-field-label">
                  Staff ID
                </label>
                <div className="login-input-group">
                  <User size={18} className="login-input-icon" />
                  <input
                    id="login-staff-id"
                    required
                    autoComplete="username"
                    disabled={codeSent}
                    value={staffId}
                    onChange={(e) => setStaffId(e.target.value)}
                    placeholder="Staff ID"
                  />
                </div>
              </div>
              {codeSent && (
                <>
                  <Notice>
                    ส่งรหัส 6 หลักไปที่ LINE <b>UFiconStaff</b> แล้ว (ใช้ได้ 5 นาที) ถ้าไม่ได้รับภายใน 1 นาที ให้ขอรหัสใหม่
                    ถ้ายังไม่เคยผูก LINE ให้กดเมนู “ลงเวลา” ใน LINE UFiconStaff แล้วผูกบัญชีตามขั้นตอนของ HR ก่อน
                    (ถ้าผูกแล้วแต่ยังไม่ได้รับ แจ้ง ADMIN: ระบบยังไม่มี LINE ของคุณ){' '}
                    บัญชีที่สร้างเองใน SES (ไม่ได้มาจาก ERP) เข้าด้วยแท็บ “รหัสผ่าน” ได้
                  </Notice>
                  <div className="login-field">
                    <label htmlFor="login-otp" className="login-field-label">
                      รหัส OTP
                    </label>
                    <div className="login-input-group">
                      <KeyRound size={18} className="login-input-icon" />
                      <input
                        id="login-otp"
                        ref={codeInput}
                        required
                        inputMode="numeric"
                        autoComplete="one-time-code"
                        maxLength={6}
                        pattern="[0-9]{6}"
                        title="ตัวเลข 6 หลัก"
                        value={code}
                        onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                        placeholder="รหัส 6 หลัก"
                      />
                    </div>
                  </div>
                </>
              )}
              {error && <Notice error>{error}</Notice>}
              <Button type="submit" disabled={busy || (codeSent && code.length !== 6)}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', justifyContent: 'center', width: '100%' }}>
                  {codeSent ? <LogIn size={16} /> : <MessageSquare size={16} />}
                  {busy
                    ? 'กรุณารอสักครู่…'
                    : codeSent
                      ? 'เข้าสู่ระบบ'
                      : 'ขอรหัส OTP ทาง LINE'}
                </span>
              </Button>
              {codeSent && (
                <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={busy || wait > 0}
                    onClick={() => void requestCode()}
                  >
                    {wait > 0 ? `ขอรหัสใหม่ได้ใน ${wait} วินาที` : 'ขอรหัสใหม่'}
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={busy}
                    onClick={() => {
                      setCodeSent(false);
                      setCode('');
                      setError('');
                    }}
                  >
                    เปลี่ยน Staff ID
                  </Button>
                </div>
              )}
            </form>
          )}

          {usePassword && (
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                setBusy(true);
                setError('');
                try {
                  done(await api<Account>('/auth/login', 'POST', { staffId, password }));
                } catch (err) {
                  fail(err, 'เข้าสู่ระบบไม่สำเร็จ');
                } finally {
                  setBusy(false);
                }
              }}
            >
              <div className="login-field">
                <label htmlFor="login-staff-id-pwd" className="login-field-label">
                  Staff ID
                </label>
                <div className="login-input-group">
                  <User size={18} className="login-input-icon" />
                  <input
                    id="login-staff-id-pwd"
                    required
                    autoComplete="username"
                    value={staffId}
                    onChange={(e) => setStaffId(e.target.value)}
                    placeholder="Staff ID"
                  />
                </div>
              </div>
              <div className="login-field">
                <label htmlFor="login-password" className="login-field-label">
                  Password
                </label>
                <div className="login-input-group">
                  <Lock size={18} className="login-input-icon" />
                  <input
                    id="login-password"
                    required
                    type="password"
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                  />
                </div>
              </div>
              {error && <Notice error>{error}</Notice>}
              <Button type="submit" disabled={busy}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', justifyContent: 'center', width: '100%' }}>
                  <LogIn size={16} />
                  {busy ? 'กำลังเข้าสู่ระบบ…' : 'เข้าสู่ระบบ'}
                </span>
              </Button>
            </form>
          )}

          {usePassword && (
            <p className="fine" style={{ marginTop: '16px' }}>
              ใช้ได้กับบัญชีที่สร้างเองใน SES เช่น ADMIN พนักงานที่ซิงก์จาก ERP ให้เข้าด้วยแท็บ “OTP ทาง LINE”
            </p>
          )}
        </section>
      </div>
    </div>
  );
}
