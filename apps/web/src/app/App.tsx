import { useEffect, useState } from 'react';
import {
  User as UserIcon,
  Package,
  CreditCard,
  ShoppingBag,
  ClipboardList,
  ShieldCheck,
  Building2,
  Database,
  LogOut,
  Layers,
  Menu,
  X,
} from 'lucide-react';
import { Button, Notice } from '../components/ui';
import type { AppView, MockSession, MockUser } from '../types/session';
import type { Account } from '../types/accounts';
import { StaffWorkspace } from '../features/session/StaffWorkspace';
import { StockWorkspace } from '../features/stock/StockWorkspace';
import { CashierWorkspace } from '../features/cashier/CashierWorkspace';
import { ProductWorkspace } from '../features/products/ProductWorkspace';
import { SessionLogsWorkspace } from '../features/logs/SessionLogsWorkspace';
import { AdminHub } from '../features/admin/AdminHub';
import { fetchSessionsApi } from '../services/sessionApi';
import { isToday } from '../features/session/workflow';

function parseHashView(hash: string): AppView | null {
  const clean = hash.replace(/^#\/?/, '');
  if (!clean) return null;
  const [pathPart] = clean.split('?');
  const mainView = pathPart.split('/')[0] as AppView;
  const validViews: AppView[] = [
    'staff',
    'stock',
    'cashier',
    'logs',
    'products',
    'admin',
  ];
  return validViews.includes(mainView) ? mainView : null;
}

function isViewAllowed(v: AppView, u: MockUser): boolean {
  if (v === 'staff') return u.roles.includes('STAFF');
  if (v === 'stock') return u.roles.includes('STOCK');
  if (v === 'cashier') return u.roles.includes('CASHIER');
  if (v === 'products')
    return u.roles.includes('ADMIN') || u.roles.includes('MANAGER');
  if (v === 'admin')
    return u.roles.includes('ADMIN') || u.roles.includes('MANAGER');
  return true; // 'logs' is accessible
}

function getDefaultView(u: MockUser): AppView {
  if (u.roles.includes('ADMIN') || u.roles.includes('MANAGER')) return 'logs';
  if (u.roles.includes('STAFF')) return 'staff';
  if (u.roles.includes('STOCK')) return 'stock';
  if (u.roles.includes('CASHIER')) return 'cashier';
  return 'logs';
}

function getInitialView(u: MockUser): AppView {
  if (typeof window !== 'undefined') {
    const parsed = parseHashView(window.location.hash);
    if (parsed && isViewAllowed(parsed, u)) {
      return parsed;
    }
  }
  return getDefaultView(u);
}

export function App({
  account,
  onLogout,
  onAccountChange,
}: {
  account: Account;
  onLogout: () => void;
  onAccountChange: (user: Account) => void;
}) {
  const user: MockUser = {
    ...account,
    branchCode: account.branchCode ?? account.branchId ?? undefined,
  };
  const [productSubView, setProductSubView] = useState<'MAIN' | 'STOCK'>('MAIN');
  const [sessions, setSessions] = useState<MockSession[]>([]);
  const [view, setView] = useState<AppView>(() => getInitialView(user));
  const [notice, setNotice] = useState('');
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  // Sync view state with browser hash routing (Back/Forward buttons)
  useEffect(() => {
    const syncFromHash = () => {
      const parsed = parseHashView(window.location.hash);
      if (parsed && isViewAllowed(parsed, user)) {
        setView(parsed);
      } else {
        const def = getDefaultView(user);
        setView(def);
        if (window.location.hash !== `#/${def}`) {
          window.history.replaceState(null, '', `#/${def}`);
        }
      }
    };

    syncFromHash();
    window.addEventListener('hashchange', syncFromHash);
    return () => window.removeEventListener('hashchange', syncFromHash);
  }, [user]);

  useEffect(() => {
    let mounted = true;
    const loadSessions = async () => {
      try {
        const branchFilter = user.roles.includes('ADMIN') ? undefined : user.branchCode;
        const data = await fetchSessionsApi(branchFilter);
        if (mounted) {
          setSessions((prev) => {
            return data.map((serverS) => {
              const local = prev.find((p) => p.reference === serverS.reference);
              const merged: MockSession = {
                ...serverS,
              };

              if (local && !local.confirmed && !local.outcome) {
                merged.phone = local.phone || serverS.phone;
                merged.selection =
                  local.selection &&
                  (local.selection.product || Object.keys(local.selection.accessories).length > 0)
                    ? {
                        ...serverS.selection,
                        ...local.selection,
                        accessories: {
                          ...serverS.selection.accessories,
                          ...local.selection.accessories,
                        },
                      }
                    : serverS.selection;
              }
              return merged;
            });
          });
        }
      } catch {
        // Fallback or ignore network error during polling
      }
    };

    loadSessions();
    const timer = setInterval(loadSessions, 4000);
    return () => {
      mounted = false;
      clearInterval(timer);
    };
  }, [user.branchCode, user.roles]);

  // Permission checks
  const canAccessStaff = user.roles.includes('STAFF');
  const canAccessStock = user.roles.includes('STOCK');
  const canAccessCashier = user.roles.includes('CASHIER');
  const canAccessAdmin =
    user.roles.includes('ADMIN') || user.roles.includes('MANAGER');
  const canAccessProducts =
    user.roles.includes('ADMIN') || user.roles.includes('MANAGER');

  // Queue counts for badges
  const currentBranchCode = user.branchCode ?? '';
  const branchSessions = sessions.filter((s) => {
    if (user.roles.includes('ADMIN')) return true;
    return s.branchCode === currentBranchCode;
  });

  const stockPendingCount = branchSessions.filter(
    (s) =>
      !s.outcome &&
      isToday(s.timestamps.customer_walk_in_at) &&
      ['STOCK_REQUESTED', 'SEARCHING'].includes(s.state),
  ).length;

  const cashierPendingCount = branchSessions.filter(
    (s) =>
      !s.outcome &&
      isToday(s.timestamps.customer_walk_in_at) &&
      [
        'SENT_TO_CASHIER',
        'CASHIER_RECEIVED',
        'CASHIER_SCAN',
        'BILL_OPENED',
      ].includes(s.state),
  ).length;

  const handleUpdateSession = (updated: MockSession) => {
    setSessions((prev) =>
      prev.map((s) => (s.reference === updated.reference ? updated : s)),
    );
  };

  const handleAddSession = (newSession: MockSession) => {
    setSessions((prev) => [newSession, ...prev]);
  };

  const handleSelectView = (newView: AppView) => {
    if (window.location.hash !== `#/${newView}`) {
      window.location.hash = `#/${newView}`;
    } else {
      setView(newView);
    }
    setIsMobileMenuOpen(false);
  };

  return (
    <div className="app-shell">
      {/* Mobile Drawer Overlay */}
      {isMobileMenuOpen && (
        <div
          className="mobile-drawer-overlay"
          onClick={() => setIsMobileMenuOpen(false)}
          aria-hidden="true"
        />
      )}

      <aside className={`sidebar ${isMobileMenuOpen ? 'sidebar-open' : ''}`}>
        <div className="sidebar-header-row">
          <a
            className="brand"
            href={`#/${getDefaultView(user)}`}
            onClick={(e) => {
              e.preventDefault();
              handleSelectView(getDefaultView(user));
            }}
          >
            <span className="brand-mark">S</span>
            <span>
              Service
              <br />
              <strong>Efficiency</strong>
            </span>
          </a>
          <button
            className="sidebar-close-btn"
            onClick={() => setIsMobileMenuOpen(false)}
            aria-label="Close menu"
          >
            <X size={20} />
          </button>
        </div>

        <p className="nav-label">WORKSPACES</p>
        <nav>
          {canAccessStaff && (
            <button
              className={view === 'staff' ? 'nav-active' : ''}
              onClick={() => handleSelectView('staff')}
            >
              <UserIcon size={18} /> <span>หน้าร้าน (Staff Service)</span>
            </button>
          )}

          {canAccessStock && (
            <button
              className={view === 'stock' ? 'nav-active' : ''}
              onClick={() => handleSelectView('stock')}
            >
              <Package size={18} /> <span>คลังสินค้า (Stock)</span>
              {stockPendingCount > 0 && (
                <span className="nav-counter">{stockPendingCount}</span>
              )}
            </button>
          )}

          {canAccessCashier && (
            <button
              className={view === 'cashier' ? 'nav-active' : ''}
              onClick={() => handleSelectView('cashier')}
            >
              <CreditCard size={18} /> <span>แคชเชียร์ (Cashier)</span>
              {cashierPendingCount > 0 && (
                <span className="nav-counter">{cashierPendingCount}</span>
              )}
            </button>
          )}

          <button
            className={view === 'logs' ? 'nav-active' : ''}
            onClick={() => handleSelectView('logs')}
          >
            <ClipboardList size={18} /> <span>ประวัติการทำรายการ</span>
          </button>

          {canAccessProducts && (
            <div>
              <button
                className={view === 'products' ? 'nav-active' : ''}
                onClick={() => handleSelectView('products')}
              >
                <ShoppingBag size={18} /> <span>จัดการสินค้า</span>
              </button>

              {view === 'products' && (
                <div className="nav-submenu">
                  <button
                    type="button"
                    className={`nav-subitem ${productSubView === 'MAIN' ? 'nav-subitem-active' : ''}`}
                    onClick={() => {
                      setProductSubView('MAIN');
                      setIsMobileMenuOpen(false);
                    }}
                  >
                    <ShoppingBag size={14} /> <span>รายการสินค้า</span>
                  </button>
                  <button
                    type="button"
                    className={`nav-subitem ${productSubView === 'STOCK' ? 'nav-subitem-active' : ''}`}
                    onClick={() => {
                      setProductSubView('STOCK');
                      setIsMobileMenuOpen(false);
                    }}
                  >
                    <Package size={14} /> <span>Stock สินค้า</span>
                  </button>
                </div>
              )}
            </div>
          )}
          
          {canAccessAdmin && (
            <button
              className={view === 'admin' ? 'nav-active' : ''}
              onClick={() => handleSelectView('admin')}
            >
              <ShieldCheck size={18} /> <span>จัดการระบบ</span>
            </button>
          )}
        </nav>
      </aside>

      <div className="workspace">
        <header className="topbar">
          <div className="topbar-left">
            <button
              className="hamburger-btn"
              onClick={() => setIsMobileMenuOpen(true)}
              aria-label="Open menu"
            >
              <Menu size={22} />
            </button>
            <span className="branch-tag">
              <Building2 size={15} />
              <span>{user.branch}</span>
            </span>
          </div>

          <div className="user">
            <span className="avatar">{user.staffId.slice(0, 2)}</span>
            <div className="user-details">
              <strong>{user.name || user.staffId}</strong>
              <small>{user.roles.join(' · ')}</small>
            </div>
            <button
              className="text-button logout-btn"
              onClick={onLogout}
              style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}
            >
              <LogOut size={14} />
              <span className="logout-text">ออกจากระบบ</span>
            </button>
          </div>
        </header>

        <main id="main">
          {view === 'staff' && canAccessStaff && (
            <StaffWorkspace
              user={user}
              sessions={sessions}
              onAddSession={handleAddSession}
              onUpdateSession={handleUpdateSession}
            />
          )}

          {view === 'stock' && canAccessStock && (
            <StockWorkspace
              user={user}
              sessions={sessions}
              onUpdateSession={handleUpdateSession}
            />
          )}

          {view === 'cashier' && canAccessCashier && (
            <CashierWorkspace
              user={user}
              sessions={sessions}
              onUpdateSession={handleUpdateSession}
            />
          )}

          {view === 'products' && canAccessProducts && (
            <ProductWorkspace
              user={user}
              subView={productSubView}
              onSubViewChange={setProductSubView}
            />
          )}

          {view === 'logs' && (
            <SessionLogsWorkspace user={user} sessions={sessions} />
          )}

          {view === 'admin' && canAccessAdmin && (
            <AdminHub user={account} onAccountChange={onAccountChange} />
          )}

          {/* <details className="preview-controls">
            <summary style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <Layers size={15} />
              <span>เครื่องมือทดสอบ UI states</span>
            </summary>
            <p className="fine">ไม่เปลี่ยน workflow หรือข้อมูล Session</p>
            <div className="actions">
              <Button variant="secondary" onClick={() => setNotice('loading')}>
                Loading
              </Button>
              <Button variant="secondary" onClick={() => setNotice('error')}>
                Error
              </Button>
              <Button variant="secondary" onClick={() => setNotice('')}>
                ล้างตัวอย่าง
              </Button>
            </div>
            {notice === 'loading' && (
              <Notice>
                <span className="spinner" /> กำลังโหลดข้อมูลจำลอง…
              </Notice>
            )}
            {notice === 'error' && (
              <Notice error>
                ตัวอย่าง: โหลดข้อมูลไม่สำเร็จ{' '}
                <Button variant="secondary" onClick={() => setNotice('')}>
                  ลองอีกครั้ง
                </Button>
              </Notice>
            )}
          </details> */}

        </main>
      </div>
    </div>
  );
}
