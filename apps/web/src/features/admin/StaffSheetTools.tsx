import { useRef, useState } from 'react';
import { Download, Upload } from 'lucide-react';
import { Button, Modal, Notice } from '../../components/ui';
import { useToast } from '../../components/Toast';
import { api } from '../../services/api';
import {
  IMPORT_KEYS,
  rowsFromSheet,
  sheetsFromExport,
  stampForFile,
  type ImportReport,
  type ParsedSheet,
  type SheetRow,
  type StaffExport,
} from '../../utils/staffSheet';

const FIELD_LABEL: Record<string, string> = {
  staffId: 'รหัส',
  firstName: 'ชื่อ',
  lastName: 'นามสกุล',
  branchCode: 'สาขา',
  roles: 'บทบาท',
  active: 'สถานะ',
  phone: 'เบอร์โทร',
};
const ACTION_LABEL = {
  create: { text: 'สร้างใหม่', cls: 'status-found' },
  update: { text: 'แก้ไข', cls: 'status-cashier_received' },
  unchanged: { text: 'ไม่เปลี่ยน', cls: '' },
  error: { text: 'ผิดพลาด', cls: 'status-outcome' },
} as const;

/**
 * Export / import of the staff list as an .xlsx file (D86), ADMIN only. The spreadsheet libraries are loaded when a button is
 * pressed, so they are not in the main bundle. The import first sends the file's rows as a dry run and shows what would
 * happen; only "ยืนยัน" writes (all or nothing, the server decides).
 */
export function StaffSheetTools({ onImported }: { onImported: () => void | Promise<void> }) {
  const toast = useToast();
  const fileInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [parsed, setParsed] = useState<{ name: string; sheet: ParsedSheet } | null>(null);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [error, setError] = useState('');

  const exportFile = async () => {
    setBusy(true);
    try {
      const exp = await api<StaffExport>('/staff/export');
      const { staff, guide } = sheetsFromExport(exp);
      const importable = new Set(exp.columns.filter((c) => c.importable).map((c) => c.key));
      const { default: writeExcelFile } = await import('write-excel-file/universal');
      const head = (row: SheetRow) =>
        row.map((value) => ({
          value: String(value),
          fontWeight: 'bold' as const,
          backgroundColor: importable.has(String(value)) ? '#d8f3ee' : '#e9ecef',
        }));
      const blob = await writeExcelFile([
        {
          sheet: 'Staff',
          data: [head(staff[0]), ...staff.slice(1)],
          columns: exp.columns.map((c) => ({ width: Math.max(12, Math.min(26, c.key.length + 6)) })),
          stickyRowsCount: 1,
        },
        {
          sheet: 'คำอธิบาย',
          data: guide.map((row, i) =>
            i === 0 || row[0] === 'คอลัมน์ (หัวตาราง)'
              ? row.map((v) => ({ value: v === null ? undefined : v, fontWeight: 'bold' as const }))
              : row,
          ),
          columns: [{ width: 22 }, { width: 28 }, { width: 12 }, { width: 90 }],
        },
      ]).toBlob();
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = `ses-staff-${stampForFile()}.xlsx`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(link.href), 10_000);
      toast.success(`ส่งออก ${exp.rows.length.toLocaleString('th-TH')} บัญชีแล้ว (ไฟล์มีเบอร์โทร เก็บเป็นความลับ)`, 6000);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'ส่งออกไม่สำเร็จ', 6000);
    } finally {
      setBusy(false);
    }
  };

  const pickFile = async (file: File) => {
    setBusy(true);
    setError('');
    setReport(null);
    try {
      const { readSheet } = await import('read-excel-file/universal');
      // the "Staff" sheet when there is one (the guide sheet comes second), else the first
      let data: unknown[][];
      try {
        data = (await readSheet(file, 'Staff')) as unknown[][];
      } catch {
        data = (await readSheet(file)) as unknown[][];
      }
      const sheet = rowsFromSheet(data, [
        ...IMPORT_KEYS,
        'branchName', 'phoneSource', 'source', 'erpStaffId', 'erpSyncedAt', 'createdAt', 'updatedAt', 'lastLoginAt',
        'activeSessions', 'lastOtpAt', 'lastOtpStatus', 'mustChangePassword', 'failedAttempts', 'lockedUntil',
      ]);
      setParsed({ name: file.name, sheet });
      if (sheet.missingKey) {
        setError('ไม่พบคอลัมน์ staffId ในไฟล์ (หัวตารางแถวแรกต้องมี staffId) ใช้ไฟล์จากปุ่ม Export Excel');
      } else if (sheet.rows.length === 0) {
        setError('ไม่พบแถวข้อมูลในไฟล์');
      } else {
        setReport(await api<ImportReport>('/staff/import', 'POST', { rows: sheet.rows, dryRun: true }));
      }
    } catch (err) {
      setParsed({ name: file.name, sheet: { rows: [], unknownColumns: [], columns: [], missingKey: true } });
      setError(
        err instanceof Error && err.message
          ? `อ่านไฟล์ไม่สำเร็จ: ${err.message}`
          : 'อ่านไฟล์ไม่สำเร็จ ใช้ไฟล์ .xlsx เท่านั้น',
      );
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    if (!parsed) return;
    setBusy(true);
    try {
      const done = await api<ImportReport>('/staff/import', 'POST', { rows: parsed.sheet.rows, dryRun: false });
      if (!done.applied) {
        setReport(done);
        toast.error('ไม่ได้บันทึก มีแถวที่ผิดพลาด', 6000);
        return;
      }
      toast.success(`นำเข้าเรียบร้อย: สร้าง ${done.summary.created} · แก้ไข ${done.summary.updated} · ไม่เปลี่ยน ${done.summary.unchanged}`, 6000);
      setParsed(null);
      setReport(null);
      await onImported();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'นำเข้าไม่สำเร็จ');
    } finally {
      setBusy(false);
    }
  };

  const close = () => {
    setParsed(null);
    setReport(null);
    setError('');
  };
  const shown = report?.rows.filter((r) => r.action !== 'unchanged') ?? [];
  const canConfirm = Boolean(report) && report!.summary.errors === 0 && report!.summary.created + report!.summary.updated > 0;
  return (
    <>
      <Button variant="secondary" disabled={busy} onClick={() => void exportFile()}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
          <Download size={16} />
          Export Excel
        </span>
      </Button>
      <Button variant="secondary" disabled={busy} onClick={() => fileInput.current?.click()}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
          <Upload size={16} />
          Import Excel
        </span>
      </Button>
      <input
        ref={fileInput}
        type="file"
        accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        style={{ display: 'none' }}
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) void pickFile(file);
        }}
      />
      {parsed && (
        <Modal title={`นำเข้าจากไฟล์: ${parsed.name}`} isOpen onClose={close} maxWidth="860px">
          {busy && !report && <Notice>กำลังตรวจไฟล์…</Notice>}
          {error && <Notice error>{error}</Notice>}
          {parsed.sheet.unknownColumns.length > 0 && (
            <p className="fine">คอลัมน์ที่ระบบไม่รู้จักและข้ามไป: {parsed.sheet.unknownColumns.join(', ')}</p>
          )}
          {report && (
            <>
              <p>
                <strong>ตรวจแล้ว ยังไม่ได้บันทึก:</strong> สร้างใหม่ <strong>{report.summary.created}</strong> · แก้ไข{' '}
                <strong>{report.summary.updated}</strong> · ไม่เปลี่ยน <strong>{report.summary.unchanged}</strong> · ผิดพลาด{' '}
                <strong>{report.summary.errors}</strong>
              </p>
              {report.summary.errors > 0 && (
                <Notice error>
                  มีแถวผิดพลาด จึงบันทึกไม่ได้ (ระบบบันทึกทั้งไฟล์หรือไม่บันทึกเลย) แก้ไฟล์ตามข้อความด้านล่างแล้วอัปโหลดใหม่
                </Notice>
              )}
              {report.summary.created > 0 && (
                <p className="fine">
                  บัญชีใหม่ไม่มีรหัสผ่าน: เข้าด้วย OTP ทาง SMS ได้เมื่อมีเบอร์โทร หรือให้ ADMIN กด Reset ตั้งรหัสผ่านชั่วคราวให้
                </p>
              )}
              {shown.length > 0 ? (
                <div className="table-responsive erp-sync-scroll">
                  <table className="admin-table">
                    <thead>
                      <tr>
                        <th>แถว</th>
                        <th>Staff ID</th>
                        <th>ผล</th>
                        <th>สิ่งที่เปลี่ยน / ข้อความ</th>
                      </tr>
                    </thead>
                    <tbody>
                      {shown.slice(0, 300).map((r) => (
                        <tr key={`${r.row}:${r.staffId}`}>
                          <td>{r.row}</td>
                          <td>{r.staffId || '—'}</td>
                          <td>
                            <span className={`status-tag ${ACTION_LABEL[r.action].cls}`}>{ACTION_LABEL[r.action].text}</span>
                          </td>
                          <td>
                            {r.message ?? r.changes.map((c) => FIELD_LABEL[c] ?? c).join(', ')}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {shown.length > 300 && <p className="fine">แสดง 300 แถวแรกจาก {shown.length} แถว</p>}
                </div>
              ) : (
                <p className="fine">ไม่มีแถวที่เปลี่ยน</p>
              )}
            </>
          )}
          <div className="actions" style={{ justifyContent: 'flex-end', marginTop: '12px' }}>
            <Button variant="secondary" onClick={close}>
              ยกเลิก
            </Button>
            <Button disabled={busy || !canConfirm} onClick={() => void confirm()}>
              ยืนยันนำเข้า
            </Button>
          </div>
        </Modal>
      )}
    </>
  );
}
