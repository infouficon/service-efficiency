import { useCallback, useEffect, useState } from 'react';
import { Plus, Search, Trash2 } from 'lucide-react';
import { Button, Notice, Panel } from '../../components/ui';
import { useToast } from '../../components/Toast';
import { api } from '../../services/api';
import type { ManagedBranch } from '../../types/accounts';

type ExtraRole = 'STAFF' | 'STOCK' | 'CASHIER';
const ROLES: ExtraRole[] = ['STAFF', 'STOCK', 'CASHIER'];

interface ErpCandidate {
  erpStaffId: number;
  name: string;
  branchGroup: string;
  position: string;
  duplicate: boolean;
}
interface ErpExtra {
  erpStaffId: number;
  roles: string[];
  branch: string;
  branchActive: boolean;
  note: string | null;
  createdBy: string;
  account: { staffId: string; name: string; active: boolean; hasPhone: boolean } | null;
}

/**
 * Extra people for the ERP import (D87): the daily import only brings in staff of the iStudio / U-Store branches whose position
 * has a role. Here an ADMIN looks a person up in the ERP (a dev, a head-office colleague), gives them roles and an SES branch, and
 * the next import creates the account like any ERP account (name, phone and active flag from the ERP). ADMIN / MANAGER are set by
 * hand on the staff page afterwards (ADMIN cannot follow the ERP).
 */
export function ErpExtrasPanel() {
  const toast = useToast();
  const [extras, setExtras] = useState<ErpExtra[] | null>(null);
  const [branches, setBranches] = useState<ManagedBranch[]>([]);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<ErpCandidate[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [picked, setPicked] = useState<ErpCandidate | null>(null);
  const [roles, setRoles] = useState<ExtraRole[]>(['STAFF']);
  const [branchId, setBranchId] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setExtras(await api<ErpExtra[]>('/admin/erp-sync/extras'));
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'โหลดข้อมูลไม่สำเร็จ');
    }
  }, []);
  useEffect(() => {
    let active = true;
    Promise.all([api<ErpExtra[]>('/admin/erp-sync/extras'), api<ManagedBranch[]>('/branches')])
      .then(([list, b]) => {
        if (!active) return;
        setExtras(list);
        setBranches(b.filter((x) => x.active));
      })
      .catch((err: unknown) => {
        if (active) setError(err instanceof Error ? err.message : 'โหลดข้อมูลไม่สำเร็จ');
      });
    return () => {
      active = false;
    };
  }, []);

  const search = async () => {
    setSearching(true);
    setPicked(null);
    try {
      setResults(await api<ErpCandidate[]>(`/admin/erp-sync/staff-search?q=${encodeURIComponent(query.trim())}`));
      setError('');
    } catch (err) {
      setResults(null);
      setError(err instanceof Error ? err.message : 'ค้นหาไม่สำเร็จ');
    } finally {
      setSearching(false);
    }
  };

  const add = async () => {
    if (!picked) return;
    setBusy(true);
    try {
      await api('/admin/erp-sync/extras', 'PUT', {
        erpStaffId: picked.erpStaffId,
        roles,
        branchId,
        ...(note.trim() ? { note: note.trim() } : {}),
      });
      toast.success('เพิ่มแล้ว บัญชีจะถูกสร้างในการซิงก์ ERP รอบถัดไป (กด "ซิงก์ตอนนี้" ด้านบน หรือรอ 10:00)', 7000);
      setPicked(null);
      setResults(null);
      setQuery('');
      setNote('');
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'เพิ่มไม่สำเร็จ', 6000);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (extra: ErpExtra) => {
    setBusy(true);
    try {
      await api(`/admin/erp-sync/extras/${extra.erpStaffId}`, 'DELETE');
      toast.success('เอาออกแล้ว บัญชีจะถูกปิดใช้งานในการซิงก์ ERP รอบถัดไป (ไม่ลบข้อมูล)', 7000);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'เอาออกไม่สำเร็จ', 6000);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel title="เพิ่มพนักงานจาก ERP เป็นรายคน (นอกขอบเขตปกติ)">
      <p className="muted" style={{ marginTop: 0 }}>
        ปกติระบบซิงก์เฉพาะพนักงานสาขา iStudio / U-Store ที่ตำแหน่งกำหนดสิทธิ์ได้ เลือกคนอื่น เช่น ทีม dev หรือพนักงานสำนักงานใหญ่
        ได้ที่นี่: ค้นหาใน ERP ด้วยชื่อหรือ Staff ID กำหนดบทบาทและสาขาใน SES แล้วระบบจะสร้างบัญชีให้ตอนซิงก์รอบถัดไป
        (ชื่อ เบอร์ OTP และสถานะมาจาก ERP เหมือนบัญชี ERP ทั่วไป) ต้องการสิทธิ์ ADMIN หรือ MANAGER ให้ตั้งเองที่หน้า
        จัดการผู้ใช้ หลังบัญชีถูกสร้าง (ADMIN ซิงก์ตาม ERP ไม่ได้ เพราะ HR แก้เบอร์ใน ERP แล้วเข้าบัญชีแอดมินได้)
      </p>
      {error && <Notice error>{error}</Notice>}
      <form
        className="payment-add-form"
        onSubmit={(e) => {
          e.preventDefault();
          void search();
        }}
      >
        <input
          required
          minLength={2}
          maxLength={60}
          placeholder="ค้นหาใน ERP: ชื่อ หรือ Staff ID (อย่างน้อย 2 ตัวอักษร)"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <Button type="submit" disabled={searching || query.trim().length < 2}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
            <Search size={16} />
            {searching ? 'กำลังค้นหา…' : 'ค้นหา'}
          </span>
        </Button>
      </form>
      {results && (
        <>
          {results.length === 0 ? (
            <p className="fine">
              ไม่พบ (แสดงเฉพาะคนที่ยัง active ใน ERP และยังไม่ได้เป็นบัญชีใน SES หรืออยู่ในรายการนี้แล้ว)
            </p>
          ) : (
            <div className="table-responsive">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Staff ID</th>
                    <th>ชื่อ</th>
                    <th>กลุ่มสาขา</th>
                    <th>ตำแหน่ง</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {results.map((r) => (
                    <tr key={r.erpStaffId} className={picked?.erpStaffId === r.erpStaffId ? 'erp-run-selected' : undefined}>
                      <td>
                        <strong>{r.erpStaffId}</strong>
                      </td>
                      <td>{r.name || '—'}</td>
                      <td>{r.branchGroup || '—'}</td>
                      <td>{r.position || '—'}</td>
                      <td>
                        {r.duplicate ? (
                          <span className="fine">staff_id ซ้ำใน ERP เลือกไม่ได้</span>
                        ) : (
                          <Button variant="secondary" size="sm" onClick={() => setPicked(r)}>
                            เลือก
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
      {picked && (
        <div className="warroom-unmapped" style={{ marginTop: '12px' }}>
          <strong>
            {picked.erpStaffId} · {picked.name}
          </strong>
          <fieldset style={{ border: 0, padding: 0, margin: '8px 0' }}>
            <legend className="fine">บทบาทใน SES</legend>
            {ROLES.map((role) => (
              <label key={role} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', marginRight: '14px' }}>
                <input
                  type="checkbox"
                  checked={roles.includes(role)}
                  onChange={(e) =>
                    setRoles((cur) => (e.target.checked ? [...cur, role] : cur.filter((r) => r !== role)))
                  }
                />
                {role}
              </label>
            ))}
          </fieldset>
          <label style={{ display: 'block', margin: '8px 0' }}>
            สาขาใน SES
            <select required value={branchId} onChange={(e) => setBranchId(e.target.value)}>
              <option value="">-- เลือกสาขา --</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name} ({b.code})
                </option>
              ))}
            </select>
          </label>
          <label style={{ display: 'block', margin: '8px 0' }}>
            หมายเหตุ (ไม่บังคับ)
            <input maxLength={191} value={note} placeholder="เช่น dev ทดสอบระบบ" onChange={(e) => setNote(e.target.value)} />
          </label>
          <Button disabled={busy || !roles.length || !branchId} onClick={() => void add()}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
              <Plus size={16} />
              เพิ่มเข้ารายการ
            </span>
          </Button>
        </div>
      )}
      <h4 style={{ margin: '16px 0 6px' }}>รายการที่เลือกไว้</h4>
      {extras === null ? (
        <Notice>กำลังโหลด…</Notice>
      ) : extras.length === 0 ? (
        <p className="fine">ยังไม่มี</p>
      ) : (
        <div className="table-responsive">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Staff ID</th>
                <th>บทบาท</th>
                <th>สาขาใน SES</th>
                <th>บัญชีใน SES</th>
                <th>หมายเหตุ</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {extras.map((x) => (
                <tr key={x.erpStaffId}>
                  <td>
                    <strong>{x.erpStaffId}</strong>
                  </td>
                  <td>{x.roles.join(', ')}</td>
                  <td>
                    {x.branch}
                    {!x.branchActive && <span className="status-tag status-outcome"> ปิดอยู่</span>}
                  </td>
                  <td>
                    {x.account ? (
                      <>
                        {x.account.name || x.account.staffId}{' '}
                        <span className={`status-tag ${x.account.active ? 'status-found' : 'status-outcome'}`}>
                          {x.account.active ? 'ใช้งาน' : 'ปิด'}
                        </span>
                        {!x.account.hasPhone && <span className="status-tag status-outcome"> ไม่มีเบอร์</span>}
                      </>
                    ) : (
                      <span className="fine">ยังไม่สร้าง (รอซิงก์รอบถัดไป)</span>
                    )}
                  </td>
                  <td className="fine">{x.note ?? ''}</td>
                  <td>
                    <Button variant="secondary" size="sm" disabled={busy} onClick={() => void remove(x)}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                        <Trash2 size={13} />
                        เอาออก
                      </span>
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}
