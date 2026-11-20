import type { FmpStatus } from '../../types/session';

/**
 * D100: the order's FileMaker side in one line, for staff, stock and the cashier: was SES's message delivered, and what did
 * FileMaker answer (e.g. its `ses` script opened the held bill, or refused a serial number). Nothing when nothing was sent.
 * D185: `text` and `hint` are in the shop's words ("U POS", what to do next) so a salesperson can read them; FileMaker's own
 * message (codes, saleID, the script's notes for the cashier) moves to `detail`, shown folded under "รายละเอียดจาก U POS".
 */
export type FmpLine = { tone: 'ok' | 'warn' | 'wait' | 'bad'; text: string; hint?: string; detail?: string };

export function fmpStatusText(fmp: FmpStatus | null | undefined): FmpLine | null {
  if (!fmp) return null;
  // D130: ADMIN's switch held the message back: U POS got nothing, the cashier keys the bill in by hand
  if (fmp.status === 'skipped')
    return {
      tone: 'warn',
      text: `ไม่ได้ส่งเข้า U POS: ${fmp.error ?? 'ADMIN ปิดการส่งอยู่'}`,
      hint: 'แคชเชียร์คีย์บิลเองใน U POS · ถ้าต้องการส่งเข้า U POS จริง ADMIN กด "ส่งซ้ำ" ที่ Admin → ส่งไป FileMaker หลังเปิดการส่ง',
    };
  const line = statusLine(fmp);
  // D130: an order that went to the test FileMaker says so, so nobody looks for its bill in the real U POS
  return line && fmp.target === 'UAT' ? { ...line, text: `[ระบบทดสอบ] ${line.text}` } : line;
}

/** "(2 รายการ)" in the `ses` script's CREATED answer: the lines on the held bill. */
const billLines = (message: string) => /\((\d+) รายการ\)/.exec(message)?.[1];

/**
 * D140: the short red tag a queue card shows instead of its state when the order's FileMaker side needs a person: exactly the orders
 * in Admin's "ออเดอร์ที่ต้องดู" problems, because the API decides (`fmp.attention`, one rule for both): the latest message failed,
 * is stuck in the queue, FileMaker answered with an error, or the bill opened without some serials. Null otherwise. The full line and
 * what to do stay in the order's summary (`fmpStatusText`). A held bill cancelled in FileMaker is not an SES cancel (D121): the order
 * is still open and can be sent again, so the tag never just says "ยกเลิก".
 */
export function fmpAlert(fmp: FmpStatus | null | undefined): string | null {
  if (!fmp) return null;
  // an API that does not send `attention` yet (mid-deploy): what the card can tell by itself
  const kind = fmp.attention !== undefined ? fmp.attention : fmp.status === 'failed' ? 'failed' : fmp.ackStatus === 'error' ? 'ack-error' : null;
  if (!kind) return null;
  if (kind === 'failed') return 'ส่ง FMP ไม่สำเร็จ';
  if (kind === 'stuck') return 'ส่ง FMP ค้าง';
  if (kind === 'sn-skipped') return 'บิล FMP ขาด SN';
  const message = fmp.ackMessage ?? '';
  const code = /^[A-Z_]+/.exec(message)?.[0];
  if (code === 'CANCELLED') return /^CANCELLED \(ชำระแล้ว/.test(message) ? 'FMP ยกเลิกบิลที่ชำระแล้ว' : 'FMP ยกเลิกบิลพัก';
  if (code === 'BILL_CONFIRMED' || code === 'BILL_IN_USE' || code === 'RELEASE_FAILED') return 'FMP เอาร่างบิลออกไม่ได้';
  return 'FMP ไม่รับ';
}

function statusLine(fmp: FmpStatus): FmpLine | null {
  // a failed delivery wins over any answer on the row (that answer came on the callback door, not from this delivery): Admin reads it the same way
  if (fmp.status === 'failed')
    return { tone: 'bad', text: 'ส่งเข้า U POS ไม่สำเร็จ', hint: 'แจ้ง ADMIN ให้กด "ส่งซ้ำ" (Admin → ส่งไป FileMaker)', detail: fmp.error ?? undefined };
  // D123 / D129: answers to "take the held draft out" (sent back to STOCK, cancelled, or a new round from STOCK)
  const release = releaseText(fmp);
  if (release) return release;
  if (fmp.ackStatus === 'error') {
    const message = fmp.ackMessage ?? '';
    // D103: the unit is in the shop but FileMaker has it elsewhere / not yet (a transfer not received)
    const notHereYet = /^SN_(WRONG_BRANCH|NOT_FOUND|NOT_READY_FOR_SALE)/.test(message);
    // D103: SES only sends fewer serials than units when STOCK chose "send with serials missing"; an older `ses` script refuses that
    const snMissing = /^SN_COUNT_MISMATCH/.test(message);
    const sn = /^SN_|INVALID_SN/.test(message);
    return {
      tone: 'bad',
      text: 'U POS ไม่รับออเดอร์นี้ ยังไม่มีบิลให้แคชเชียร์',
      hint: snMissing
        ? 'U POS ยังรับออเดอร์ที่ขาด SN ไม่ได้: แคชเชียร์คีย์บิลเองใน U POS'
        : notHereYet
        ? 'เครื่องอยู่ที่ร้านแต่ U POS ยังไม่อัปเดต (เช่น ยังไม่รับโอน): รับโอนใน U POS แล้ว ADMIN กด "ส่งซ้ำ" · หยิบผิดเครื่อง: ส่งกลับ Stock ให้สแกนใหม่'
        : sn
          ? 'Serial Number ไม่ตรงกับสต็อกใน U POS: ส่งกลับ Stock ให้สแกนใหม่'
          : /^QUERY_FAILED/.test(message)
            ? 'U POS อ่านข้อมูลไม่ได้ชั่วคราว: ADMIN กด "ส่งซ้ำ" ถ้ายังไม่หายแจ้งทีม FileMaker'
            : 'แจ้ง ADMIN / ทีม FileMaker',
      detail: fmp.ackMessage ?? undefined,
    };
  }
  // D103: FileMaker opened the held bill without the units that have no serial it accepts; the cashier scans those in as usual
  if (fmp.ackStatus === 'success' && /^CREATED_SN_LATER/.test(fmp.ackMessage ?? '')) {
    const missing = fmp.snMissing?.length;
    return {
      tone: 'warn',
      text: `ส่งเข้า U POS แล้ว แต่ยังขาด${missing ? ` ${missing} เครื่อง` : 'บางเครื่อง'}ในบิล`,
      hint: 'แคชเชียร์สแกนขายเครื่องที่ขาดเพิ่มในบิลที่ U POS (เครื่องที่โอนมา: รับโอนใน U POS ก่อน)',
      detail: fmp.ackMessage ?? undefined,
    };
  }
  if (fmp.ackStatus === 'success') {
    const message = fmp.ackMessage ?? '';
    const lines = /^CREATED\b/.test(message) ? billLines(message) : undefined;
    return { tone: 'ok', text: lines ? `ส่งเข้า U POS แล้ว บิลพักครบ ${lines} รายการ` : 'U POS รับแล้ว', detail: message || undefined };
  }
  if (fmp.ackStatus === 'reported') return { tone: 'wait', text: `U POS แจ้ง: ${fmp.ackMessage ?? '-'}` };
  if (fmp.status === 'sent') return { tone: 'wait', text: 'ส่งถึง U POS แล้ว รอผลตอบกลับ' };
  if (fmp.attempts > 0 && fmp.error)
    return { tone: 'wait', text: `กำลังลองส่งเข้า U POS ใหม่ (ครั้งที่ ${fmp.attempts})`, detail: fmp.error };
  return { tone: 'wait', text: 'กำลังส่งเข้า U POS…' };
}

/** The `ses` script's answers about taking the held draft (pos_front_sale_tmp) out, in the cashier's words; null for any other answer. */
function releaseText(fmp: FmpStatus): FmpLine | null {
  const message = fmp.ackMessage ?? '';
  const code = /^[A-Z_]+/.exec(message)?.[0];
  if (fmp.ackStatus === 'success' && code === 'RELEASED') return { tone: 'ok', text: 'U POS เอาร่างบิลออกแล้ว SN ว่าง สแกนใหม่ได้' };
  if (fmp.ackStatus === 'success' && code === 'NOTHING_TO_RELEASE') return { tone: 'ok', text: 'U POS ไม่มีร่างบิลของออเดอร์นี้ ไม่ต้องเอาออก' };
  if (fmp.ackStatus !== 'error') return null;
  if (code === 'BILL_CONFIRMED')
    return {
      tone: 'bad',
      text: 'เอาร่างบิลออกไม่ได้: แคชเชียร์ยืนยันเป็นบิลจริงใน U POS ไปแล้ว',
      hint: 'แคชเชียร์ยกเลิกบิลจริงใบนั้นใน U POS เอง พอ STOCK ส่งออเดอร์มาใหม่ U POS จะเปิดร่างใบใหม่ให้',
      detail: message,
    };
  if (code === 'BILL_IN_USE')
    return {
      tone: 'bad',
      text: 'เอาร่างบิลออกไม่ได้: แคชเชียร์เปิดร่างนี้ทำรายการอยู่',
      hint: 'แคชเชียร์ยกเลิกร่างนั้นใน U POS เอง',
      detail: message,
    };
  if (code === 'RELEASE_FAILED')
    return { tone: 'bad', text: 'เอาร่างบิลออกไม่สำเร็จ', hint: 'ADMIN กด "ส่งซ้ำ" ถ้ายังไม่หายแจ้งทีม FileMaker', detail: message };
  return null;
}
