import type { Prisma } from '@prisma/client';
import { FMP_PAYMENT_TYPE_FALLBACK } from '../payments/payments.service';
import { formatQueue } from '../queue/queue.service';
import { toOutboundCustomerPhone } from '../common/phone.util';
import type { PrismaService } from '../prisma/prisma.service';
import type { ReceiptTypeValue } from './dto';

/** The parts of a session the outside world is told about (the U POS door and the FileMaker push, D60 / D88). */
export interface OrderViewSource {
  reference: string;
  queueLetter: string | null;
  queueNo: number | null;
  state: string;
  phone: string | null;
  staffId: string;
  productSelectionConfirmedAt: Date | null;
  items: { quantity: number; sku: { sku: string; name: string; upc: string | null }; serials: { sn: string; position: number }[] }[];
  accessories: { accessoryName: string; quantity: number }[];
  payments: { method: string; cardType?: string | null; installmentMonths?: number | null }[];
  ontop: { name: string }[];
  points: { name: string }[];
  burnPoints: { name: string }[];
  posBillNo: string | null;
  vatRefund?: boolean | null;
  taxInvoice?: boolean | null;
  receiptType?: ReceiptTypeValue | null;
}

/** D128 labels, as staff picked them; sent with the code so FileMaker can show or map either (D129). */
export const RECEIPT_TYPE_LABELS: Record<ReceiptTypeValue, string> = {
  TAX_CORPORATE: 'ใบกำกับภาษีในนามนิติบุคคล',
  TAX_INDIVIDUAL: 'ใบกำกับภาษีในนามบุคคล',
  SIMPLIFIED: 'ใบเสร็จอย่างย่อ',
};

/** payment method name (lower case, the database compares without regard to case) -> its FMP payment type */
export type PaymentTypes = ReadonlyMap<string, string | null>;

/** Reads the FMP payment type of every payment method, for `orderView` (D89). One query per door call, not per order. */
export async function loadPaymentTypes(
  db: Pick<PrismaService, 'paymentMethod'> | Prisma.TransactionClient,
): Promise<PaymentTypes> {
  const methods = await db.paymentMethod.findMany({
    select: { name: true, fmpType: true },
  });
  return new Map(methods.map((m) => [m.name.toLowerCase(), m.fmpType]));
}

/**
 * One order as SES describes it to other systems. ONE function for every door, so what U POS reads and what FileMaker is sent
 * cannot drift apart. No prices (SES stores none, D58). Serial numbers (`items[].sn`, D92) are the ones STOCK scanned.
 */
export function orderView(s: OrderViewSource, paymentTypes: PaymentTypes) {
  return {
    reference: s.reference,
    queue: s.queueNo === null ? s.reference : formatQueue(s.queueLetter, s.queueNo),
    state: s.state,
    customerPhone: toOutboundCustomerPhone(s.phone),
    staffId: s.staffId,
    confirmedAt: s.productSelectionConfirmedAt,
    items: s.items.map((i) => ({
      partNo: i.sku.sku,
      upc: i.sku.upc,
      name: i.sku.name,
      quantity: i.quantity,
      // D92: the serial numbers STOCK scanned, in the order scanned (empty before the goods were sent to the cashier)
      sn: [...i.serials].sort((a, b) => a.position - b.position).map((x) => x.sn),
      // D103: units sent without a serial (STOCK chose "scan later"): FileMaker opens those lines without one
      snMissing: Math.max(0, i.quantity - i.serials.length),
    })),
    accessories: s.accessories.map((a) => ({
      name: a.accessoryName,
      quantity: a.quantity,
    })),
    payments: s.payments.map((p) => p.method),
    // D89: the same payments by FMP type, once each, in the order picked; a method with no type is "อื่นๆ"
    paymentTypes: [
      ...new Set(
        s.payments.map(
          (p) =>
            paymentTypes.get(p.method.toLowerCase()) ??
            FMP_PAYMENT_TYPE_FALLBACK,
        ),
      ),
    ],
    // D129: every payment with its FMP type and the card / installment months staff picked (D127), plus one readable label,
    // so the FileMaker script can map each value or just show the label to the cashier
    paymentDetails: s.payments.map((p) => {
      const cardType = p.cardType?.trim() || null;
      const installmentMonths = p.installmentMonths ?? null;
      const extra = [cardType, installmentMonths ? `${installmentMonths} เดือน` : null].filter(Boolean).join(' ');
      return {
        method: p.method,
        type: paymentTypes.get(p.method.toLowerCase()) ?? FMP_PAYMENT_TYPE_FALLBACK,
        cardType,
        installmentMonths,
        label: extra ? `${p.method} (${extra})` : p.method,
      };
    }),
    ontop: s.ontop.map((o) => o.name),
    points: s.points.map((p) => p.name),
    burnPoints: s.burnPoints.map((b) => b.name),
    posBillNo: s.posBillNo,
    vatRefund: Boolean(s.vatRefund),
    taxInvoice:
      s.receiptType != null
        ? s.receiptType === 'TAX_CORPORATE' || s.receiptType === 'TAX_INDIVIDUAL'
        : Boolean(s.taxInvoice),
    receiptType: s.receiptType ?? null,
    receiptTypeLabel: s.receiptType ? RECEIPT_TYPE_LABELS[s.receiptType] : null,
  };
}
