import { useEffect, useRef, useState } from 'react';
import { LogIn, MessageSquare } from 'lucide-react';
import { Button, Notice } from '../components/ui';
import { useToast } from '../components/Toast';
import { api } from '../services/api';
import type { Account } from '../types/accounts';

const RESEND_SECONDS = 60;

/**
 * Sign-in. Once the server has SMS configured (`GET /auth/config` -> `otp`) staff sign in with a 6-digit code sent to the
 * phone on their account (D85); the password form stays one click away for the accounts that are not synced from the ERP
 * (the first ADMIN, hand-made accounts). Without SMS it is the password form as before.
 */
export function Login({ onLogin }: { onLogin: (user: Account) => void }) {
  const toast = useToast();
  const [otpAvailable, setOtpAvailable] = useState<boolean | null>(null);
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
    let active = true;
    api<{ otp: boolean }>('/auth/config')
      .then((config) => {
        if (active) setOtpAvailable(config.otp);
      })
      .catch(() => {
        if (active) setOtpAvailable(false);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (wait <= 0) return;
    const timer = setTimeout(() => setWait((n) => n - 1), 1000);
    return () => clearTimeout(timer);
  }, [wait]);

  const otpMode = otpAvailable === true && !usePassword;
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
      toast.info('ส่งรหัส OTP แล้ว ถ้ามีบัญชีนี้และมีเบอร์โทรในระบบ');
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
        <span className="brand-mark">S</span>
        <p className="eyebrow">SERVICE EFFICIENCY SYSTEM</p>
        <h1><em>
          ทุกขั้นตอน
          <br />
          ของการบริการ
          <br /></em>
        </h1>
        <p>Staff · Stock · Cashier</p>
      </div>
      <section className="login-form">
        <h2>เข้าสู่ระบบ</h2>
        {otpAvailable === null && <Notice>กำลังโหลด…</Notice>}
        {otpMode && (
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
            <label>
              Staff ID
              <input
                required
                autoComplete="username"
                disabled={codeSent}
                value={staffId}
                onChange={(e) => setStaffId(e.target.value)}
              />
            </label>
            {codeSent && (
              <>
                <Notice>
                  ส่งรหัส 6 หลักไปที่เบอร์มือถือที่ลงทะเบียนไว้ใน ERP แล้ว (ใช้ได้ 5 นาที)
                  ถ้าไม่ได้รับภายใน 1 นาที ให้ขอรหัสใหม่ หรือแจ้ง ADMIN ว่าเบอร์ของคุณใน ERP ยังไม่ถูกต้อง
                </Notice>
                <label>
                  รหัส OTP
                  <input
                    ref={codeInput}
                    required
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={6}
                    pattern="[0-9]{6}"
                    title="ตัวเลข 6 หลัก"
                    value={code}
                    onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                  />
                </label>
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
                    : 'ขอรหัส OTP ทาง SMS'}
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
        {otpAvailable !== null && !otpMode && (
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
            <label>
              Staff ID
              <input
                required
                autoComplete="username"
                value={staffId}
                onChange={(e) => setStaffId(e.target.value)}
              />
            </label>
            <label>
              Password
              <input
                required
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
            {error && <Notice error>{error}</Notice>}
            <Button type="submit" disabled={busy}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', justifyContent: 'center', width: '100%' }}>
                <LogIn size={16} />
                {busy ? 'กำลังเข้าสู่ระบบ…' : 'เข้าสู่ระบบ'}
              </span>
            </Button>
          </form>
        )}
        {otpAvailable === true && (
          <p className="fine" style={{ marginTop: '12px' }}>
            <button
              type="button"
              className="text-button"
              onClick={() => {
                setUsePassword((v) => !v);
                setError('');
              }}
            >
              {usePassword ? '← กลับไปเข้าด้วยรหัส OTP' : 'เข้าด้วยรหัสผ่าน (ADMIN / บัญชีที่สร้างเองใน SES)'}
            </button>
          </p>
        )}
      </section>
    </div>
  );
}
