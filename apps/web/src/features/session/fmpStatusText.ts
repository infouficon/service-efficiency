import type { FmpStatus } from '../../types/session';

/**
 * D100: the order's FileMaker side in one line, for staff, stock and the cashier: was SES's message delivered, and what did
 * FileMaker answer (e.g. its `ses` script opened the held bill, or refused a serial number). Nothing when nothing was sent.
 */
export function fmpStatusText(
  fmp: FmpStatus | null | undefined,
): { tone: 'ok' | 'warn' | 'wait' | 'bad'; text: string; hint?: string } | null {
  if (!fmp) return null;
  if (fmp.ackStatus === 'error') {
    const message = fmp.ackMessage ?? '';
    // D103: the unit is in the shop but FileMaker has it elsewhere / not yet (a transfer not received)
    const notHereYet = /^SN_(WRONG_BRANCH|NOT_FOUND|NOT_READY_FOR_SALE)/.test(message);
    // D103: SES only sends fewer serials than units when STOCK chose "send with serials missing"; an older `ses` script refuses that
    const snMissing = /^SN_COUNT_MISMATCH/.test(message);
    const sn = /^SN_|INVALID_SN/.test(message);
    return {
      tone: 'bad',
      text: `FileMaker ไม่รับ: ${fmp.ackMessage ?? 'ไม่ทราบสาเหตุ'}`,
      hint: snMissing
        ? 'FileMaker ยังไม่รองรับออเดอร์ที่ขาด SN (สคริปต์รุ่นเก่า): แคชเชียร์คีย์บิลเองใน U POS / FileMaker'
        : notHereYet
        ? 'เครื่องอยู่ที่ร้านแต่ FileMaker ยังไม่อัปเดต (เช่น ยังไม่รับโอน): รับโอนใน FileMaker แล้ว ADMIN กด "ส่งซ้ำ" · หยิบผิดเครื่อง: ส่งกลับ Stock ให้สแกนใหม่'
        : sn
          ? 'Serial Number ไม่ตรงกับสต็อกใน FileMaker: ส่งกลับ Stock ให้สแกนใหม่'
          : 'แจ้ง ADMIN / ทีม FileMaker',
    };
  }
  // D103: FileMaker opened the held bill without the units that have no serial it accepts; the cashier scans those in as usual
  if (fmp.ackStatus === 'success' && /^CREATED_SN_LATER/.test(fmp.ackMessage ?? ''))
    return {
      tone: 'warn',
      text: `FileMaker เปิดบิลพักแล้ว แต่บางเครื่องไม่อยู่ในบิล: ${fmp.ackMessage}`,
      hint: 'แคชเชียร์สแกนขายเครื่องที่ขาดเพิ่มในบิลตามปกติ (เครื่องที่โอนมา: รับโอนใน FileMaker ก่อน)',
    };
  if (fmp.ackStatus === 'success') return { tone: 'ok', text: `FileMaker รับแล้ว: ${fmp.ackMessage ?? 'สำเร็จ'}` };
  if (fmp.ackStatus === 'reported') return { tone: 'wait', text: `FileMaker แจ้ง: ${fmp.ackMessage ?? '-'}` };
  if (fmp.status === 'failed') return { tone: 'bad', text: `ส่งไป FileMaker ไม่สำเร็จ: ${fmp.error ?? '-'}`, hint: 'ADMIN กด "ส่งซ้ำ" ได้ที่ Admin → ส่งไป FileMaker' };
  if (fmp.status === 'sent') return { tone: 'wait', text: 'ส่งถึง FileMaker แล้ว (ยังไม่มีผลตอบกลับ)' };
  if (fmp.attempts > 0 && fmp.error) return { tone: 'wait', text: `กำลังลองส่งไป FileMaker ใหม่ (ครั้งที่ ${fmp.attempts}): ${fmp.error}` };
  return { tone: 'wait', text: 'กำลังส่งไป FileMaker…' };
}
