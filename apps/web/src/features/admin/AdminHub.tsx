import { useCallback, useEffect, useState } from 'react';
import { ShieldCheck, Plus, Edit2, KeyRound } from 'lucide-react';
import { Button, Modal, Notice, Panel } from '../../components/ui';
import { useToast } from '../../components/Toast';
import { api } from '../../services/api';
import {
  accountRoles,
  type Account,
  type ManagedBranch,
} from '../../types/accounts';
import type { Role } from '../../types/session';
interface StaffDraft {
  staffId: string;
  firstName: string;
  lastName: string;
  roles: Role[];
  branchId: string;
  active: boolean;
  password: string;
}
const blankStaff = (): StaffDraft => ({
  staffId: '',
  firstName: '',
  lastName: '',
  roles: ['STAFF'],
  branchId: '',
  active: true,
  password: '',
});
export function AdminHub({
  user,
  onAccountChange,
}: {
  user: Account;
  onAccountChange: (user: Account) => void;
}) {
  const toast = useToast();
  const admin = user.roles.includes('ADMIN');
  const [staff, setStaff] = useState<Account[]>([]);
  const [branches, setBranches] = useState<ManagedBranch[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [draft, setDraft] = useState<StaffDraft | null>(null);
  const [editing, setEditing] = useState(false);
  const [branch, setBranch] = useState<ManagedBranch | null>(null);
  const [branchEditing, setBranchEditing] = useState(false);
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
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
        <ShieldCheck size={28} color="#0abab5" />
        <h1 style={{ margin: 0 }}>จัดการ Staff / Role / Branch</h1>
      </div>
      <p className="muted" style={{ marginBottom: '1.5rem' }}>
        {admin ? 'ทุกสาขา' : `สาขา ${user.branch}`}
      </p>
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
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                  <Plus size={16} />
                  เพิ่ม Staff
                </span>
              </Button>
            </div>
            <div className="table-responsive">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Staff ID</th>
                    <th>ชื่อ - นามสกุล</th>
                    <th>Branch</th>
                    <th>Roles</th>
                    <th>สถานะ</th>
                    <th>จัดการ</th>
                  </tr>
                </thead>
                <tbody>
                  {staff.map((s) => (
                    <tr key={s.staffId}>
                      <td><strong>{s.staffId}</strong></td>
                      <td>{s.name || [s.firstName, s.lastName].filter(Boolean).join(' ') || '—'}</td>
                      <td>{s.branch}</td>
                      <td>{s.roles.join(', ')}</td>
                      <td>
                        <span className={`status-tag ${s.active ? 'status-found' : 'status-outcome'}`}>
                          {s.active ? 'ใช้งาน' : 'ปิดใช้งาน'}
                        </span>
                        {s.mustChangePassword ? ' · ต้องเปลี่ยนรหัส' : ''}
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: '0.4rem' }}>
                          {(admin ||
                            !s.roles.some(
                              (r) => r === 'ADMIN' || r === 'MANAGER',
                            )) && (
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
                                });
                              }}
                            >
                              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                                <Edit2 size={13} />
                                แก้ไข
                              </span>
                            </Button>
                          )}
                          {admin && (
                            <Button
                              variant="secondary"
                              size="sm"
                              onClick={() => {
                                setResetId(s.staffId);
                                setTemporary('');
                              }}
                            >
                              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                                <KeyRound size={13} />
                                Reset
                              </span>
                            </Button>
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
          <Panel title="Branches">
            {admin && (
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
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                    <Plus size={16} />
                    เพิ่ม Branch
                  </span>
                </Button>
              </div>
            )}
            <div className="table-responsive">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Code</th>
                    <th>Name</th>
                    <th>Phone</th>
                    <th>สถานะ</th>
                    <th>จัดการ</th>
                  </tr>
                </thead>
                <tbody>
                  {branches.map((b) => (
                    <tr key={b.id}>
                      <td><strong>{b.code}</strong></td>
                      <td>{b.name}</td>
                      <td>{b.phone || '—'}</td>
                      <td>
                        <span className={`status-tag ${b.active ? 'status-found' : 'status-outcome'}`}>
                          {b.active ? 'ใช้งาน' : 'ปิดใช้งาน'}
                        </span>
                      </td>
                      <td>
                        {admin && (
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => {
                              setBranchEditing(true);
                              setBranch({ ...b });
                            }}
                          >
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                              <Edit2 size={13} />
                              แก้ไข
                            </span>
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!branches.length && (
              <p>ยังไม่มี Branch — เพิ่ม Branch ก่อนสร้างบัญชีปฏิบัติงาน</p>
            )}
          </Panel>
        </>
      )}
      {draft && (
        <Modal
          title={editing ? `แก้ไข Staff: ${draft.staffId}` : 'เพิ่ม Staff'}
          isOpen={Boolean(draft)}
          onClose={() => setDraft(null)}
        >
          <form
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
                  value={draft.lastName}
                  onChange={(e) =>
                    setDraft({ ...draft, lastName: e.target.value })
                  }
                />
              </label>
            </div>
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
              {allowedRoles.map((role) => (
                <label className="choice" key={role}>
                  <input
                    type="checkbox"
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
              ))}
            </fieldset>
            {draft.roles.some((r) => r !== 'ADMIN') && (
              <label>
                Branch
                <select
                  required
                  disabled={!admin}
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
                checked={draft.active}
                onChange={(e) =>
                  setDraft({ ...draft, active: e.target.checked })
                }
              />{' '}
              ใช้งานบัญชี
            </label>
            <p className="fine">ปิดบัญชีจะออกจากระบบทุกอุปกรณ์</p>
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
          title={branchEditing ? `แก้ไข Branch: ${branch.code}` : 'เพิ่ม Branch'}
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
