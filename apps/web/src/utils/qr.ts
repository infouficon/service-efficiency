import qrcode from 'qrcode-generator';

/**
 * The QR code of `text` as one SVG path of its dark modules and its side in modules (without the quiet zone), so it can
 * be drawn at any size: `<svg viewBox="-4 -4 {size+8} {size+8}"><path d={path} /></svg>`. Error correction M; the
 * smallest version that fits the text; text is encoded as UTF-8.
 */
export function qrCode(text: string): { size: number; path: string } {
  // the library's own encoder keeps only the low byte of every character, which breaks anything that is not ASCII
  qrcode.stringToBytes = (value) => Array.from(new TextEncoder().encode(value));
  const qr = qrcode(0, 'M');
  qr.addData(text, 'Byte');
  qr.make();
  const size = qr.getModuleCount();
  let path = '';
  for (let row = 0; row < size; row++) {
    for (let column = 0; column < size; column++) {
      if (qr.isDark(row, column)) path += `M${column} ${row}h1v1h-1z`;
    }
  }
  return { size, path };
}
