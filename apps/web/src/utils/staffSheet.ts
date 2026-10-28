/**
 * The staff spreadsheet (D86), the browser half: turning the API's export into the rows of an .xlsx file, and the rows of an
 * uploaded .xlsx back into the objects the import endpoint takes. No spreadsheet library in here, so it is unit tested.
 */
export interface SheetColumn {
  key: string;
  label: string;
  importable: boolean;
  note: string;
}
export interface StaffExport {
  generatedAt: string;
  columns: SheetColumn[];
  rows: Record<string, string | number | boolean>[];
}
export type SheetValue = string | number | boolean | null;
export type SheetRow = SheetValue[];

/** The columns the import reads (the same keys the API accepts). The header row of the file is the column key. */
export const IMPORT_KEYS = ['staffId', 'firstName', 'lastName', 'branchCode', 'roles', 'active', 'phone'] as const;

/** "staffId (รหัสพนักงาน)" / "StaffID" / " staffid " -> the key it stands for, or null. */
export function headerKey(header: unknown, known: readonly string[]): string | null {
  const text = typeof header === 'string' ? header : header === null || header === undefined ? '' : String(header);
  const first = text.trim().split(/[\s(（]/)[0]?.toLowerCase() ?? '';
  return known.find((k) => k.toLowerCase() === first) ?? null;
}

export interface ParsedSheet {
  rows: Record<string, unknown>[];
  /** headers that are not a column of the export (ignored by the import) */
  unknownColumns: string[];
  /** which known columns the file has */
  columns: string[];
  /** the file has no staffId column: nothing can be imported */
  missingKey: boolean;
}

/** The 2D array an .xlsx reader gives (first non-empty row = header) as one object per data row; blank rows are dropped. */
export function rowsFromSheet(data: unknown[][], known: readonly string[]): ParsedSheet {
  const headerIndex = data.findIndex((r) => r.some((c) => c !== null && c !== undefined && String(c).trim() !== ''));
  if (headerIndex < 0) return { rows: [], unknownColumns: [], columns: [], missingKey: true };
  const header = data[headerIndex];
  const keys = header.map((h) => headerKey(h, known));
  const unknownColumns = header
    .map((h, i) => (keys[i] === null && String(h ?? '').trim() !== '' ? String(h).trim() : null))
    .filter((h): h is string => h !== null);
  const columns = [...new Set(keys.filter((k): k is string => k !== null))];
  const rows: Record<string, unknown>[] = [];
  for (const line of data.slice(headerIndex + 1)) {
    const row: Record<string, unknown> = {};
    let any = false;
    keys.forEach((key, i) => {
      if (key === null) return;
      const value = line[i];
      if (value === null || value === undefined || (typeof value === 'string' && value.trim() === '')) return;
      any = true;
      row[key] = value instanceof Date ? value.toISOString() : value;
    });
    if (any) rows.push(row);
  }
  return { rows, unknownColumns, columns, missingKey: !columns.includes('staffId') };
}

/** The rows of the "Staff" sheet (header = keys) and of the "คำอธิบาย" sheet for an export. */
export function sheetsFromExport(exp: StaffExport): { staff: SheetRow[]; guide: SheetRow[] } {
  const keys = exp.columns.map((c) => c.key);
  const staff: SheetRow[] = [
    keys,
    ...exp.rows.map((r) => keys.map((k) => (r[k] === undefined || r[k] === '' ? null : r[k]))),
  ];
  const guide: SheetRow[] = [
    ['ไฟล์ข้อมูลพนักงาน SES'],
    [`สร้างเมื่อ ${exp.generatedAt} (เวลาไทย) · มีข้อมูลส่วนบุคคล (เบอร์โทร) เก็บเป็นความลับ`],
    [],
    ['วิธี import: แก้เฉพาะคอลัมน์ที่นำเข้าได้ (หัวสีเขียว) ในชีต Staff แล้วอัปโหลดไฟล์เดิมที่หน้า จัดการผู้ใช้ → Import Excel ระบบจะแสดงตัวอย่างก่อนบันทึกจริง'],
    ['ไฟล์เป็นแบบ "ทั้งไฟล์หรือไม่เลย": ถ้ามีแถวผิดแม้แถวเดียว จะไม่บันทึกอะไร ให้แก้แล้วอัปโหลดใหม่'],
    ['ช่องว่าง = ไม่เปลี่ยน · เบอร์โทร ใส่ - = ลบเบอร์ · แถวที่ไม่มีใน SES จะสร้างเป็นบัญชีใหม่ (ไม่มีรหัสผ่าน เข้าด้วย OTP ได้เมื่อมีเบอร์)'],
    [],
    ['คอลัมน์ (หัวตาราง)', 'ความหมาย', 'นำเข้าได้', 'หมายเหตุ'],
    ...exp.columns.map((c): SheetRow => [c.key, c.label, c.importable ? 'ได้' : 'ดูอย่างเดียว', c.note]),
  ];
  return { staff, guide };
}

export interface ImportRowReport {
  row: number;
  staffId: string;
  action: 'create' | 'update' | 'unchanged' | 'error';
  changes: string[];
  message?: string;
}
export interface ImportReport {
  dryRun: boolean;
  applied: boolean;
  summary: { created: number; updated: number; unchanged: number; errors: number };
  rows: ImportRowReport[];
}

/** "2026-10-29 14:05" for a file name. */
export function stampForFile(date = new Date()): string {
  const bangkok = new Date(date.getTime() + 7 * 3600_000).toISOString();
  return `${bangkok.slice(0, 10).replace(/-/g, '')}-${bangkok.slice(11, 16).replace(':', '')}`;
}
