/** What the server accepts as a serial number (D92): printable ASCII, no spaces, 1 to 64 characters. */
export const SERIAL = /^[\x21-\x7E]{1,64}$/;

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
  if (/^\d+$/.test(text)) return text.length === 15 ? text : null;
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
