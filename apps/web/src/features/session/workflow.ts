import type {
  MockSession,
  Product,
  SelectionItem,
  SessionEventItem,
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
export function progressIndex(session: MockSession, isReviewing = false): number {
  if (session.state === 'WALK_IN') return 0;
  if (session.state === 'PRODUCT_SELECTION') {
    if (session.confirmed) return 2;
    return isReviewing ? 2 : 1;
  }
  if (['STOCK_REQUESTED', 'SEARCHING', 'FOUND'].includes(session.state))
    return 3;
  if (
    [
      'SENT_TO_CASHIER',
      'CASHIER_RECEIVED',
      'CASHIER_SCAN',
      'BILL_OPENED',
      'COMPLETED',
    ].includes(session.state)
  )
    return 4;
  return 1;
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

/** The steps of a visit, in order, with the label shown in the export. `total` is the whole session. */
const STEP_LABELS: [string, string][] = [
  ['selection', 'เลือกสินค้าจนยืนยัน'],
  ['wait_stock', 'รอ Stock รับงาน'],
  ['stock_search', 'Stock ค้นหาสินค้า'],
  ['stock_send', 'Stock เตรียมส่ง Cashier'],
  ['wait_cashier', 'รอ Cashier รับสินค้า'],
  ['cashier_scan', 'Cashier รับสินค้า → Scan'],
  ['cashier_bill', 'Scan → เปิดบิล'],
  ['cashier_complete', 'เปิดบิล → เสร็จสิ้น'],
  ['total', 'รวมทั้งหมด'],
];

/** The event that starts a step (the step lasts until the next event that starts another one or ends the session). */
function phaseStartedBy(event: SessionEventItem): string | 'END' | undefined {
  const meta = (event.metadata ?? {}) as Record<string, unknown>;
  switch (event.eventType) {
    case 'SESSION_CREATED':
    case 'PRODUCT_SELECTION_STARTED':
      return 'selection';
    case 'DEMO_STARTED':
    case 'DEMO_ENDED':
      return undefined;
    case 'DECISION_MADE':
      return meta.outcome === 'NOT_BUY' ? 'END' : undefined;
    case 'PRODUCT_SELECTION_CONFIRMED':
      return 'wait_stock';
    case 'STOCK_SEARCHING':
      return 'stock_search';
    case 'STOCK_FOUND':
      return 'stock_send';
    case 'STOCK_SENT_TO_CASHIER':
      return 'wait_cashier';
    case 'CASHIER_RECEIVED':
      return 'cashier_scan';
    case 'CASHIER_SCANNED':
      return 'cashier_bill';
    case 'BILL_OPENED':
      return 'cashier_complete';
    // the cashier sent the order back: stock searches again
    case 'CASHIER_REJECTED':
      return 'stock_search';
    // the customer wants other items: back to choosing
    case 'STAFF_RESOLVED_STOCK_REVIEW':
      return meta.action === 'CHANGE_ITEMS' ? 'selection' : undefined;
    case 'COMPLETED':
    case 'CUSTOMER_CANCELLED':
    case 'STOCK_OUT_OF_STOCK':
      return 'END';
    default:
      return undefined;
  }
}

/** When a session started (its first event) and ended (completed, cancelled, out of stock, NOT_BUY); end is undefined while it runs. */
export function sessionSpan(session: MockSession): { start?: string; end?: string } {
  const events = session.events ?? [];
  const start = events[0]?.createdAt ?? session.timestamps.customer_walk_in_at;
  const end = events.find((e) => phaseStartedBy(e) === 'END')?.createdAt;
  return { start, end };
}

/**
 * The time spent in each step of a visit, from the server's events (F14). Each interval between two events goes to the step
 * the first of them started, so a step that happens twice (the cashier sends the order back, the customer changes the
 * items) adds up. A step that never happened, or has not ended yet, has no duration; `total` is the whole session.
 */
export function stepDurations(session: MockSession): StepDuration[] {
  const sums = new Map<string, number>();
  let phase: string | undefined;
  let since = 0;
  for (const event of session.events ?? []) {
    const at = new Date(event.createdAt).getTime();
    if (!Number.isFinite(at)) continue;
    if (phase && at >= since) {
      sums.set(phase, (sums.get(phase) ?? 0) + (at - since));
    }
    since = at;
    const next = phaseStartedBy(event);
    if (next === 'END') phase = undefined;
    else if (next) phase = next;
  }
  const { start, end } = sessionSpan(session);
  const total = start && end ? new Date(end).getTime() - new Date(start).getTime() : NaN;
  return STEP_LABELS.map(([key, label]) => {
    const ms = key === 'total' ? total : (sums.get(key) ?? NaN);
    return { key, label, ms: Number.isFinite(ms) && ms >= 0 ? ms : null };
  });
}

/**
 * The whole visit when a session was bought again: from the first walk-in of the chain to the end of its last session
 * (F11). Null while the visit runs. A session that was never bought again is its own visit.
 */
export function visitDuration(session: MockSession, all: MockSession[]): number | null {
  const byReference = new Map(all.map((s) => [s.reference, s]));
  let first = session;
  for (let i = 0; i < 20 && first.rebuyOf; i++) {
    const parent = byReference.get(first.rebuyOf.reference);
    if (!parent) break;
    first = parent;
  }
  let last = first;
  for (let i = 0; i < 20 && last.rebuiltAs; i++) {
    const next = byReference.get(last.rebuiltAs.reference);
    if (!next) break;
    last = next;
  }
  const start = sessionSpan(first).start;
  const end = sessionSpan(last).end;
  if (!start || !end) return null;
  const ms = new Date(end).getTime() - new Date(start).getTime();
  return Number.isFinite(ms) && ms >= 0 ? ms : null;
}

/**
 * F12: a cancel stock has not acknowledged yet. After the stock request stock must be told (stop searching, or bring the
 * picked goods back to the shelf); the notice stays until stock acknowledges, on every device.
 */
export function needsStockAck(session: MockSession): boolean {
  return (
    session.outcome === 'CUSTOMER_CANCELLED' &&
    Boolean(session.timestamps.product_selection_confirmed_at) &&
    !session.stockAckAt
  );
}

/** The goods had already been picked when the session was cancelled (it was at FOUND or later): they must go back to the shelf. */
export function goodsToReturn(session: MockSession): boolean {
  return (
    session.outcome === 'CUSTOMER_CANCELLED' &&
    ['FOUND', 'SENT_TO_CASHIER', 'CASHIER_RECEIVED', 'CASHIER_SCAN', 'BILL_OPENED'].includes(
      session.state,
    )
  );
}

/**
 * F13: when stock has the order again because the cashier sent it back, and why: the last CASHIER_REJECTED event, as long
 * as it is newer than the last STOCK_FOUND and the session is at the stock stage. Undefined otherwise.
 */
export function cashierRejectNotice(
  session: MockSession,
): {
  reason: string;
  at: string;
  wrongItems?: string[];
  wrongItemIds?: string[];
  wrongItemDetails?: Record<string, { reason: string; note?: string }>;
} | undefined {
  if (session.state !== 'SEARCHING' || session.outcome) return undefined;
  const events = session.events ?? [];
  const reject = [...events].reverse().find((e) => e.eventType === 'CASHIER_REJECTED');
  if (!reject) return undefined;
  const found = [...events].reverse().find((e) => e.eventType === 'STOCK_FOUND');
  if (found && new Date(found.createdAt) > new Date(reject.createdAt)) return undefined;
  const meta = (reject.metadata ?? {}) as {
    reason?: string;
    otherReason?: string | null;
    wrongItems?: string[];
    wrongItemIds?: string[];
    wrongItemDetails?: Record<string, { reason: string; note?: string }>;
  };
  const out: {
    reason: string;
    at: string;
    wrongItems?: string[];
    wrongItemIds?: string[];
    wrongItemDetails?: Record<string, { reason: string; note?: string }>;
  } = {
    reason: [meta.reason, meta.otherReason].filter(Boolean).join(': '),
    at: reject.createdAt,
  };
  if (Array.isArray(meta.wrongItems) && meta.wrongItems.length > 0) {
    out.wrongItems = meta.wrongItems;
  }
  if (Array.isArray(meta.wrongItemIds) && meta.wrongItemIds.length > 0) {
    out.wrongItemIds = meta.wrongItemIds;
  }
  if (meta.wrongItemDetails && typeof meta.wrongItemDetails === 'object') {
    out.wrongItemDetails = meta.wrongItemDetails;
  }
  return out;
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


