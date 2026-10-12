import { useEffect, useRef, useState, useMemo } from 'react';
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
  AlertTriangle,
  Users,
  Activity,
  RefreshCw,
  Ticket,
} from 'lucide-react';
import { Button, Notice } from '../components/ui';
import type { AppView, MockSession, MockUser } from '../types/session';
import type { Account } from '../types/accounts';
import { StaffWorkspace } from '../features/session/StaffWorkspace';
import { StockWorkspace } from '../features/stock/StockWorkspace';
import { CashierWorkspace } from '../features/cashier/CashierWorkspace';
import { ProductWorkspace } from '../features/products/ProductWorkspace';
import { SessionLogsWorkspace } from '../features/logs/SessionLogsWorkspace';
import { AdminHub, type AdminSubView } from '../features/admin/AdminHub';
import {
  fetchSessionsApi,
  acknowledgeManagerAlertApi,
} from '../services/sessionApi';
import {
  isToday,
  getSessionMissingDescription,
  goodsToReturn,
  needsStockAck,
} from '../features/session/workflow';
import { playAlertBeep } from '../utils/beep';

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
  const [productSubView, setProductSubView] = useState<'MAIN' | 'STOCK'>(
    'MAIN',
  );
  const [adminSubView, setAdminSubView] = useState<AdminSubView>('users');
  const [sessions, setSessions] = useState<MockSession[]>([]);
  const [view, setView] = useState<AppView>(() => getInitialView(user));
  const [notice, setNotice] = useState('');
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [dismissedAlertRefs, setDismissedAlertRefs] = useState<string[]>([]);

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
        const branchFilter = user.roles.includes('ADMIN')
          ? undefined
          : user.branchCode;
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
                  (local.selection.items.length > 0 ||
                    Object.keys(local.selection.accessories).length > 0)
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

  const isManagerOrAdmin =
    user.roles.includes('MANAGER') || user.roles.includes('ADMIN');
  const managerAlertSessions = useMemo(() => {
    if (!isManagerOrAdmin) return [];
    return branchSessions.filter(
      (s) =>
        !dismissedAlertRefs.includes(s.reference) &&
        !s.stockPendingReview?.acknowledgedAt &&
        (Boolean(s.stockPendingReview) ||
          (s.outcome === 'OUT_OF_STOCK' &&
            isToday(s.timestamps.customer_walk_in_at))),
    );
  }, [isManagerOrAdmin, branchSessions, dismissedAlertRefs]);

  // F12: cancels after the stock request that stock has not acknowledged yet, on every page for stock users, with a beep
  // when a new one arrives. The notice itself is stored on the server, so every device shows it until stock acknowledges.
  const stockNotices = useMemo(
    () => (canAccessStock ? branchSessions.filter(needsStockAck) : []),
    [canAccessStock, branchSessions],
  );
  const seenStockNotices = useRef(0);
  useEffect(() => {
    if (stockNotices.length > seenStockNotices.current) playAlertBeep();
    seenStockNotices.current = stockNotices.length;
  }, [stockNotices.length]);

  const handleDismissAlerts = () => {
    const targets = [...managerAlertSessions];
    const currentRefs = targets.map((s) => s.reference);
    setDismissedAlertRefs((prev) =>
      Array.from(new Set([...prev, ...currentRefs])),
    );

    for (const s of targets) {
      if (s.id) {
        acknowledgeManagerAlertApi(s.id)
          .then((updated) => {
            handleUpdateSession(updated);
          })
          .catch(() => {
            // Keep dismissed in local state
          });
      }
    }
  };

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
            <div>
              <button
                className={view === 'admin' ? 'nav-active' : ''}
                onClick={() => handleSelectView('admin')}
              >
                <ShieldCheck size={18} /> <span>จัดการระบบ</span>
              </button>

              {view === 'admin' && (
                <div className="nav-submenu">
                  <button
                    type="button"
                    className={`nav-subitem ${adminSubView === 'users' ? 'nav-subitem-active' : ''}`}
                    onClick={() => {
                      setAdminSubView('users');
                      setIsMobileMenuOpen(false);
                    }}
                  >
                    <Users size={14} /> <span>จัดการผู้ใช้</span>
                  </button>

                  {user.roles.includes('ADMIN') && (
                    <>
                      <button
                        type="button"
                        className={`nav-subitem ${adminSubView === 'branches' ? 'nav-subitem-active' : ''}`}
                        onClick={() => {
                          setAdminSubView('branches');
                          setIsMobileMenuOpen(false);
                        }}
                      >
                        <Building2 size={14} /> <span>จัดการสาขา</span>
                      </button>

                      <button
                        type="button"
                        className={`nav-subitem ${adminSubView === 'audit' ? 'nav-subitem-active' : ''}`}
                        onClick={() => {
                          setAdminSubView('audit');
                          setIsMobileMenuOpen(false);
                        }}
                      >
                        <Activity size={14} /> <span>ประวัติ</span>
                      </button>

                      <button
                        type="button"
                        className={`nav-subitem ${adminSubView === 'erp' ? 'nav-subitem-active' : ''}`}
                        onClick={() => {
                          setAdminSubView('erp');
                          setIsMobileMenuOpen(false);
                        }}
                      >
                        <RefreshCw size={14} /> <span>ซิงก์ ERP</span>
                      </button>

                      <button
                        type="button"
                        className={`nav-subitem ${adminSubView === 'queue' ? 'nav-subitem-active' : ''}`}
                        onClick={() => {
                          setAdminSubView('queue');
                          setIsMobileMenuOpen(false);
                        }}
                      >
                        <Ticket size={14} /> <span>ประเภทลูกค้า / คิว</span>
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
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
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px',
              }}
            >
              <LogOut size={14} />
              <span className="logout-text">ออกจากระบบ</span>
            </button>
          </div>
        </header>

        {isManagerOrAdmin && managerAlertSessions.length > 0 && (
          <div
            className="manager-alert-banner"
            style={{
              background: '#fef2f2',
              borderBottom: '1px solid #fecaca',
              padding: '10px 16px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '12px',
              flexWrap: 'wrap',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: '8px',
                color: '#991b1b',
                fontSize: '13px',
                flex: '1 1 auto',
                minWidth: '280px',
              }}
            >
              <AlertTriangle
                size={18}
                color="#dc2626"
                style={{ marginTop: '2px', flexShrink: 0 }}
              />
              <div
                style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}
              >
                <div>
                  <strong>แจ้งเตือน :</strong> มี{' '}
                  <strong>{managerAlertSessions.length}</strong>{' '}
                  รายการที่คลังรายงานสินค้าไม่พบ / สินค้าหมดสต็อก
                  เพื่อตรวจสอบสินค้าสูญหายหรือวางผิดที่:
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                  {managerAlertSessions.map((s) => {
                    const missingText = getSessionMissingDescription(s);
                    const note = s.stockPendingReview?.stockNote;
                    return (
                      <span
                        key={s.reference}
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '6px',
                          background: '#fee2e2',
                          border: '1px solid #fca5a5',
                          borderRadius: '6px',
                          padding: '3px 8px',
                          fontSize: '12px',
                          color: '#7f1d1d',
                          lineHeight: 1.4,
                        }}
                      >
                        <strong>คิว {s.queue}:</strong>
                        <span>{missingText}</span>
                        {note && (
                          <span
                            style={{
                              color: '#991b1b',
                              fontStyle: 'italic',
                              fontSize: '11px',
                            }}
                          >
                            ({note})
                          </span>
                        )}
                      </span>
                    );
                  })}
                </div>
              </div>
            </div>
            <div
              style={{
                display: 'flex',
                gap: '8px',
                alignItems: 'center',
                flexShrink: 0,
              }}
            >
              <button
                type="button"
                className="text-button"
                style={{
                  background: '#fee2e2',
                  color: '#991b1b',
                  padding: '4px 10px',
                  borderRadius: '6px',
                  fontSize: '12px',
                  fontWeight: 600,
                  border: '1px solid #fca5a5',
                  cursor: 'pointer',
                }}
                onClick={() => handleSelectView('products')}
              >
                ตรวจสอบ Stock สินค้า →
              </button>
              <button
                type="button"
                className="text-button"
                style={{
                  background: '#ffffff',
                  color: '#991b1b',
                  padding: '4px 10px',
                  borderRadius: '6px',
                  fontSize: '12px',
                  fontWeight: 600,
                  border: '1px solid #fca5a5',
                  cursor: 'pointer',
                }}
                onClick={() => handleSelectView('logs')}
              >
                ดูประวัติรายการ →
              </button>
              <button
                type="button"
                className="text-button"
                style={{
                  background: 'transparent',
                  color: '#991b1b',
                  padding: '4px',
                  borderRadius: '4px',
                  border: 'none',
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
                onClick={handleDismissAlerts}
                title="ปิดการแจ้งเตือนนี้"
                aria-label="Close manager notification"
              >
                <X size={18} />
              </button>
            </div>
          </div>
        )}

        {stockNotices.length > 0 && view !== 'stock' && (
          <div className="stock-cancel-banner" role="alert">
            <span>
              <AlertTriangle size={18} />{' '}
              <strong>มี {stockNotices.length} คิวที่ถูกยกเลิก — Stock ต้องดำเนินการ:</strong>{' '}
              {stockNotices
                .slice(0, 6)
                .map((s) => `คิว ${s.queue}${goodsToReturn(s) ? ' (คืนสินค้าเข้าชั้น)' : ' (หยุดค้นหา)'}`)
                .join(', ')}
              {stockNotices.length > 6 ? ' …' : ''}
            </span>
            <Button size="sm" onClick={() => handleSelectView('stock')}>
              ไปที่คลังสินค้า →
            </Button>
          </div>
        )}

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
            <AdminHub
              user={account}
              onAccountChange={onAccountChange}
              subView={adminSubView}
              onSubViewChange={setAdminSubView}
            />
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
