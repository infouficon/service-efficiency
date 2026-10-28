import { useCallback, useEffect, useState } from 'react';
import {
  ShieldCheck,
  Plus,
  Edit2,
  KeyRound,
  Users,
  Activity,
  Building2,
} from 'lucide-react';
import { Button, Modal, Notice, Panel } from '../../components/ui';
import { useToast } from '../../components/Toast';
import { api } from '../../services/api';
import {
  accountRoles,
  type Account,
  type ManagedBranch,
} from '../../types/accounts';
import type { Role } from '../../types/session';
import { SystemAuditLogs } from './SystemAuditLogs';
import { ErpSyncPanel } from './ErpSyncPanel';
import { WarroomSyncPanel } from './WarroomSyncPanel';
import { QrCodeSvg } from '../session/Receipt';
import { CustomerTypesPanel } from './CustomerTypesPanel';
import { StockUnlimitedPanel } from './StockUnlimitedPanel';
import { PaymentMethodsPanel } from './PaymentMethodsPanel';
import { CategoriesPanel } from './CategoriesPanel';
import { OtpPanel } from './OtpPanel';
import { ErpExtrasPanel } from './ErpExtrasPanel';
import { StaffSheetTools } from './StaffSheetTools';
/** Admin sub-views. Only ADMIN sees `branches`, `audit`, `erp`, `queue`, `payments`, `categories` and `otp`. */
export type AdminSubView =
  | 'users'
  | 'branches'
  | 'audit'
  | 'erp'
  | 'queue'
  | 'payments'
  | 'categories'
  | 'otp';
/** Roles the ERP import owns on an ERP-managed account; ADMIN/MANAGER stay hand-managed (D54). */
const erpOwnedRoles: Role[] = ['STAFF', 'STOCK', 'CASHIER'];
interface StaffDraft {
  staffId: string;
  firstName: string;
  lastName: string;
  roles: Role[];
  branchId: string;
  active: boolean;
  password: string;
  erpManaged: boolean;
  /** a new number typed for the login OTP; empty = leave the stored one alone (D85) */
  phone: string;
  /** the stored number, masked, shown as the placeholder */
  currentPhone: string | null;
  clearPhone: boolean;
}
const blankStaff = (): StaffDraft => ({
  staffId: '',
  firstName: '',
  lastName: '',
  roles: ['STAFF'],
  branchId: '',
  active: true,
  password: '',
  erpManaged: false,
  phone: '',
  currentPhone: null,
  clearPhone: false,
});
export function AdminHub({
  user,
  onAccountChange,
  subView,
  onSubViewChange,
}: {
  user: Account;
  onAccountChange: (user: Account) => void;
  subView?: AdminSubView;
  onSubViewChange?: (view: AdminSubView) => void;
}) {
  const toast = useToast();
  const admin = user.roles.includes('ADMIN');
  const [staff, setStaff] = useState<Account[]>([]);
  const erpMissingPhone = staff.filter((s) => s.erpManaged && s.active && !s.phone).length;
  const [branches, setBranches] = useState<ManagedBranch[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [internalSubTab, setInternalSubTab] = useState<AdminSubView>('users');
  const subTab = subView !== undefined ? subView : internalSubTab;
  const [error, setError] = useState('');
  const [draft, setDraft] = useState<StaffDraft | null>(null);
  const [editing, setEditing] = useState(false);
  const [branch, setBranch] = useState<ManagedBranch | null>(null);
  const [branchEditing, setBranchEditing] = useState(false);
  // F10: the address the receipt QR of a branch opens (set for ERP-managed branches too)
  const [qrBranch, setQrBranch] = useState<ManagedBranch | null>(null);
  const [qrUrl, setQrUrl] = useState('');
  // D85: the last real ERP import, to explain why ERP accounts may still have no phone (their number comes from the ERP at sync time)
  const [erpLast, setErpLast] = useState<{
    startedAt: string;
    ok: boolean | null;
    error: string | null;
  } | null | undefined>(undefined);
  useEffect(() => {
    if (!admin) return;
    let active = true;
    api<{ lastRuns: { startedAt: string; dryRun: boolean; ok: boolean | null; error: string | null }[] }>(
      '/admin/erp-sync/status',
    )
      .then((status) => {
        if (active) setErpLast(status.lastRuns.find((r) => !r.dryRun) ?? null);
      })
      .catch(() => {
        if (active) setErpLast(undefined);
      });
    return () => {
      active = false;
    };
  }, [admin]);
  const [resetId, setResetId] = useState<string | null>(null);
  const [temporary, setTemporary] = useState('');
  const load = useCallback(async () => {
    try {
      const [s, b] = await Promise.all([
        api<Account[]>('/staff'),
        api<ManagedBranch[]>('/branches'),
      ]);
      setStaff(s);
      setBranches(b);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'โหลดข้อมูลไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    let active = true;
    Promise.all([api<Account[]>('/staff'), api<ManagedBranch[]>('/branches')])
      .then(([s, b]) => {
        if (active) {
          setStaff(s);
          setBranches(b);
        }
      })
      .catch((err: unknown) => {
        if (active)
          setError(err instanceof Error ? err.message : 'โหลดข้อมูลไม่สำเร็จ');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);
  const save = async (work: () => Promise<unknown>, close: () => void) => {
    setBusy(true);
    setError('');
    try {
      await work();
      close();
      await load();
      onAccountChange(await api<Account>('/auth/me'));
      toast.success('บันทึกข้อมูลเรียบร้อย');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'บันทึกไม่สำเร็จ';
      setError(msg);
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  };
  const allowedRoles = admin
    ? accountRoles
    : accountRoles.filter((r) => ['STAFF', 'STOCK', 'CASHIER'].includes(r));
  return (
    <>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          marginBottom: '4px',
        }}
      >
        <ShieldCheck size={28} color="#0abab5" />
        <h1 style={{ margin: 0 }}>
          {subTab === 'branches'
            ? 'จัดการสาขา (Branches)'
            : subTab === 'audit'
              ? 'ประวัติการทำงานของระบบ (System Audit Logs)'
              : subTab === 'erp'
                ? 'ซิงก์ข้อมูลจาก ERP (ERP Sync)'
                : subTab === 'queue'
                  ? 'ประเภทลูกค้าและคิว (Customer Types)'
                  : subTab === 'payments'
                    ? 'ช่องทางชำระเงิน (Payment Methods)'
                    : subTab === 'categories'
                      ? 'หมวดหมู่สินค้า (Categories)'
                      : subTab === 'otp'
                        ? 'เข้าสู่ระบบด้วย OTP (SMS)'
                        : 'จัดการผู้ใช้ (Staff Members)'}
        </h1>
      </div>
      <p className="muted" style={{ marginBottom: '1.5rem' }}>
        {admin ? 'ทุกสาขา' : `สาขา ${user.branch}`}
      </p>

      {admin && subTab === 'audit' ? (
        <SystemAuditLogs />
      ) : admin && subTab === 'erp' ? (
        <>
          <StockUnlimitedPanel />
          <ErpSyncPanel />
          <ErpExtrasPanel />
          <WarroomSyncPanel />
        </>
      ) : admin && subTab === 'queue' ? (
        <CustomerTypesPanel />
      ) : admin && subTab === 'payments' ? (
        <PaymentMethodsPanel />
      ) : admin && subTab === 'categories' ? (
        <CategoriesPanel />
      ) : admin && subTab === 'otp' ? (
        <OtpPanel />
      ) : (
        <>
          {error && (
            <Notice error>
              {error}
              <Button
                variant="secondary"
                onClick={() => {
                  setError('');
                  void load();
                }}
              >
                ลองโหลดใหม่
              </Button>
            </Notice>
          )}
          {loading ? (
            <Notice>กำลังโหลด…</Notice>
          ) : (
            <>
              {subTab === 'users' && (
                <Panel title="Staff Members">
                  <div className="panel-actions-top">
                    <Button
                      onClick={() => {
                        setEditing(false);
                        setDraft({
                          ...blankStaff(),
                          branchId: admin ? '' : (user.branchId ?? ''),
                        });
                      }}
                    >
                      <span
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '6px',
                        }}
                      >
                        <Plus size={16} />
                        เพิ่ม Staff
                      </span>
                    </Button>
                    {/* D86: the whole staff list as an Excel file, and back. ADMIN only (it holds phone numbers). */}
                    {admin && <StaffSheetTools onImported={load} />}
                  </div>
                  {admin && erpMissingPhone > 0 && (
                    <Notice>
                      บัญชีที่ซิงก์จาก ERP <strong>{erpMissingPhone}</strong> บัญชียังไม่มีเบอร์ (เข้าด้วย OTP ไม่ได้)
                      เบอร์มาจากฟิลด์ <code>tel</code> ใน ERP และเข้าฐานตอนซิงก์เท่านั้น ·{' '}
                      {erpLast === undefined
                        ? 'ดูผลได้ที่เมนู ซิงก์ ERP'
                        : erpLast === null
                          ? 'ยังไม่เคยซิงก์ ERP'
                          : `ซิงก์จริงล่าสุด ${new Date(erpLast.startedAt).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })} ผล: ${erpLast.ok === null ? 'กำลังรัน' : erpLast.ok ? 'สำเร็จ' : `ล้มเหลว (${erpLast.error ?? 'ไม่ทราบสาเหตุ'})`}`}
                      {' '}· ไปที่เมนู ซิงก์ ERP แล้วกด “ซิงก์ตอนนี้”
                    </Notice>
                  )}
                  <div className="table-responsive">
                    <table className="admin-table">
                      <thead>
                        <tr>
                          <th>Staff ID</th>
                          <th>Name</th>
                          <th>Branch</th>
                          <th>เบอร์ (OTP)</th>
                          <th>Roles</th>
                          <th>Status</th>
                          <th>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {staff.map((s) => (
                          <tr key={s.staffId}>
                            <td>
                              <strong>{s.staffId}</strong>
                              {s.erpManaged && (
                                <span
                                  className="erp-badge"
                                  title="บัญชีนี้ซิงก์จาก ERP"
                                >
                                  ERP
                                </span>
                              )}
                            </td>
                            <td>
                              {s.name ||
                                [s.firstName, s.lastName]
                                  .filter(Boolean)
                                  .join(' ') ||
                                '—'}
                            </td>
                            <td>{s.branch}</td>
                            <td>
                              {s.phone ? (
                                <span className="fine">{s.phone}</span>
                              ) : (
                                <span className="status-tag status-outcome" title="ไม่มีเบอร์ จึงเข้าระบบด้วย OTP ไม่ได้">
                                  ไม่มีเบอร์
                                </span>
                              )}
                            </td>
                            <td>{s.roles.join(', ')}</td>
                            <td>
                              <span
                                className={`status-tag ${s.active ? 'status-found' : 'status-outcome'}`}
                              >
                                {s.active ? 'ใช้งาน' : 'ปิดใช้งาน'}
                              </span>
                              {s.mustChangePassword ? ' · ต้องเปลี่ยนรหัส' : ''}
                            </td>
                            <td>
                              <div style={{ display: 'flex', gap: '0.4rem' }}>
                                {/* A non-admin has nothing to edit on an ERP account: only ADMIN/MANAGER roles are hand-managed. */}
                                {(admin ||
                                  (!s.erpManaged &&
                                    !s.roles.some(
                                      (r) => r === 'ADMIN' || r === 'MANAGER',
                                    ))) && (
                                  <Button
                                    variant="secondary"
                                    size="sm"
                                    onClick={() => {
                                      setEditing(true);
                                      setDraft({
                                        staffId: s.staffId,
                                        firstName: s.firstName ?? '',
                                        lastName: s.lastName ?? '',
                                        roles: [...s.roles],
                                        branchId: s.branchId ?? '',
                                        active: s.active,
                                        password: '',
                                        erpManaged: Boolean(s.erpManaged),
                                        phone: '',
                                        currentPhone: s.phone ?? null,
                                        clearPhone: false,
                                      });
                                    }}
                                  >
                                    <span
                                      style={{
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        gap: '4px',
                                      }}
                                    >
                                      <Edit2 size={13} />
                                      แก้ไข
                                    </span>
                                  </Button>
                                )}
                                {/* The ERP owns the password of an ERP account; the server refuses a reset. */}
                                {admin && !s.erpManaged && (
                                  <Button
                                    variant="secondary"
                                    size="sm"
                                    onClick={() => {
                                      setResetId(s.staffId);
                                      setTemporary('');
                                    }}
                                  >
                                    <span
                                      style={{
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        gap: '4px',
                                      }}
                                    >
                                      <KeyRound size={13} />
                                      Reset
                                    </span>
                                  </Button>
                                )}
                                {s.erpManaged && (
                                  <span
                                    className="fine"
                                    style={{ alignSelf: 'center' }}
                                  >
                                    {admin
                                      ? 'รหัสผ่านใช้ร่วมกับ ERP'
                                      : 'จัดการที่ ERP'}
                                  </span>
                                )}
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {!staff.length && <p>ยังไม่มี Staff</p>}
                </Panel>
              )}
              {subTab === 'branches' && admin && (
                <Panel title="Branches">
                  <div className="panel-actions-top">
                    <Button
                      onClick={() => {
                        setBranchEditing(false);
                        setBranch({
                          id: '',
                          code: '',
                          name: '',
                          phone: '',
                          active: true,
                        });
                      }}
                    >
                      <span
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '6px',
                        }}
                      >
                        <Plus size={16} />
                        เพิ่ม Branch
                      </span>
                    </Button>
                  </div>
                  <div className="table-responsive">
                    <table className="admin-table">
                      <thead>
                        <tr>
                          <th>Code</th>
                          <th>Name</th>
                          <th>Phone</th>
                          <th>QR ลงทะเบียน</th>
                          <th>Status</th>
                          <th>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {branches.map((b) => (
                          <tr key={b.id}>
                            <td>
                              <strong>{b.code}</strong>
                            </td>
                            <td>{b.name}</td>
                            <td>{b.phone || '—'}</td>
                            <td>
                              <Button
                                variant="secondary"
                                size="sm"
                                onClick={() => {
                                  setQrBranch(b);
                                  setQrUrl(b.registrationUrl ?? '');
                                }}
                              >
                                {b.registrationUrl ? 'ตั้งค่าแล้ว · แก้ไข' : 'ตั้งค่า QR'}
                              </Button>
                            </td>
                            <td>
                              <span
                                className={`status-tag ${b.active ? 'status-found' : 'status-outcome'}`}
                              >
                                {b.active ? 'ใช้งาน' : 'ปิดใช้งาน'}
                              </span>
                            </td>
                            <td>
                              <Button
                                variant="secondary"
                                size="sm"
                                onClick={() => {
                                  setBranchEditing(true);
                                  setBranch({ ...b });
                                }}
                              >
                                <span
                                  style={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '4px',
                                  }}
                                >
                                  <Edit2 size={13} />
                                  แก้ไข
                                </span>
                              </Button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {!branches.length && (
                    <p>
                      ยังไม่มี Branch — เพิ่ม Branch ก่อนสร้างบัญชีปฏิบัติงาน
                    </p>
                  )}
                </Panel>
              )}
            </>
          )}
        </>
      )}
      {draft && (
        <Modal
          title={editing ? `แก้ไข Staff: ${draft.staffId}` : 'เพิ่ม Staff'}
          isOpen={Boolean(draft)}
          onClose={() => setDraft(null)}
        >
          <form
            className={draft.erpManaged ? 'erp-managed-form' : undefined}
            onSubmit={(e) => {
              e.preventDefault();
              const body = {
                firstName: draft.firstName,
                lastName: draft.lastName,
                roles: draft.roles,
                branchId: draft.roles.every((r) => r === 'ADMIN')
                  ? null
                  : draft.branchId,
                active: draft.active,
                // D85: omit = unchanged, a number = set, null = clear; an ERP account's number is the ERP's
                ...(!draft.erpManaged && draft.phone.trim()
                  ? { phone: draft.phone.trim() }
                  : !draft.erpManaged && draft.clearPhone
                    ? { phone: null }
                    : {}),
                ...(!editing
                  ? { staffId: draft.staffId, password: draft.password }
                  : {}),
              };
              void save(
                () =>
                  api(
                    editing
                      ? `/staff/${encodeURIComponent(draft.staffId)}`
                      : '/staff',
                    editing ? 'PUT' : 'POST',
                    body,
                  ),
                () => setDraft(null),
              );
            }}
          >
            {draft.erpManaged && (
              <Notice>
                ข้อมูลชุดนี้มาจาก ERP และจะถูกซิงก์ทุกวัน 10:00 แก้ที่ ERP
              </Notice>
            )}
            <label>
              Staff ID (รหัสพนักงาน)
              <input
                required
                disabled={editing}
                value={draft.staffId}
                onChange={(e) =>
                  setDraft({ ...draft, staffId: e.target.value })
                }
              />
            </label>
            <div className="form-grid-2col">
              <label>
                ชื่อจริง (First Name)
                <input
                  placeholder="เช่น สมชาย"
                  disabled={draft.erpManaged}
                  value={draft.firstName}
                  onChange={(e) =>
                    setDraft({ ...draft, firstName: e.target.value })
                  }
                />
              </label>
              <label>
                นามสกุล (Last Name)
                <input
                  placeholder="เช่น ใจดี"
                  disabled={draft.erpManaged}
                  value={draft.lastName}
                  onChange={(e) =>
                    setDraft({ ...draft, lastName: e.target.value })
                  }
                />
              </label>
            </div>
            <label>
              เบอร์มือถือสำหรับรับรหัส OTP
              <input
                inputMode="tel"
                maxLength={10}
                pattern="0[689][0-9]{8}"
                title="เบอร์มือถือ 10 หลัก เช่น 0812345678"
                disabled={draft.erpManaged || draft.clearPhone}
                placeholder={
                  draft.erpManaged
                    ? `${draft.currentPhone ?? 'ไม่มีเบอร์ใน ERP'} (มาจาก ERP ฟิลด์ tel)`
                    : draft.currentPhone
                      ? `ตอนนี้ ${draft.currentPhone} · เว้นว่าง = ไม่เปลี่ยน`
                      : 'เช่น 0812345678'
                }
                value={draft.phone}
                onChange={(e) =>
                  setDraft({ ...draft, phone: e.target.value.replace(/\D/g, '') })
                }
              />
            </label>
            {!draft.erpManaged && draft.currentPhone && (
              <label className="warroom-force">
                <input
                  type="checkbox"
                  checked={draft.clearPhone}
                  onChange={(e) =>
                    setDraft({ ...draft, clearPhone: e.target.checked, phone: '' })
                  }
                />
                <span>ลบเบอร์นี้ออก</span>
              </label>
            )}
            {!editing && (
              <label>
                รหัสผ่านชั่วคราว
                <input
                  type="password"
                  minLength={8}
                  maxLength={128}
                  required
                  autoComplete="new-password"
                  value={draft.password}
                  onChange={(e) =>
                    setDraft({ ...draft, password: e.target.value })
                  }
                />
              </label>
            )}
            <fieldset>
              <legend>Roles</legend>
              {allowedRoles.map((role) => {
                // The ERP import owns STAFF/STOCK/CASHIER on its accounts; ADMIN/MANAGER stay hand-managed.
                const locked = draft.erpManaged && erpOwnedRoles.includes(role);
                return (
                  <label
                    className={`choice ${locked ? 'locked' : ''}`.trim()}
                    key={role}
                  >
                    <input
                      type="checkbox"
                      disabled={locked}
                      checked={draft.roles.includes(role)}
                      onChange={() =>
                        setDraft({
                          ...draft,
                          roles: draft.roles.includes(role)
                            ? draft.roles.filter((r) => r !== role)
                            : [...draft.roles, role],
                        })
                      }
                    />
                    {role}
                  </label>
                );
              })}
            </fieldset>
            {draft.roles.some((r) => r !== 'ADMIN') && (
              <label>
                Branch
                <select
                  required
                  disabled={!admin || draft.erpManaged}
                  value={draft.branchId}
                  onChange={(e) =>
                    setDraft({ ...draft, branchId: e.target.value })
                  }
                >
                  <option value="">เลือก Branch</option>
                  {branches.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                      {b.active ? '' : ' (ปิดใช้งาน)'}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label>
              <input
                type="checkbox"
                disabled={draft.erpManaged}
                checked={draft.active}
                onChange={(e) =>
                  setDraft({ ...draft, active: e.target.checked })
                }
              />{' '}
              ใช้งานบัญชี
            </label>
            {!draft.erpManaged && (
              <p className="fine">ปิดบัญชีจะออกจากระบบทุกอุปกรณ์</p>
            )}
            <div className="actions">
              <Button type="submit" disabled={busy || !draft.roles.length}>
                บันทึก
              </Button>
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() => setDraft(null)}
              >
                ยกเลิก
              </Button>
            </div>
          </form>
        </Modal>
      )}
      {branch && (
        <Modal
          title={
            branchEditing ? `แก้ไข Branch: ${branch.code}` : 'เพิ่ม Branch'
          }
          isOpen={Boolean(branch)}
          onClose={() => setBranch(null)}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void save(
                () =>
                  api(
                    branchEditing
                      ? `/branches/${encodeURIComponent(branch.id)}`
                      : '/branches',
                    branchEditing ? 'PUT' : 'POST',
                    {
                      code: branch.code,
                      name: branch.name,
                      phone: branch.phone,
                      active: branch.active,
                    },
                  ),
                () => setBranch(null),
              );
            }}
          >
            <label>
              Branch Code
              <input
                required
                value={branch.code}
                onChange={(e) => setBranch({ ...branch, code: e.target.value })}
              />
            </label>
            <label>
              Branch Name
              <input
                required
                value={branch.name}
                onChange={(e) => setBranch({ ...branch, name: e.target.value })}
              />
            </label>
            <label>
              Phone
              <input
                value={branch.phone}
                onChange={(e) =>
                  setBranch({ ...branch, phone: e.target.value })
                }
              />
            </label>
            <label>
              <input
                type="checkbox"
                checked={branch.active}
                onChange={(e) =>
                  setBranch({ ...branch, active: e.target.checked })
                }
              />{' '}
              ใช้งาน Branch
            </label>
            <div className="actions">
              <Button type="submit" disabled={busy}>
                บันทึก Branch
              </Button>
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() => setBranch(null)}
              >
                ยกเลิก
              </Button>
            </div>
          </form>
        </Modal>
      )}
      {qrBranch && (
        <Modal
          title={`QR ลงทะเบียนบนใบเสร็จ: ${qrBranch.code}`}
          isOpen
          onClose={() => setQrBranch(null)}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void save(
                () =>
                  api(
                    `/branches/${encodeURIComponent(qrBranch.id)}/registration-url`,
                    'PUT',
                    { url: qrUrl.trim() || null },
                  ),
                () => setQrBranch(null),
              );
            }}
          >
            <Notice>
              ใบเสร็จของสาขานี้จะพิมพ์ QR ที่เปิดที่อยู่ด้านล่าง (ใส่ที่อยู่หน้าลงทะเบียนของสาขา เช่น
              .../register?branch={qrBranch.code}) ปล่อยว่างเพื่อไม่พิมพ์ QR ตั้งค่าได้แม้สาขาซิงก์จาก ERP
            </Notice>
            <label>
              ที่อยู่หน้าลงทะเบียน (URL)
              <input
                type="url"
                maxLength={512}
                placeholder="https://..."
                value={qrUrl}
                onChange={(e) => setQrUrl(e.target.value)}
              />
            </label>
            {qrUrl.trim() && (
              <div style={{ margin: '12px 0' }}>
                <QrCodeSvg text={qrUrl.trim()} size={160} />
              </div>
            )}
            <div className="actions">
              <Button type="submit" disabled={busy}>
                บันทึก
              </Button>
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() => setQrBranch(null)}
              >
                ยกเลิก
              </Button>
            </div>
          </form>
        </Modal>
      )}
      {resetId && (
        <Modal
          title={`Reset password: ${resetId}`}
          isOpen={Boolean(resetId)}
          onClose={() => {
            setResetId(null);
            setTemporary('');
          }}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void save(
                () =>
                  api(
                    `/staff/${encodeURIComponent(resetId)}/reset-password`,
                    'POST',
                    { password: temporary },
                  ),
                () => {
                  setResetId(null);
                  setTemporary('');
                },
              );
            }}
          >
            <Notice>
              บัญชีนี้จะออกจากทุกอุปกรณ์ และต้องเปลี่ยนรหัสครั้งถัดไป
            </Notice>
            <label>
              รหัสผ่านชั่วคราวใหม่
              <input
                type="password"
                minLength={8}
                maxLength={128}
                required
                autoComplete="new-password"
                value={temporary}
                onChange={(e) => setTemporary(e.target.value)}
              />
            </label>
            <div className="actions">
              <Button type="submit" disabled={busy}>
                ยืนยัน Reset
              </Button>
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() => {
                  setResetId(null);
                  setTemporary('');
                }}
              >
                ยกเลิก
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
