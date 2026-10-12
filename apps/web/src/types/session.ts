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
  branchActive?: boolean;
}

export interface Selection {
  product: Product | null;
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
  stockPendingReview?: {
    missingItems: string[];
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
