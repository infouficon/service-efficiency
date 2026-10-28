import { RoleCode } from '@prisma/client';
import { normalizeThaiMobile } from '../sms/sms.service';

/** One column of the staff spreadsheet (D86). `importable` columns are read back by the import; the others are for information. */
export interface SheetColumn {
  key: string;
  label: string;
  importable: boolean;
  note: string;
}

/** The columns of the staff export, in order. The header row of the sheet is `key`; `label` and `note` go to the guide sheet. */
export const STAFF_SHEET_COLUMNS: SheetColumn[] = [
  { key: 'staffId', label: 'รหัสพนักงาน', importable: true, note: 'กุญแจของแถว: มีในระบบแล้ว = แก้ไขบัญชีนั้น, ยังไม่มี = สร้างบัญชีใหม่ (ไม่มีรหัสผ่าน เข้าด้วย OTP ได้ถ้ามีเบอร์ หรือให้ ADMIN กด Reset)' },
  { key: 'firstName', label: 'ชื่อ', importable: true, note: 'บัญชีที่ซิงก์จาก ERP แก้ที่ ERP เท่านั้น' },
  { key: 'lastName', label: 'นามสกุล', importable: true, note: 'บัญชีที่ซิงก์จาก ERP แก้ที่ ERP เท่านั้น' },
  { key: 'branchCode', label: 'รหัสสาขา', importable: true, note: 'ต้องตรงกับรหัสสาขาใน SES; ADMIN ล้วนไม่มีสาขา (เว้นว่าง) บทบาทอื่นต้องมี 1 สาขา' },
  { key: 'branchName', label: 'ชื่อสาขา', importable: false, note: 'ดูอย่างเดียว' },
  { key: 'roles', label: 'บทบาท', importable: true, note: 'คั่นด้วย , เช่น STAFF หรือ MANAGER,STAFF (ADMIN, MANAGER, STAFF, STOCK, CASHIER)' },
  { key: 'active', label: 'ใช้งานอยู่', importable: true, note: 'TRUE / FALSE (หรือ ใช้งาน / ปิดใช้งาน)' },
  { key: 'phone', label: 'เบอร์มือถือ (รับ OTP)', importable: true, note: 'เว้นว่าง = ไม่เปลี่ยน, ใส่ - = ลบเบอร์, ไม่งั้นต้องเป็นเบอร์มือถือไทย (0812345678 หรือ 081-234-5678) บัญชีที่ซิงก์จาก ERP แก้ที่ ERP (ฟิลด์ tel)' },
  { key: 'phoneSource', label: 'ที่มาของเบอร์', importable: false, note: 'ERP (tel) หรือ กรอกเอง; ว่าง = ไม่มีเบอร์' },
  { key: 'source', label: 'ที่มาของบัญชี', importable: false, note: 'ERP = ซิงก์จาก ERP ทุกวัน 10:00, สร้างเอง = สร้างใน SES' },
  { key: 'erpStaffId', label: 'staff_id ใน ERP', importable: false, note: 'ดูอย่างเดียว' },
  { key: 'erpSyncedAt', label: 'ซิงก์จาก ERP ล่าสุด', importable: false, note: 'เวลาไทย' },
  { key: 'createdAt', label: 'วันที่สร้าง', importable: false, note: 'เวลาไทย; บัญชีที่มีมาก่อนเพิ่มระบบนี้แสดงเป็นวันที่เพิ่มระบบ เพราะประวัติจริงไม่ได้เก็บไว้' },
  { key: 'updatedAt', label: 'วันที่แก้ไขล่าสุด', importable: false, note: 'เวลาไทย; เริ่มบันทึกจริงตั้งแต่วันที่เพิ่มระบบนี้ (ก่อนหน้านั้นแสดงเป็นวันที่เพิ่มระบบ)' },
  { key: 'lastLoginAt', label: 'เข้าระบบล่าสุด', importable: false, note: 'เวลาไทย; เริ่มบันทึกตั้งแต่วันที่เพิ่มระบบนี้ ว่าง = ยังไม่เคยเข้าหลังจากนั้น' },
  { key: 'activeSessions', label: 'จำนวนที่ล็อกอินอยู่ตอนนี้', importable: false, note: 'ดูอย่างเดียว' },
  { key: 'lastOtpAt', label: 'ขอ OTP ล่าสุด', importable: false, note: 'เวลาไทย' },
  { key: 'lastOtpStatus', label: 'ผลส่ง SMS OTP ล่าสุด', importable: false, note: 'pending / sent / failed / delivered / undelivered' },
  { key: 'mustChangePassword', label: 'ต้องเปลี่ยนรหัสผ่าน', importable: false, note: 'ดูอย่างเดียว' },
  { key: 'failedAttempts', label: 'ใส่รหัสผ่านผิดติดต่อกัน', importable: false, note: 'ดูอย่างเดียว' },
  { key: 'lockedUntil', label: 'ถูกพักการเข้าระบบถึง', importable: false, note: 'เวลาไทย (ใส่รหัสผ่านผิดครบ 5 ครั้ง)' },
];

export const STAFF_IMPORT_MAX_ROWS = 2000;

/** Bangkok wall-clock text ("2026-10-29 14:05:09") of a date; empty for none. */
export function bangkokText(date: Date | null | undefined): string {
  if (!date) return '';
  return new Date(date.getTime() + 7 * 3600_000).toISOString().slice(0, 19).replace('T', ' ');
}

/** A spreadsheet cell as trimmed text; undefined for an empty cell. Dates are not meaningful in the importable columns. */
export function cellText(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  const text = typeof value === 'string' ? value : typeof value === 'number' || typeof value === 'boolean' ? String(value) : '';
  const trimmed = text.replace(/\u00a0/g, ' ').trim();
  return trimmed === '' ? undefined : trimmed;
}

/** TRUE/FALSE, 1/0, yes/no, ใช้งาน/ปิดใช้งาน. undefined = empty cell; null = not understood. */
export function parseActiveCell(value: unknown): boolean | undefined | null {
  if (typeof value === 'boolean') return value;
  const text = cellText(value)?.toLowerCase();
  if (text === undefined) return undefined;
  if (['true', '1', 'yes', 'y', 'ใช้งาน', 'ใช้งานอยู่', 'เปิด', 'active'].includes(text)) return true;
  if (['false', '0', 'no', 'n', 'ปิดใช้งาน', 'ไม่ใช้งาน', 'ปิด', 'inactive'].includes(text)) return false;
  return null;
}

/** "STAFF, cashier;MANAGER" -> roles. undefined = empty cell; an unknown word makes the whole cell invalid (null). */
export function parseRolesCell(value: unknown): RoleCode[] | undefined | null {
  const text = cellText(value);
  if (text === undefined) return undefined;
  const words = text.split(/[,;/\s]+/).filter(Boolean).map((w) => w.toUpperCase());
  const valid = Object.values(RoleCode) as string[];
  if (!words.length || words.some((w) => !valid.includes(w))) return null;
  return [...new Set(words)] as RoleCode[];
}

export type PhoneCell =
  | { kind: 'keep' }
  | { kind: 'clear' }
  | { kind: 'set'; phone: string }
  | { kind: 'bad' };

/** Empty = keep, "-" = clear, otherwise a Thai mobile number in any usual spelling. */
export function parsePhoneCell(value: unknown): PhoneCell {
  const text = cellText(value);
  if (text === undefined) return { kind: 'keep' };
  if (text === '-' || text === '–') return { kind: 'clear' };
  // a number cell loses its leading zero in Excel ("812345678"): put it back
  const fixed = /^\d{9}$/.test(text) && /^[689]/.test(text) ? `0${text}` : text;
  const phone = normalizeThaiMobile(fixed);
  return phone ? { kind: 'set', phone } : { kind: 'bad' };
}
