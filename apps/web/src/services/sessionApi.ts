import { api } from './api';
import type {
  AppSettings,
  CustomerType,
  Category,
  PaymentMethod,
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
  branch?: {
    id: string;
    code: string;
    name: string;
    phone: string;
    registrationUrl?: string | null;
  };
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
  stockAckAt?: string | null;
  stockAckBy?: string | null;
  posBillNo?: string | null;
  posBillOpenedAt?: string | null;
  rebuyOf?: { id: string; reference: string } | null;
  rebuiltAs?: { id: string; reference: string } | null;
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
      s.queueNo != null ? formatQueue(s.queueLetter, s.queueNo) : (s.phone || s.reference),
    queueNo: s.queueNo,
    queueLetter: s.queueLetter,
    customerTypeId: s.customerTypeId || undefined,
    customerTypeLetter: s.customerType?.letter || s.queueLetter || undefined,
    customerTypeName: s.customerType?.name || undefined,
    branchCode: s.branch?.code || s.branchId,
    branchName: s.branch?.name || '',
    branchPhone: s.branch?.phone || undefined,
    branchRegistrationUrl: s.branch?.registrationUrl || undefined,
    phone: s.phone || '',
    staffId: s.staffId,
    state: s.state,
    confirmed: s.confirmed,
    outcome: s.outcome || undefined,
    reason: s.reason || undefined,
    otherReason: s.otherReason || undefined,
    cancelledBy: s.cancelledBy || undefined,
    posBillNo: s.posBillNo || undefined,
    posBillOpenedAt: s.posBillOpenedAt || undefined,
    stockAckAt: s.stockAckAt || undefined,
    stockAckBy: s.stockAckBy || undefined,
    rebuyOf: s.rebuyOf || undefined,
    rebuiltAs: s.rebuiltAs || undefined,
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

/** Payment methods in display order (F6); `all` (ADMIN) includes the switched-off ones. */
export function fetchPaymentMethodsApi(all = false): Promise<PaymentMethod[]> {
  return api<PaymentMethod[]>(`/payment-methods${all ? '?all=true' : ''}`);
}

export function createPaymentMethodApi(name: string, fmpType?: string): Promise<PaymentMethod> {
  return api<PaymentMethod>('/payment-methods', 'POST', fmpType ? { name, fmpType } : { name });
}

/** D89: files a payment method under an FMP payment type (`null` clears it). */
export function setPaymentMethodFmpTypeApi(id: string, fmpType: string | null): Promise<PaymentMethod> {
  return api<PaymentMethod>(`/payment-methods/${encodeURIComponent(id)}/fmp-type`, 'PUT', { fmpType });
}

export function setPaymentMethodActiveApi(id: string, active: boolean): Promise<PaymentMethod> {
  return api<PaymentMethod>(`/payment-methods/${encodeURIComponent(id)}`, 'PUT', { active });
}

export function movePaymentMethodApi(id: string, direction: 'up' | 'down'): Promise<PaymentMethod> {
  return api<PaymentMethod>(`/payment-methods/${encodeURIComponent(id)}/move`, 'POST', { direction });
}

/** Product categories in display order (D72); `all` (ADMIN) includes the switched-off ones with their product counts. */
export function fetchCategoriesApi(all = false): Promise<Category[]> {
  return api<Category[]>(`/categories${all ? '?all=true' : ''}`);
}

export function createCategoryApi(name: string, isAccessory: boolean): Promise<Category> {
  return api<Category>('/categories', 'POST', { name, isAccessory });
}

export function saveCategoryApi(
  id: string,
  patch: { active?: boolean; isAccessory?: boolean },
): Promise<Category> {
  return api<Category>(`/categories/${encodeURIComponent(id)}`, 'PUT', patch);
}

export function moveCategoryApi(id: string, direction: 'up' | 'down'): Promise<Category> {
  return api<Category>(`/categories/${encodeURIComponent(id)}/move`, 'POST', { direction });
}

export function reorderPaymentMethodsApi(ids: string[]): Promise<PaymentMethod[]> {
  return api<PaymentMethod[]>('/payment-methods/reorder', 'PUT', { ids });
}

/** Active customer types in letter order; `all` (ADMIN) includes the switched-off ones. */
export function fetchCustomerTypesApi(all = false): Promise<CustomerType[]> {
  return api<CustomerType[]>(`/customer-types${all ? '?all=true' : ''}`);
}

export function saveCustomerTypeApi(
  type: {
    letter?: string;
    name: string;
    description?: string | null;
    active?: boolean;
    paymentMethods?: string[];
    ontop?: string[];
    points?: string[];
    burnPoints?: string[];
  },
  existingId?: string,
): Promise<CustomerType> {
  return existingId
    ? api<CustomerType>(`/customer-types/${encodeURIComponent(existingId)}`, 'PUT', {
        name: type.name,
        description: type.description ?? null,
        active: type.active,
        paymentMethods: type.paymentMethods,
        ontop: type.ontop,
        points: type.points,
        burnPoints: type.burnPoints,
      })
    : api<CustomerType>('/customer-types', 'POST', {
        letter: type.letter || undefined,
        name: type.name,
        description: type.description || undefined,
        paymentMethods: type.paymentMethods,
        ontop: type.ontop,
        points: type.points,
        burnPoints: type.burnPoints,
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

/** F13: the cashier sends the order back to stock (wrong item picked). */
export async function cashierRejectApi(
  id: string,
  reason: string,
  otherReason?: string,
  wrongItems?: string[],
  wrongItemIds?: string[],
  wrongItemDetails?: Record<string, { reason: string; note?: string }>,
): Promise<MockSession> {
  const data = await api<ApiSession>(`/sessions/${encodeURIComponent(id)}/cashier/reject`, 'POST', {
    reason,
    otherReason,
    wrongItems,
    wrongItemIds,
    wrongItemDetails,
  });
  return mapApiSessionToMockSession(data);
}

/** D75: cashier removes damaged items and proceeds with the rest of the order. */
export async function cashierRemoveDamagedApi(
  id: string,
  itemIds: string[],
  note?: string,
): Promise<MockSession> {
  const data = await api<ApiSession>(`/sessions/${encodeURIComponent(id)}/cashier/remove-damaged`, 'POST', {
    itemIds,
    note,
  });
  return mapApiSessionToMockSession(data);
}

/** D78: Staff or Cashier changes an item (model, color, capacity) in the order and sends it to Stock. */
export async function changeSessionItemApi(
  id: string,
  oldItemId: string,
  newSkuId: string,
  reason: string,
  note?: string,
): Promise<MockSession> {
  const data = await api<ApiSession>(`/sessions/${encodeURIComponent(id)}/change-item`, 'POST', {
    oldItemId,
    newSkuId,
    reason,
    note,
  });
  return mapApiSessionToMockSession(data);
}

/** F12: stock confirms it has seen a cancel (and brought the goods back). */
export async function acknowledgeStockCancelApi(id: string): Promise<MockSession> {
  const data = await api<ApiSession>(`/sessions/${encodeURIComponent(id)}/stock/acknowledge-cancel`, 'POST');
  return mapApiSessionToMockSession(data);
}

/** F11: buy again after a "change" cancel: a new session with the old data and the old queue number. */
export async function rebuyApi(id: string): Promise<MockSession> {
  const data = await api<ApiSession>(`/sessions/${encodeURIComponent(id)}/rebuy`, 'POST');
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
  category: 'AUTH' | 'WORKFLOW' | 'STOCK' | 'ALERT' | 'ACCOUNT';
  action: string;
  actionLabel: string;
  actorStaffId: string;
  actorName: string;
  branchName: string;
  sessionId?: string;
  sessionReference?: string;
  /** "A012" (D57): what staff call the customer by. */
  sessionQueue?: string;
  /** D92: the account an ACCOUNT row is about. */
  targetStaffId?: string;
  targetName?: string;
  metadata?: Record<string, unknown> | null;
}

export async function fetchAuditLogsApi(limit = 200): Promise<AuditLogItem[]> {
  return api<AuditLogItem[]>(`/admin/audit-logs?limit=${encodeURIComponent(limit)}`);
}

