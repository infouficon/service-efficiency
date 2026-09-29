import type {
  MockSession,
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
    !session.selection.product ||
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
      product: removeMain ? null : session.selection.product,
      accessories: newAccessories,
    },
    timestamps: {
      ...session.timestamps,
      stock_found_at: displayTime,
    },
  };
}

