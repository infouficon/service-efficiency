import type { Prisma } from '@prisma/client';
import { FMP_PAYMENT_TYPE_FALLBACK } from '../payments/payments.service';
import { formatQueue } from '../queue/queue.service';
import type { PrismaService } from '../prisma/prisma.service';

/** The parts of a session the outside world is told about (the U POS door and the FileMaker push, D60 / D88). */
export interface OrderViewSource {
  reference: string;
  queueLetter: string | null;
  queueNo: number | null;
  state: string;
  phone: string | null;
  staffId: string;
  productSelectionConfirmedAt: Date | null;
  items: { quantity: number; sku: { sku: string; name: string } }[];
  accessories: { accessoryName: string; quantity: number }[];
  payments: { method: string }[];
  ontop: { name: string }[];
  points: { name: string }[];
  burnPoints: { name: string }[];
  posBillNo: string | null;
}

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
 * cannot drift apart. No prices (SES stores none, D58) and no serial numbers (SES does not capture them).
 */
export function orderView(s: OrderViewSource, paymentTypes: PaymentTypes) {
  return {
    reference: s.reference,
    queue: s.queueNo === null ? s.reference : formatQueue(s.queueLetter, s.queueNo),
    state: s.state,
    customerPhone: s.phone,
    staffId: s.staffId,
    confirmedAt: s.productSelectionConfirmedAt,
    items: s.items.map((i) => ({
      partNo: i.sku.sku,
      name: i.sku.name,
      quantity: i.quantity,
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
    ontop: s.ontop.map((o) => o.name),
    points: s.points.map((p) => p.name),
    burnPoints: s.burnPoints.map((b) => b.name),
    posBillNo: s.posBillNo,
  };
}
