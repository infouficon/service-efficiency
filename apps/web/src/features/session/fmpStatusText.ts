import type { FmpStatus } from '../../types/session';

/**
 * D100: the order's FileMaker side in one line, for staff, stock and the cashier: was SES's message delivered, and what did
 * FileMaker answer (e.g. its `ses` script opened the held bill, or refused a serial number). Nothing when nothing was sent.
 */
export function fmpStatusText(fmp: FmpStatus | null | undefined): { tone: 'ok' | 'wait' | 'bad'; text: string; hint?: string } | null {
  if (!fmp) return null;
  if (fmp.ackStatus === 'error') {
    const sn = /^SN_|INVALID_SN/.test(fmp.ackMessage ?? '');
    return {
      tone: 'bad',
      text: `FileMaker ไม่รับ: ${fmp.ackMessage ?? 'ไม่ทราบสาเหตุ'}`,
      hint: sn ? 'Serial Number ไม่ตรงกับสต็อกใน FileMaker: ส่งกลับ Stock ให้สแกนใหม่' : 'แจ้ง ADMIN / ทีม FileMaker',
    };
  }
  if (fmp.ackStatus === 'success') return { tone: 'ok', text: `FileMaker รับแล้ว: ${fmp.ackMessage ?? 'สำเร็จ'}` };
  if (fmp.ackStatus === 'reported') return { tone: 'wait', text: `FileMaker แจ้ง: ${fmp.ackMessage ?? '-'}` };
  if (fmp.status === 'failed') return { tone: 'bad', text: `ส่งไป FileMaker ไม่สำเร็จ: ${fmp.error ?? '-'}`, hint: 'ADMIN กด "ส่งซ้ำ" ได้ที่ Admin → ส่งไป FileMaker' };
  if (fmp.status === 'sent') return { tone: 'wait', text: 'ส่งถึง FileMaker แล้ว (ยังไม่มีผลตอบกลับ)' };
  if (fmp.attempts > 0 && fmp.error) return { tone: 'wait', text: `กำลังลองส่งไป FileMaker ใหม่ (ครั้งที่ ${fmp.attempts}): ${fmp.error}` };
  return { tone: 'wait', text: 'กำลังส่งไป FileMaker…' };
}
