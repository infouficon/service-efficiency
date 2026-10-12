import { api } from './api';
import type {
  AppSettings,
  CustomerType,
  MockSession,
  Outcome,
  Selection,
  Timestamp,
  WorkflowState,
} from '../types/session';
import { formatQueue } from '../features/session/workflow';

export interface ApiSession {
  id: string;
  reference: string;
  branchId: string;
  branch?: { id: string; code: string; name: string; phone: string };
  staffId: string;
  customerId?: string | null;
  phone?: string | null;
  customerTypeId?: string | null;
  customerType?: { id: string; letter: string; name: string } | null;
  queueLetter?: string | null;
  queueNo?: number | null;
  state: WorkflowState;
  confirmed: boolean;
  outcome?: Outcome | null;
  reason?: string | null;
  otherReason?: string | null;
  cancelledBy?: string | null;
  /** F3: the main products, each with its SKU, model and product. */
  items?: {
    id: string;
    skuId: string;
    quantity: number;
    deducted: number;
    sku: {
      id: string;
      sku: string;
      name: string;
      color?: string | null;
      storage?: string | null;
      model: {
        id: string;
        name: string;
        product: { id: string; category: string; name: string };
      };
    };
  }[];
  customerWalkInAt?: string | null;
  demoStartAt?: string | null;
  demoEndAt?: string | null;
  decisionAt?: string | null;
  productSelectionStartAt?: string | null;
  productSelectionConfirmedAt?: string | null;
  stockStartedAt?: string | null;
  stockFoundAt?: string | null;
  cashierReceivedAt?: string | null;
  cashierScanAt?: string | null;
  billOpenedAt?: string | null;
  cancelledAt?: string | null;
  accessories?: { accessoryName: string; quantity: number }[];
  ontop?: { name: string }[];
  points?: { name: string }[];
  burnPoints?: { name: string }[];
  payments?: { method: string }[];
  stockReview?: {
    missingItems?: string[];
    missingItemIds?: string[];
    foundItems?: string[];
    stockNote?: string | null;
    reportedAt?: string;
    reportedBy?: string;
    acknowledgedAt?: string | null;
    acknowledgedBy?: string | null;
  } | null;
  events?: {
    id: string;
    eventType: string;
    actorStaffId: string;
    createdAt: string;
    metadata?: Record<string, unknown> | null;
  }[];
}

export function mapApiSessionToMockSession(s: ApiSession): MockSession {
  const accessoriesMap: Record<string, string> = {};
  if (Array.isArray(s.accessories)) {
    for (const a of s.accessories) {
      accessoriesMap[a.accessoryName] = String(a.quantity);
    }
  }

  const timestamps: Partial<Record<Timestamp, string>> = {};
  if (s.customerWalkInAt) timestamps.customer_walk_in_at = s.customerWalkInAt;
  if (s.demoStartAt) timestamps.demo_start_at = s.demoStartAt;
  if (s.demoEndAt) timestamps.demo_end_at = s.demoEndAt;
  if (s.decisionAt) timestamps.decision_at = s.decisionAt;
  if (s.productSelectionStartAt) timestamps.product_selection_start_at = s.productSelectionStartAt;
  if (s.productSelectionConfirmedAt) timestamps.product_selection_confirmed_at = s.productSelectionConfirmedAt;
  if (s.stockStartedAt) timestamps.stock_started_at = s.stockStartedAt;
  if (s.stockFoundAt) timestamps.stock_found_at = s.stockFoundAt;
  if (s.cashierReceivedAt) timestamps.cashier_received_at = s.cashierReceivedAt;
  if (s.cashierScanAt) timestamps.cashier_scan_at = s.cashierScanAt;
  if (s.billOpenedAt) timestamps.bill_opened_at = s.billOpenedAt;
  if (s.cancelledAt) timestamps.cancelled_at = s.cancelledAt;

  return {
    id: s.id,
    reference: s.reference,
    queue:
      s.queueNo != null ? formatQueue(s.queueLetter, s.queueNo) : s.reference,
    customerTypeId: s.customerTypeId || undefined,
    customerTypeLetter: s.customerType?.letter || s.queueLetter || undefined,
    customerTypeName: s.customerType?.name || undefined,
    branchCode: s.branch?.code || s.branchId,
    branchName: s.branch?.name || '',
    phone: s.phone || '',
    staffId: s.staffId,
    state: s.state,
    confirmed: s.confirmed,
    outcome: s.outcome || undefined,
    reason: s.reason || undefined,
    otherReason: s.otherReason || undefined,
    cancelledBy: s.cancelledBy || undefined,
    timestamps,
    selection: {
      items: (s.items ?? []).map((item) => ({
        id: item.id,
        quantity: item.quantity,
        product: {
          id: item.sku.id,
          category: item.sku.model.product.category,
          product: item.sku.model.product.name,
          model: item.sku.name || item.sku.model.name,
          sku: item.sku.sku,
        },
      })),
      accessories: accessoriesMap,
      ontop: s.ontop ? s.ontop.map((o) => o.name) : [],
      points: s.points ? s.points.map((p) => p.name) : [],
      burnPoints: s.burnPoints ? s.burnPoints.map((b) => b.name) : [],
      payments: s.payments ? s.payments.map((p) => p.method) : [],
    },
    stockPendingReview: s.stockReview
      ? {
          missingItems: s.stockReview.missingItems || [],
          missingItemIds: s.stockReview.missingItemIds || [],
          foundItems: s.stockReview.foundItems || [],
          stockNote: s.stockReview.stockNote || undefined,
          reportedAt: s.stockReview.reportedAt || '',
          acknowledgedAt: s.stockReview.acknowledgedAt || undefined,
          acknowledgedBy: s.stockReview.acknowledgedBy || undefined,
        }
      : undefined,
    events: s.events,
  };
}

export async function fetchSessionsApi(branchId?: string): Promise<MockSession[]> {
  const query = branchId ? `?branchId=${encodeURIComponent(branchId)}` : '';
  const data = await api<ApiSession[]>(`/sessions${query}`);
  return data.map(mapApiSessionToMockSession);
}

/** D56/D57: a walk-in starts with the customer's phone number and a customer type; the server gives it the queue number. */
export async function createWalkInApi(
  branchId: string | undefined,
  phone: string,
  customerTypeId?: string,
): Promise<MockSession> {
  const data = await api<ApiSession>('/sessions', 'POST', {
    branchId,
    phone,
    customerTypeId,
  });
  return mapApiSessionToMockSession(data);
}

/** Global ADMIN switches (D59): everybody reads them, only ADMIN changes them. */
export function fetchSettingsApi(): Promise<AppSettings> {
  return api<AppSettings>('/settings');
}

export function saveStockUnlimitedApi(stockUnlimited: boolean): Promise<AppSettings> {
  return api<AppSettings>('/settings', 'PUT', { stockUnlimited });
}

/** Active customer types in letter order; `all` (ADMIN) includes the switched-off ones. */
export function fetchCustomerTypesApi(all = false): Promise<CustomerType[]> {
  return api<CustomerType[]>(`/customer-types${all ? '?all=true' : ''}`);
}

export function saveCustomerTypeApi(
  type: { letter?: string; name: string; description?: string | null; active?: boolean },
  existingId?: string,
): Promise<CustomerType> {
  return existingId
    ? api<CustomerType>(`/customer-types/${encodeURIComponent(existingId)}`, 'PUT', {
        name: type.name,
        description: type.description ?? null,
        active: type.active,
      })
    : api<CustomerType>('/customer-types', 'POST', {
        letter: type.letter || undefined,
        name: type.name,
        description: type.description || undefined,
      });
}

export async function advanceStepApi(id: string, action: string): Promise<MockSession> {
  const data = await api<ApiSession>(`/sessions/${encodeURIComponent(id)}/step`, 'POST', { action });
  return mapApiSessionToMockSession(data);
}

export async function recordNotBuyApi(id: string, reason: string, otherReason?: string): Promise<MockSession> {
  const data = await api<ApiSession>(`/sessions/${encodeURIComponent(id)}/decision/not-buy`, 'POST', {
    reason,
    otherReason,
  });
  return mapApiSessionToMockSession(data);
}

export async function updateSelectionApi(
  id: string,
  selection: Selection,
  phone: string,
): Promise<MockSession> {
  const accessoriesList = Object.entries(selection.accessories).map(([accessoryName, qty]) => ({
    accessoryName,
    quantity: parseInt(qty, 10) || 1,
  }));

  const payload: Record<string, unknown> = {
    phone,
    accessories: accessoriesList,
    ontop: selection.ontop,
    points: selection.points,
    burnPoints: selection.burnPoints,
    payments: selection.payments,
    // F3: the main products as a whole list (SKU id + quantity)
    items: selection.items.map((item) => ({
      skuId: item.product.id,
      quantity: item.quantity,
    })),
  };

  const data = await api<ApiSession>(`/sessions/${encodeURIComponent(id)}/selection`, 'PUT', payload);
  return mapApiSessionToMockSession(data);
}

export async function confirmPurchaseApi(id: string): Promise<MockSession> {
  const data = await api<ApiSession>(`/sessions/${encodeURIComponent(id)}/confirm`, 'POST');
  return mapApiSessionToMockSession(data);
}

export async function recordOutOfStockApi(
  id: string,
  reason?: string,
  otherReason?: string,
  outOfStockItems?: string[],
  action: 'cancel' | 'partial' = 'cancel',
  note?: string,
): Promise<MockSession> {
  const data = await api<ApiSession>(`/sessions/${encodeURIComponent(id)}/out-of-stock`, 'POST', {
    reason,
    otherReason,
    outOfStockItems,
    action,
    note,
  });
  return mapApiSessionToMockSession(data);
}

export async function cancelSessionApi(id: string, reason: string, otherReason?: string): Promise<MockSession> {
  const data = await api<ApiSession>(`/sessions/${encodeURIComponent(id)}/cancel`, 'POST', {
    reason,
    otherReason,
  });
  return mapApiSessionToMockSession(data);
}

export async function reportStockMissingApi(
  id: string,
  missingItems: string[],
  foundItems?: string[],
  stockNote?: string,
  missingItemIds?: string[],
): Promise<MockSession> {
  const data = await api<ApiSession>(`/sessions/${encodeURIComponent(id)}/stock/report-missing`, 'POST', {
    missingItems,
    foundItems,
    stockNote,
    missingItemIds,
  });
  return mapApiSessionToMockSession(data);
}

export async function resolveStockReviewApi(
  id: string,
  action: 'ACCEPT_PARTIAL' | 'CHANGE_ITEMS' | 'CANCEL',
  reason?: string,
  otherReason?: string,
): Promise<MockSession> {
  const data = await api<ApiSession>(`/sessions/${encodeURIComponent(id)}/staff/resolve-stock-review`, 'POST', {
    action,
    reason,
    otherReason,
  });
  return mapApiSessionToMockSession(data);
}

export async function fetchProductsApi(): Promise<Record<string, unknown>[]> {
  return api<Record<string, unknown>[]>('/products');
}

export async function acknowledgeManagerAlertApi(id: string): Promise<MockSession> {
  const data = await api<ApiSession>(`/sessions/${encodeURIComponent(id)}/manager/acknowledge-alert`, 'POST');
  return mapApiSessionToMockSession(data);
}

export interface AuditLogItem {
  id: string;
  timestamp: string;
  category: 'AUTH' | 'WORKFLOW' | 'STOCK' | 'ALERT';
  action: string;
  actionLabel: string;
  actorStaffId: string;
  actorName: string;
  branchName: string;
  sessionId?: string;
  sessionReference?: string;
  /** "A012" (D57): what staff call the customer by. */
  sessionQueue?: string;
  metadata?: Record<string, unknown> | null;
}

export async function fetchAuditLogsApi(limit = 200): Promise<AuditLogItem[]> {
  return api<AuditLogItem[]>(`/admin/audit-logs?limit=${encodeURIComponent(limit)}`);
}

