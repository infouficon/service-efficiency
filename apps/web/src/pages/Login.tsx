import { useState } from 'react';
import { LogIn } from 'lucide-react';
import { Button, Notice } from '../components/ui';
import { useToast } from '../components/Toast';
import { api } from '../services/api';
import type { Account } from '../types/accounts';
export function Login({ onLogin }: { onLogin: (user: Account) => void }) {
  const toast = useToast();
  const [staffId, setStaffId] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
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
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError('');
            try {
              const account = await api<Account>('/auth/login', 'POST', {
                staffId,
                password,
              });
              toast.success(`เข้าสู่ระบบสำเร็จ: ${account.name || account.staffId}`);
              onLogin(account);
              setPassword('');
            } catch (err) {
              const msg = err instanceof Error ? err.message : 'เข้าสู่ระบบไม่สำเร็จ';
              setError(msg);
              toast.error(msg);
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
      </section>
    </div>
  );
}
