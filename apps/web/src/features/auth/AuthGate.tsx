import { useEffect, useState } from 'react';
import { App } from '../../app/App';
import { Login } from '../../pages/Login';
import { Button, Notice, Panel } from '../../components/ui';
import { api, ApiError } from '../../services/api';
import type { Account } from '../../types/accounts';
function PasswordChange({
  onDone,
  onLogout,
}: {
  onDone: () => void;
  onLogout: () => void;
}) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <main>
      <Panel title="เปลี่ยนรหัสผ่านก่อนใช้งาน">
        <p>
          บัญชีใหม่หรือบัญชีที่ reset ต้องตั้งรหัสผ่านใหม่อย่างน้อย 8 ตัวอักษร
        </p>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (next !== confirmation) {
              setError('รหัสผ่านใหม่ไม่ตรงกัน');
              return;
            }
            setBusy(true);
            try {
              await api('/auth/password', 'POST', {
                currentPassword: current,
                newPassword: next,
              });
              onDone();
            } catch (err) {
              setError(
                err instanceof Error ? err.message : 'เปลี่ยนรหัสไม่สำเร็จ',
              );
            } finally {
              setBusy(false);
            }
          }}
        >
          <label>
            รหัสผ่านชั่วคราว
            <input
              type="password"
              required
              autoComplete="current-password"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
            />
          </label>
          <label>
            รหัสผ่านใหม่
            <input
              type="password"
              minLength={8}
              maxLength={128}
              required
              autoComplete="new-password"
              value={next}
              onChange={(e) => setNext(e.target.value)}
            />
          </label>
          <label>
            ยืนยันรหัสผ่านใหม่
            <input
              type="password"
              required
              autoComplete="new-password"
              value={confirmation}
              onChange={(e) => setConfirmation(e.target.value)}
            />
          </label>
          {error && <Notice error>{error}</Notice>}
          <Button type="submit" disabled={busy}>
            บันทึกและเข้าสู่ระบบใหม่
          </Button>
          <Button variant="secondary" disabled={busy} onClick={onLogout}>
            ออกจากระบบ
          </Button>
        </form>
      </Panel>
    </main>
  );
}
export function AuthGate() {
  const [user, setUser] = useState<Account | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    api<Account>('/auth/me')
      .then((u) => {
        if (active) setUser(u);
      })
      .catch((err: unknown) => {
        if (active && (!(err instanceof ApiError) || err.status !== 401))
          setError(err instanceof Error ? err.message : 'เชื่อมต่อไม่ได้');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [retry]);
  useEffect(() => {
    const expired = () => setUser(null);
    window.addEventListener('auth-expired', expired);
    return () => window.removeEventListener('auth-expired', expired);
  }, []);
  // Only actual user interaction refreshes server idle time; no perpetual heartbeat.
  // The API clock/session remains authoritative, including activity in other tabs.
  const staffId = user?.staffId;
  useEffect(() => {
    if (!staffId) return;
    let active = true;
    let pending = false;
    let lastCheck = Date.now();
    let expiry: ReturnType<typeof setTimeout>;
    const check = async () => {
      if (pending) return;
      pending = true;
      lastCheck = Date.now();
      try {
        const account = await api<Account>('/auth/me');
        if (active) {
          setUser(account);
          clearTimeout(expiry);
          expiry = setTimeout(() => void check(), 8 * 60 * 60 * 1000);
        }
      } catch (err) {
        if (active && (!(err instanceof ApiError) || err.status !== 401))
          setError(err instanceof Error ? err.message : 'เชื่อมต่อไม่ได้');
      } finally {
        pending = false;
      }
    };
    const activity = (event: Event) => {
      if (event.isTrusted && Date.now() - lastCheck >= 60_000) void check();
    };
    expiry = setTimeout(() => void check(), 8 * 60 * 60 * 1000);
    window.addEventListener('pointerdown', activity);
    window.addEventListener('keydown', activity);
    window.addEventListener('scroll', activity, true);
    return () => {
      active = false;
      clearTimeout(expiry);
      window.removeEventListener('pointerdown', activity);
      window.removeEventListener('keydown', activity);
      window.removeEventListener('scroll', activity, true);
    };
  }, [staffId]);
  const logout = async () => {
    try {
      await api('/auth/logout', 'POST');
      setUser(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'ออกจากระบบไม่สำเร็จ');
    }
  };
  if (loading)
    return (
      <main>
        <Notice>กำลังตรวจสอบ session…</Notice>
      </main>
    );
  if (error)
    return (
      <main>
        <Notice error>{error}</Notice>
        <Button
          onClick={() => {
            setError('');
            setLoading(true);
            setRetry((n) => n + 1);
          }}
        >
          ลองอีกครั้ง
        </Button>
      </main>
    );
  if (!user) return <Login onLogin={setUser} />;
  if (user.mustChangePassword)
    return (
      <PasswordChange
        onDone={() => setUser(null)}
        onLogout={() => void logout()}
      />
    );
  return (
    <App
      key={`${user.staffId}:${user.branchId}:${user.roles.join(',')}`}
      account={user}
      onLogout={() => void logout()}
      onAccountChange={setUser}
    />
  );
}
