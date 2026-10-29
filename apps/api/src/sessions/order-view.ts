import { formatQueue } from '../queue/queue.service';

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

/**
 * One order as SES describes it to other systems. ONE function for every door, so what U POS reads and what FileMaker is sent
 * cannot drift apart. No prices (SES stores none, D58) and no serial numbers (SES does not capture them).
 */
export function orderView(s: OrderViewSource) {
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
    ontop: s.ontop.map((o) => o.name),
    points: s.points.map((p) => p.name),
    burnPoints: s.burnPoints.map((b) => b.name),
    posBillNo: s.posBillNo,
  };
}
