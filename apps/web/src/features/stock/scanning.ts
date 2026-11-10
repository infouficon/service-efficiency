/** What the server accepts as a serial number (D92): printable ASCII, no spaces, 1 to 64 characters. */
export const SERIAL = /^[\x21-\x7E]{1,64}$/;

/** IMEI check digit (Luhn): every second digit from the right doubled, the sum a multiple of 10. */
export function luhnOk(digits: string): boolean {
  let sum = 0;
  for (let i = 0; i < digits.length; i += 1) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

/**
 * D124: what is wrong with a serial typed or scanned into the box, or '' (the server checks the same, `serialProblem`). Digits
 * only = an iPhone IMEI: 15 digits with a valid check digit. 14 digits is the MEID on the label, 12 / 13 the UPC / EAN.
 */
export function serialProblem(sn: string): string {
  if (!SERIAL.test(sn)) return 'ใช้ตัวอักษร/ตัวเลขที่พิมพ์ได้ ไม่มีเว้นวรรค ไม่เกิน 64 ตัว';
  if (!/^\d+$/.test(sn)) return '';
  if (sn.length === 14) return 'เลข 14 หลักคือ MEID ไม่ใช่ IMEI: สแกนบาร์โค้ด IMEI (15 หลัก) บนกล่อง';
  if (sn.length !== 15) return `ตัวเลข ${sn.length} หลักไม่ใช่ IMEI (IMEI มี 15 หลัก; 12/13 หลักคือบาร์โค้ดสินค้า)`;
  return luhnOk(sn) ? '' : 'IMEI ไม่ถูกต้อง (เลขตรวจหลักสุดท้ายไม่ตรง) สแกนหรือพิมพ์ผิด ลองสแกนใหม่';
}

/**
 * D108: the serial (or IMEI) a barcode on the box stands for, or null for the other barcodes on an Apple label. The value is
 * kept as read (upper case), the same as a barcode scanner would type it.
 * - all digits: only 15 digits is an IMEI; 12 / 13 digits are the UPC / EAN, 32 digits the EID
 * - with a "/": the part number (e.g. MHQL4TH/A)
 * - otherwise 8 to 20 letters and digits: a serial (Mac / iPad labels: "S" + the serial)
 */
export function serialFromBarcode(raw: string): string | null {
  const text = raw.trim().toUpperCase();
  if (!SERIAL.test(text)) return null;
  if (/^\d+$/.test(text)) return text.length === 15 && luhnOk(text) ? text : null; // D124: a misread IMEI is not used
  if (text.includes('/')) return null;
  return /^[A-Z0-9]{8,20}$/.test(text) ? text : null;
}

/**
 * D108: a barcode scanner that types like a keyboard, without any box having the focus. It types a burst of characters a few
 * milliseconds apart and ends with Enter; a person types far slower. Feed it every key typed while nothing editable has the
 * focus; it calls `onScan` with the burst and answers true for the Enter that ended one, which the caller then swallows (so the
 * Enter never presses a button that happens to have the focus, e.g. "ลูกค้ายกเลิก").
 */
export function createWedgeReader(
  onScan: (text: string) => void,
  { maxGapMs = 100, maxAverageMs = 60, minLength = 6 } = {},
) {
  let text = '';
  let first = 0;
  let last = 0;
  return (key: string, at: number): boolean => {
    if (key === 'Enter') {
      const scanned = text;
      const fast = scanned.length >= minLength && (last - first) / Math.max(1, scanned.length - 1) <= maxAverageMs;
      text = '';
      if (!fast) return false;
      onScan(scanned);
      return true;
    }
    // a scanner presses Shift for capitals: that is part of the burst, not a break in it
    if (key === 'Shift' || key === 'CapsLock') return false;
    if (key.length !== 1) {
      text = '';
      return false;
    }
    if (text && at - last > maxGapMs) text = '';
    if (!text) first = at;
    text += key;
    last = at;
    return false;
  };
}
