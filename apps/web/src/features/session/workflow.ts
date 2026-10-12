import type {
  MockSession,
  Product,
  SelectionItem,
  Timestamp,
  WorkflowState,
} from '../../types/session';
export type StepAction =
  | 'startDemo'
  | 'endDemo'
  | 'buy'
  | 'startSelection'
  | 'requestStock'
  | 'search'
  | 'found'
  | 'send'
  | 'receive'
  | 'scan'
  | 'bill'
  | 'complete';
const steps: Record<
  StepAction,
  { from: WorkflowState; to: WorkflowState; timestamp?: Timestamp }
> = {
  startDemo: { from: 'WALK_IN', to: 'DEMO', timestamp: 'demo_start_at' },
  endDemo: { from: 'DEMO', to: 'DECISION', timestamp: 'demo_end_at' },
  buy: { from: 'DECISION', to: 'DECISION', timestamp: 'decision_at' },
  startSelection: {
    from: 'DECISION',
    to: 'PRODUCT_SELECTION',
    timestamp: 'product_selection_start_at',
  },
  requestStock: {
    from: 'PRODUCT_SELECTION',
    to: 'STOCK_REQUESTED',
  },
  search: {
    from: 'STOCK_REQUESTED',
    to: 'SEARCHING',
    timestamp: 'stock_started_at',
  },
  found: { from: 'SEARCHING', to: 'FOUND', timestamp: 'stock_found_at' },
  send: { from: 'FOUND', to: 'SENT_TO_CASHIER' },
  receive: {
    from: 'SENT_TO_CASHIER',
    to: 'CASHIER_RECEIVED',
    timestamp: 'cashier_received_at',
  },
  scan: {
    from: 'CASHIER_RECEIVED',
    to: 'CASHIER_SCAN',
    timestamp: 'cashier_scan_at',
  },
  bill: {
    from: 'CASHIER_SCAN',
    to: 'BILL_OPENED',
    timestamp: 'bill_opened_at',
  },
  complete: { from: 'BILL_OPENED', to: 'COMPLETED' },
};
// Mock presentation only. Production transitions/permissions require API enforcement.
// OQ-05: separate preview clicks are NOT a finalized command/transaction contract.
export function advance(
  session: MockSession,
  action: StepAction,
  displayTime: string,
): MockSession {
  const step = steps[action];
  if (
    session.outcome ||
    session.state === 'COMPLETED' ||
    session.state !== step.from
  )
    return session;
  if (action === 'requestStock' && !session.confirmed) return session;
  if (action === 'startSelection' && !session.timestamps.decision_at)
    return session;
  if (step.timestamp && session.timestamps[step.timestamp]) return session;
  return {
    ...session,
    state: step.to,
    timestamps: {
      ...session.timestamps,
      ...(step.timestamp ? { [step.timestamp]: displayTime } : {}),
    },
  };
}
export function confirmSelection(
  session: MockSession,
  displayTime: string,
): MockSession {
  if (
    session.state !== 'PRODUCT_SELECTION' ||
    session.outcome ||
    session.confirmed ||
    session.selection.items.length === 0 ||
    !phoneIsValid(session.phone) ||
    !quantitiesAreValid(session.selection.accessories)
  )
    return session;
  return {
    ...session,
    state: 'STOCK_REQUESTED',
    confirmed: true,
    timestamps: {
      ...session.timestamps,
      product_selection_confirmed_at: displayTime,
    },
  };
}
export function toggleOption(selected: string[], option: string): string[] {
  if (option === 'None') return [];
  return selected.includes(option)
    ? selected.filter((item) => item !== option)
    : [...selected.filter((item) => item !== 'None'), option];
}
export function reasonIsValid(reason: string, text: string) {
  return Boolean(reason) && (reason !== 'อื่น ๆ' || Boolean(text.trim()));
}
export function progressIndex(session: MockSession): number {
  if (session.state === 'WALK_IN') return 0;
  if (session.state === 'DEMO') return 1;
  if (session.state === 'DECISION') return 2;
  if (session.state === 'PRODUCT_SELECTION') return session.confirmed ? 4 : 3;
  if (['STOCK_REQUESTED', 'SEARCHING', 'FOUND'].includes(session.state))
    return 5;
  return 6;
}

/**
 * What staff call a main product ("iPhone 16 Pro 256GB Desert Titanium"): the SKU name, with the product name in front
 * when the SKU name does not already carry it ("128GB Black" under "iPhone 16"); the product name alone without a SKU name.
 */
export function itemName(item: SelectionItem): string {
  const sku = item.product.model;
  const family = item.product.product;
  if (!sku) return family || item.product.sku;
  if (!family || sku.toLowerCase().includes(family.toLowerCase())) return sku;
  return `${family} ${sku}`;
}

/** One main product as text with its quantity, the way stock reviews list it: "iPhone 16 128GB (x2)". */
export function itemLabel(item: SelectionItem): string {
  return `${itemName(item)} (x${item.quantity})`;
}

/** All main products on one line: "A ×2, B". Empty when none is chosen. */
export function itemsText(items: SelectionItem[]): string {
  return items
    .map((item) =>
      item.quantity > 1 ? `${itemName(item)} ×${item.quantity}` : itemName(item),
    )
    .join(', ');
}

/** Picking a product (F3): one already in the list gains a unit, a new one starts at 1. */
export function addItem(items: SelectionItem[], product: Product): SelectionItem[] {
  return items.some((item) => item.product.id === product.id)
    ? items.map((item) =>
        item.product.id === product.id
          ? { ...item, quantity: item.quantity + 1 }
          : item,
      )
    : [...items, { product, quantity: 1 }];
}

/** `+` / `−` on a main product (F3, F4): one unit more or less; below 1 the product is removed. */
export function stepItem(
  items: SelectionItem[],
  productId: string,
  delta: 1 | -1,
): SelectionItem[] {
  return items.flatMap((item) => {
    if (item.product.id !== productId) return [item];
    const quantity = item.quantity + delta;
    return quantity < 1 ? [] : [{ ...item, quantity }];
  });
}

/** "A012": the type letter plus at least three digits ("A1000" after 999). Mirrors `formatQueue` in the API. */
export function formatQueue(
  letter: string | null | undefined,
  no: number,
): string {
  return `${letter ?? ''}${String(no).padStart(3, '0')}`;
}

export function phoneIsValid(phone: string): boolean {
  return /^[0-9]{10}$/.test(phone);
}
export function quantityIsValid(quantity: string): boolean {
  return /^0*[1-9][0-9]*$/.test(quantity);
}
export function quantitiesAreValid(
  accessories: Record<string, string>,
): boolean {
  return Object.values(accessories).every(quantityIsValid);
}
export function toggleAccessory(
  accessories: Record<string, string>,
  name: string,
): Record<string, string> {
  if (Object.hasOwn(accessories, name)) {
    return Object.fromEntries(
      Object.entries(accessories).filter(([key]) => key !== name),
    );
  }
  return { ...accessories, [name]: '1' };
}

/**
 * The `+` / `−` buttons next to an accessory (F4): changes the quantity by one. Below 1 the accessory is removed, like
 * unticking it. A quantity that is not a valid number yet (an empty box) counts as 0, so `+` gives 1.
 */
export function stepAccessory(
  accessories: Record<string, string>,
  name: string,
  delta: 1 | -1,
): Record<string, string> {
  if (!Object.hasOwn(accessories, name)) return accessories;
  const current = Number.parseInt(accessories[name], 10);
  const next = (quantityIsValid(accessories[name]) ? current : 0) + delta;
  if (next < 1) {
    return Object.fromEntries(
      Object.entries(accessories).filter(([key]) => key !== name),
    );
  }
  return { ...accessories, [name]: String(next) };
}

/** One step of the customer's visit and how long it took (F14). `ms` is null when the step did not happen. */
export interface StepDuration {
  key: string;
  label: string;
  ms: number | null;
}

/** First time of an event type in the session's history (some milestones have no column: sent to cashier, completed). */
function eventTime(session: MockSession, eventType: string): string | undefined {
  return session.events?.find((e) => e.eventType === eventType)?.createdAt;
}

/** When the visit ended: completed, cancelled, out of stock, or the NOT_BUY decision. Undefined while it is still running. */
function endedAt(session: MockSession): string | undefined {
  if (session.state === 'COMPLETED') return eventTime(session, 'COMPLETED');
  if (session.outcome === 'CUSTOMER_CANCELLED')
    return session.timestamps.cancelled_at;
  if (session.outcome === 'OUT_OF_STOCK')
    return eventTime(session, 'STOCK_OUT_OF_STOCK');
  if (session.outcome === 'NOT_BUY') return session.timestamps.decision_at;
  return undefined;
}

/**
 * The time spent in each step of a visit, from the server's milestone timestamps and events (F14). Consecutive
 * milestones only: a step whose start or end was never recorded (a cancelled visit, a skipped step) has no duration.
 * `total` covers walk-in to the end of the visit.
 */
export function stepDurations(session: MockSession): StepDuration[] {
  const t = session.timestamps;
  const sent = eventTime(session, 'STOCK_SENT_TO_CASHIER');
  const completed = eventTime(session, 'COMPLETED');
  const steps: [string, string, string | undefined, string | undefined][] = [
    ['wait_demo', 'รอก่อนเริ่ม DEMO', t.customer_walk_in_at, t.demo_start_at],
    ['demo', 'DEMO', t.demo_start_at, t.demo_end_at],
    ['decision', 'ตัดสินใจหลัง DEMO', t.demo_end_at, t.decision_at],
    ['to_selection', 'เริ่มเลือกสินค้าหลังตัดสินใจ', t.decision_at, t.product_selection_start_at],
    ['selection', 'เลือกสินค้าจนยืนยัน', t.product_selection_start_at, t.product_selection_confirmed_at],
    ['wait_stock', 'รอ Stock รับงาน', t.product_selection_confirmed_at, t.stock_started_at],
    ['stock_search', 'Stock ค้นหาสินค้า', t.stock_started_at, t.stock_found_at],
    ['stock_send', 'Stock เตรียมส่ง Cashier', t.stock_found_at, sent],
    ['wait_cashier', 'รอ Cashier รับสินค้า', sent, t.cashier_received_at],
    ['cashier_scan', 'Cashier รับสินค้า → Scan', t.cashier_received_at, t.cashier_scan_at],
    ['cashier_bill', 'Scan → เปิดบิล', t.cashier_scan_at, t.bill_opened_at],
    ['cashier_complete', 'เปิดบิล → เสร็จสิ้น', t.bill_opened_at, completed],
    ['total', 'รวมทั้งหมด', t.customer_walk_in_at, endedAt(session)],
  ];
  return steps.map(([key, label, from, to]) => {
    const ms = from && to ? new Date(to).getTime() - new Date(from).getTime() : NaN;
    return { key, label, ms: Number.isFinite(ms) && ms >= 0 ? ms : null };
  });
}

/** `H:MM:SS` (hours are not capped); empty when there is no duration. */
export function formatDuration(ms: number | null): string {
  if (ms === null) return '';
  const total = Math.round(ms / 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${Math.floor(total / 3600)}:${pad(Math.floor((total % 3600) / 60))}:${pad(total % 60)}`;
}

export function partialFulfillStock(
  session: MockSession,
  outOfStockItems: string[],
  displayTime: string,
): MockSession {
  if (session.state !== 'SEARCHING' || session.outcome) return session;
  const newAccessories = { ...session.selection.accessories };
  for (const item of outOfStockItems) {
    delete newAccessories[item];
  }
  const removeMain = outOfStockItems.includes('MAIN_PRODUCT');
  return {
    ...session,
    state: 'FOUND',
    selection: {
      ...session.selection,
      items: removeMain ? [] : session.selection.items,
      accessories: newAccessories,
    },
    timestamps: {
      ...session.timestamps,
      stock_found_at: displayTime,
    },
  };
}

export function isSameDay(dateStr?: string | null, targetDate: Date = new Date()): boolean {
  if (!dateStr) return false;
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return false;
  return (
    d.getFullYear() === targetDate.getFullYear() &&
    d.getMonth() === targetDate.getMonth() &&
    d.getDate() === targetDate.getDate()
  );
}

export function isToday(dateStr?: string | null): boolean {
  return isSameDay(dateStr, new Date());
}

export function resolveSessionStatusText(session: {
  state: string;
  outcome?: string | null;
  stockPendingReview?: unknown;
}): string {
  if (session.outcome === 'CUSTOMER_CANCELLED') return 'ยกเลิก';
  if (session.outcome === 'NOT_BUY') return 'ไม่ซื้อ';
  if (session.outcome === 'OUT_OF_STOCK') return 'สินค้าหมด';
  if (session.state === 'COMPLETED') return 'สำเร็จ';
  if (session.stockPendingReview) return 'RETURN_TO_STAFF';
  if (session.state === 'WALK_IN') return 'ลูกค้าเดินเข้าร้าน';
  if (session.state === 'DEMO') return 'DEMO';
  if (session.state === 'PRODUCT_SELECTION') return 'กำลังเลือกสินค้า';
  return `กำลังบริการ (${session.state})`;
}

export function getSessionMissingDescription(session: {
  selection?: { items?: SelectionItem[] } | null;
  stockPendingReview?: {
    missingItems?: string[];
    stockNote?: string;
  } | null;
  outcome?: string | null;
}): string {
  const missing = session.stockPendingReview?.missingItems;
  const items = session.selection?.items ?? [];
  const mainProd = itemsText(items);

  if (missing && missing.length > 0) {
    const missingStr = missing.join(', ');
    const containsMain = items.some((item) =>
      missing.some((text) => text.includes(itemName(item))),
    );
    if (mainProd && !containsMain) {
      return `${missingStr} (ในคำสั่งซื้อ ${mainProd})`;
    }
    return missingStr;
  }

  if (mainProd) {
    return mainProd;
  }

  return 'สินค้าไม่ระบุ';
}


