export type WorkflowState =
  | 'WALK_IN'
  | 'DEMO'
  | 'DECISION'
  | 'PRODUCT_SELECTION'
  | 'STOCK_REQUESTED'
  | 'SEARCHING'
  | 'FOUND'
  | 'SENT_TO_CASHIER'
  | 'CASHIER_RECEIVED'
  | 'CASHIER_SCAN'
  | 'BILL_OPENED'
  | 'COMPLETED';

// UI outcome, not a choice of physical state/outcome storage (OQ-04).
export type Outcome = 'NOT_BUY' | 'OUT_OF_STOCK' | 'CUSTOMER_CANCELLED';
export type Role = 'ADMIN' | 'MANAGER' | 'STAFF' | 'STOCK' | 'CASHIER';

export interface Branch {
  id: string;
  code: string;
  name: string;
  phone: string;
}

export interface StaffMember {
  id: string;
  staffId: string;
  firstName?: string;
  lastName?: string;
  name: string;
  branchCode: string;
  branchName: string;
  roles: Role[];
  active: boolean;
}

export interface MockUser {
  staffId: string;
  firstName?: string;
  lastName?: string;
  name?: string;
  roles: Role[];
  branch: string;
  branchCode?: string;
}

export interface ProductModel {
  id: string;
  category: string;
  name: string;
  code: string;
}

export interface ProductSKU {
  id: string;
  modelId: string;
  modelName: string;
  category: string;
  sku: string;
  name: string;
  color?: string;
  storage?: string;
}

export interface Product {
  id: string;
  category: string;
  product: string;
  model: string;
  sku: string;
  stock?: number;
  /** Where `stock` comes from: `unlimited` = the ADMIN switch is on (D59, nothing is blocked), `erp` = warroom (D52), `manual` = kept by ADMIN (D41). */
  stockSource?: 'unlimited' | 'erp' | 'manual';
  /** ISO time of the warroom snapshot behind an `erp` stock number. */
  erpAsOf?: string | null;
  branchActive?: boolean;
}

/** A payment method staff can pick (F6): kept by ADMIN. The name is what a session stores. */
export interface PaymentMethod {
  id: string;
  name: string;
  active: boolean;
  position: number;
}

/** Global ADMIN switches (D59). `updatedAt` / `updatedBy` are sent to ADMIN only. */
export interface AppSettings {
  stockUnlimited: boolean;
  updatedAt?: string | null;
  updatedBy?: string | null;
}

/** One main product of a session (F3): the catalog entry picked and how many. */
export interface SelectionItem {
  /** `SessionItem.id` on the server; absent while the item only exists in the browser. */
  id?: string;
  /** `product.id` is the SKU id. */
  product: Product;
  quantity: number;
}

export interface Selection {
  /** The main products, in the order the staff added them; empty = none chosen yet. */
  items: SelectionItem[];
  accessories: Record<string, string>;
  ontop: string[];
  points: string[];
  burnPoints: string[];
  payments: string[];
}

export type Timestamp =
  | 'customer_walk_in_at'
  | 'demo_start_at'
  | 'demo_end_at'
  | 'decision_at'
  | 'product_selection_start_at'
  | 'product_selection_confirmed_at'
  | 'stock_started_at'
  | 'stock_found_at'
  | 'cashier_received_at'
  | 'cashier_scan_at'
  | 'bill_opened_at'
  | 'cancelled_at';

export interface SessionEventItem {
  id: string;
  eventType: string;
  actorStaffId: string;
  createdAt: string;
  metadata?: Record<string, unknown> | null;
}

/** A back-office customer type (D57): its letter is the queue letter ("A012") and the sort order. */
export interface CustomerType {
  id: string;
  letter: string;
  name: string;
  description?: string | null;
  active: boolean;
}

export interface MockSession {
  id?: string;
  /** Internal key (SES-YYYYMMDD-NNNNNN): React keys, lookups, links. Staff see `queue` instead (D57). */
  reference: string;
  /** What staff call the customer by, e.g. "A012" (letter + number); sessions from before D57 have no letter ("007"). */
  queue: string;
  customerTypeId?: string;
  customerTypeLetter?: string;
  customerTypeName?: string;
  branchCode: string;
  branchName: string;
  phone: string;
  staffId: string;
  state: WorkflowState;
  selection: Selection;
  confirmed: boolean;
  outcome?: Outcome;
  reason?: string;
  otherReason?: string;
  cancelledBy?: string;
  /** F12: when and by whom stock acknowledged this cancel; absent while stock still has to act. */
  stockAckAt?: string;
  stockAckBy?: string;
  /** F11: the cancelled session this one was bought again from, and the one that replaced this (cancelled) one. */
  rebuyOf?: { id: string; reference: string };
  rebuiltAs?: { id: string; reference: string };
  stockPendingReview?: {
    missingItems: string[];
    /** `SessionItem.id`s of the missing main products (F3). */
    missingItemIds?: string[];
    foundItems: string[];
    stockNote?: string;
    reportedAt: string;
    acknowledgedAt?: string;
    acknowledgedBy?: string;
  };
  timestamps: Partial<Record<Timestamp, string>>;
  events?: SessionEventItem[];
}

export type AppView =
  | 'staff'
  | 'stock'
  | 'cashier'
  | 'products'
  | 'logs'
  | 'admin';
