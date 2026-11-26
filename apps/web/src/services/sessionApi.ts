import { api } from './api';
import type {
  AppSettings,
  CustomerType,
  Category,
  CustomerSource,
  DiscountType,
  PaymentCardOption,
  PaymentMethod,
  MockSession,
  Outcome,
  ReceiptType,
  Selection,
  Timestamp,
  WorkflowState,
  FmpStatus,
  FmpPushMode,
  SurveyQuestion,
  SurveyResponseItem,
  SurveyTarget,
  SurveyAnswer,
} from '../types/session';
import { formatQueue, isTaxInvoiceReceipt } from '../features/session/workflow';

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
  vatRefund?: boolean | null;
  taxInvoice?: boolean | null;
  receiptType?: ReceiptType | null;
  discountType?: DiscountType | null;
  customerSource?: CustomerSource | null;
  fmp?: FmpStatus | null;
  rebuyOf?: { id: string; reference: string } | null;
  rebuiltAs?: { id: string; reference: string } | null;
  /** F3: the main products, each with its SKU, model and product. */
  items?: {
    id: string;
    skuId: string;
    quantity: number;
    deducted: number;
    serials?: { id: string; sn: string; position: number }[];
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
  payments?: {
    method: string;
    cardType?: string | null;
    installmentMonths?: number | null;
  }[];
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
  surveyResponses?: SurveyResponseItem[];
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
  if (s.productSelectionStartAt)
    timestamps.product_selection_start_at = s.productSelectionStartAt;
  if (s.productSelectionConfirmedAt)
    timestamps.product_selection_confirmed_at = s.productSelectionConfirmedAt;
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
      s.queueNo != null
        ? formatQueue(s.queueLetter, s.queueNo)
        : s.phone || s.reference,
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
    vatRefund: Boolean(s.vatRefund),
    taxInvoice: isTaxInvoiceReceipt(s.receiptType, Boolean(s.taxInvoice)),
    receiptType: s.receiptType ?? null,
    discountType: s.discountType ?? null,
    customerSource: s.customerSource ?? null,
    fmp: s.fmp ?? null,
    stockAckAt: s.stockAckAt || undefined,
    stockAckBy: s.stockAckBy || undefined,
    rebuyOf: s.rebuyOf || undefined,
    rebuiltAs: s.rebuiltAs || undefined,
    timestamps,
    selection: {
      items: (s.items ?? []).map((item) => ({
        id: item.id,
        quantity: item.quantity,
        serials: (item.serials ?? []).map((x) => ({ id: x.id, sn: x.sn })),
        product: {
          id: item.sku.id,
          category: item.sku.model.product.category,
          product: item.sku.model.product.name,
          model: item.sku.name || item.sku.model.name,
          modelName: item.sku.model.name,
          sku: item.sku.sku,
        },
      })),
      accessories: accessoriesMap,
      ontop: s.ontop ? s.ontop.map((o) => o.name) : [],
      points: s.points ? s.points.map((p) => p.name) : [],
      burnPoints: s.burnPoints ? s.burnPoints.map((b) => b.name) : [],
      payments: s.payments ? s.payments.map((p) => p.method) : [],
      paymentDetails: s.payments
        ? s.payments.map((p) => ({
            method: p.method,
            cardType: p.cardType ?? undefined,
            installmentMonths: p.installmentMonths ?? undefined,
          }))
        : [],
      vatRefund: Boolean(s.vatRefund),
      taxInvoice: isTaxInvoiceReceipt(s.receiptType, Boolean(s.taxInvoice)),
      receiptType: s.receiptType ?? null,
      discountType: s.discountType ?? null,
      customerSource: s.customerSource ?? null,
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
    surveyResponses: s.surveyResponses,
    recommendationsReviewed: Boolean(
      (s as unknown as Record<string, unknown>).recommendationsReviewed,
    ),
    recommendationRecords: (s as unknown as Record<string, unknown>)
      .recommendationRecords as MockSession['recommendationRecords'],
    currentAppleDevices: (() => {
      const createdEvt = (s.events ?? []).find(
        (e) => e.eventType === 'SESSION_CREATED',
      );
      const meta = createdEvt?.metadata as Record<string, unknown> | undefined;
      return Array.isArray(meta?.currentAppleDevices) &&
        meta.currentAppleDevices.length > 0
        ? (meta.currentAppleDevices as string[])
        : undefined;
    })(),
  };
}

export async function fetchSessionsApi(
  branchId?: string,
): Promise<MockSession[]> {
  const query = branchId ? `?branchId=${encodeURIComponent(branchId)}` : '';
  const data = await api<ApiSession[]>(`/sessions${query}`);
  return data.map(mapApiSessionToMockSession);
}

/** D135: Look up customer's previous Apple devices by phone number. */
export async function fetchCustomerHistoryApi(
  phone: string,
): Promise<{ phone: string; currentAppleDevices: string[] | null }> {
  if (!phone || !phone.trim()) {
    return { phone: '', currentAppleDevices: null };
  }
  return api<{ phone: string; currentAppleDevices: string[] | null }>(
    `/sessions/customer-history?phone=${encodeURIComponent(phone.trim())}`,
  );
}

/** D56/D57/D131/D132: a walk-in starts with the customer's interested product(s) and phone number; the server gives it the queue number. */
export async function createWalkInApi(
  branchId: string | undefined,
  phone: string,
  customerTypeId?: string,
  skuId?: string,
  skuIds?: string[],
): Promise<MockSession> {
  const data = await api<ApiSession>('/sessions', 'POST', {
    branchId,
    phone,
    customerTypeId,
    skuId,
    skuIds,
  });
  return mapApiSessionToMockSession(data);
}

/** Global ADMIN switches (D59): everybody reads them, only ADMIN changes them. */
export function fetchSettingsApi(): Promise<AppSettings> {
  return api<AppSettings>('/settings');
}

export function saveStockUnlimitedApi(
  stockUnlimited: boolean,
): Promise<AppSettings> {
  return api<AppSettings>('/settings', 'PUT', { stockUnlimited });
}

/** D130: ADMIN only. 400 when the chosen FileMaker (FMP_* / FMP_UAT_*) is not set on the server. */
export function saveFmpPushModeApi(
  mode: FmpPushMode,
): Promise<{
  mode: FmpPushMode;
  updatedAt: string | null;
  updatedBy: string | null;
}> {
  return api('/admin/fmp/mode', 'PUT', { mode });
}

/** Payment methods in display order (F6); `all` (ADMIN) includes the switched-off ones. */
export function fetchPaymentMethodsApi(all = false): Promise<PaymentMethod[]> {
  return api<PaymentMethod[]>(`/payment-methods${all ? '?all=true' : ''}`);
}

export function createPaymentMethodApi(
  name: string,
  fmpType?: string,
): Promise<PaymentMethod> {
  return api<PaymentMethod>(
    '/payment-methods',
    'POST',
    fmpType ? { name, fmpType } : { name },
  );
}

/** D89: files a payment method under an FMP payment type (`null` clears it). */
export function setPaymentMethodFmpTypeApi(
  id: string,
  fmpType: string | null,
): Promise<PaymentMethod> {
  return api<PaymentMethod>(
    `/payment-methods/${encodeURIComponent(id)}/fmp-type`,
    'PUT',
    { fmpType },
  );
}

export function setPaymentMethodActiveApi(
  id: string,
  active: boolean,
): Promise<PaymentMethod> {
  return api<PaymentMethod>(
    `/payment-methods/${encodeURIComponent(id)}`,
    'PUT',
    { active },
  );
}

export function movePaymentMethodApi(
  id: string,
  direction: 'up' | 'down',
): Promise<PaymentMethod> {
  return api<PaymentMethod>(
    `/payment-methods/${encodeURIComponent(id)}/move`,
    'POST',
    { direction },
  );
}

/** Product categories in display order (D72); `all` (ADMIN) includes the switched-off ones with their product counts. */
export function fetchCategoriesApi(all = false): Promise<Category[]> {
  return api<Category[]>(`/categories${all ? '?all=true' : ''}`);
}

export function createCategoryApi(
  name: string,
  isAccessory: boolean,
): Promise<Category> {
  return api<Category>('/categories', 'POST', { name, isAccessory });
}

export function saveCategoryApi(
  id: string,
  patch: { active?: boolean; isAccessory?: boolean; attributes?: Category['attributes'] },
): Promise<Category> {
  return api<Category>(`/categories/${encodeURIComponent(id)}`, 'PUT', patch);
}

export function moveCategoryApi(
  id: string,
  direction: 'up' | 'down',
): Promise<Category> {
  return api<Category>(`/categories/${encodeURIComponent(id)}/move`, 'POST', {
    direction,
  });
}

export function reorderPaymentMethodsApi(
  ids: string[],
): Promise<PaymentMethod[]> {
  return api<PaymentMethod[]>('/payment-methods/reorder', 'PUT', { ids });
}

/** D127: card options for payment methods (e.g. Full Credit Card, 0% Credit Card) */
export function createPaymentCardOptionApi(
  paymentMethodId: string,
  name: string,
  installmentMonths?: number[] | null,
): Promise<PaymentCardOption> {
  return api<PaymentCardOption>(
    `/payment-methods/${encodeURIComponent(paymentMethodId)}/cards`,
    'POST',
    { name, installmentMonths },
  );
}

export function updatePaymentCardOptionApi(
  cardId: string,
  data: {
    name?: string;
    active?: boolean;
    installmentMonths?: number[] | null;
  },
): Promise<PaymentCardOption> {
  return api<PaymentCardOption>(
    `/payment-methods/cards/${encodeURIComponent(cardId)}`,
    'PUT',
    data,
  );
}

export function deletePaymentCardOptionApi(
  cardId: string,
): Promise<PaymentCardOption> {
  return api<PaymentCardOption>(
    `/payment-methods/cards/${encodeURIComponent(cardId)}`,
    'DELETE',
  );
}

export function reorderPaymentCardOptionsApi(
  paymentMethodId: string,
  ids: string[],
): Promise<PaymentCardOption[]> {
  return api<PaymentCardOption[]>(
    `/payment-methods/${encodeURIComponent(paymentMethodId)}/cards/reorder`,
    'PUT',
    { ids },
  );
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
    ? api<CustomerType>(
        `/customer-types/${encodeURIComponent(existingId)}`,
        'PUT',
        {
          name: type.name,
          description: type.description ?? null,
          active: type.active,
          paymentMethods: type.paymentMethods,
          ontop: type.ontop,
          points: type.points,
          burnPoints: type.burnPoints,
        },
      )
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

/** `send` takes the serial numbers STOCK already scanned one by one (D101); the server refuses it until they are complete (D111). */
export async function advanceStepApi(
  id: string,
  action: string,
): Promise<MockSession> {
  const data = await api<ApiSession>(
    `/sessions/${encodeURIComponent(id)}/step`,
    'POST',
    { action },
  );
  return mapApiSessionToMockSession(data);
}

/** D101: one serial number STOCK just scanned at the shelf, saved at once with the server time. */
export async function addSerialApi(
  id: string,
  itemId: string,
  sn: string,
): Promise<MockSession> {
  const data = await api<ApiSession>(
    `/sessions/${encodeURIComponent(id)}/serials`,
    'POST',
    { itemId, sn },
  );
  return mapApiSessionToMockSession(data);
}

/** D101: takes back a wrong scan so the right unit can be scanned. */
export async function removeSerialApi(
  id: string,
  serialId: string,
): Promise<MockSession> {
  const data = await api<ApiSession>(
    `/sessions/${encodeURIComponent(id)}/serials/${encodeURIComponent(serialId)}`,
    'DELETE',
  );
  return mapApiSessionToMockSession(data);
}

export async function recordNotBuyApi(
  id: string,
  reason: string,
  otherReason?: string,
): Promise<MockSession> {
  const data = await api<ApiSession>(
    `/sessions/${encodeURIComponent(id)}/decision/not-buy`,
    'POST',
    {
      reason,
      otherReason,
    },
  );
  return mapApiSessionToMockSession(data);
}

export async function updateSelectionApi(
  id: string,
  selection: Selection,
  phone: string,
  currentAppleDevices?: string[],
  recommendationRecords?: MockSession['recommendationRecords'],
): Promise<MockSession> {
  const accessoriesList = Object.entries(selection.accessories).map(
    ([accessoryName, qty]) => ({
      accessoryName,
      quantity: parseInt(qty, 10) || 1,
    }),
  );

  const payload: Record<string, unknown> = {
    phone: phone && phone.trim() ? phone.trim() : undefined,
    accessories: accessoriesList,
    ontop: selection.ontop,
    points: selection.points,
    burnPoints: selection.burnPoints,
    payments: selection.payments,
    paymentDetails: selection.paymentDetails,
    vatRefund: Boolean(selection.vatRefund),
    taxInvoice: isTaxInvoiceReceipt(
      selection.receiptType,
      Boolean(selection.taxInvoice),
    ),
    receiptType: selection.receiptType ?? undefined,
    discountType: selection.discountType ?? undefined,
    customerSource: selection.customerSource ?? undefined,
    currentAppleDevices,
    recommendationRecords,
    // F3: the main products as a whole list (SKU id + quantity)
    items: selection.items.map((item) => ({
      skuId: item.product.id,
      quantity: item.quantity,
    })),
  };

  const data = await api<ApiSession>(
    `/sessions/${encodeURIComponent(id)}/selection`,
    'PUT',
    payload,
  );
  return mapApiSessionToMockSession(data);
}

export async function confirmPurchaseApi(id: string): Promise<MockSession> {
  const data = await api<ApiSession>(
    `/sessions/${encodeURIComponent(id)}/confirm`,
    'POST',
  );
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
  const data = await api<ApiSession>(
    `/sessions/${encodeURIComponent(id)}/out-of-stock`,
    'POST',
    {
      reason,
      otherReason,
      outOfStockItems,
      action,
      note,
    },
  );
  return mapApiSessionToMockSession(data);
}

export async function cancelSessionApi(
  id: string,
  reason: string,
  otherReason?: string,
): Promise<MockSession> {
  const data = await api<ApiSession>(
    `/sessions/${encodeURIComponent(id)}/cancel`,
    'POST',
    {
      reason,
      otherReason,
    },
  );
  return mapApiSessionToMockSession(data);
}

/** F13/D105: STAFF sends the order back to stock (wrong item picked); the path keeps its old name. */
export async function returnToStockApi(
  id: string,
  reason: string,
  otherReason?: string,
  wrongItems?: string[],
  wrongItemIds?: string[],
  wrongItemDetails?: Record<string, { reason: string; note?: string }>,
): Promise<MockSession> {
  const data = await api<ApiSession>(
    `/sessions/${encodeURIComponent(id)}/cashier/reject`,
    'POST',
    {
      reason,
      otherReason,
      wrongItems,
      wrongItemIds,
      wrongItemDetails,
    },
  );
  return mapApiSessionToMockSession(data);
}

/** D78: Staff changes an item (model, color, capacity) in the order and sends it to Stock. */
export async function changeSessionItemApi(
  id: string,
  oldItemId: string,
  newSkuId: string,
  reason: string,
  note?: string,
): Promise<MockSession> {
  const data = await api<ApiSession>(
    `/sessions/${encodeURIComponent(id)}/change-item`,
    'POST',
    {
      oldItemId,
      newSkuId,
      reason,
      note,
    },
  );
  return mapApiSessionToMockSession(data);
}

/** F12: stock confirms it has seen a cancel (and brought the goods back). */
export async function acknowledgeStockCancelApi(
  id: string,
): Promise<MockSession> {
  const data = await api<ApiSession>(
    `/sessions/${encodeURIComponent(id)}/stock/acknowledge-cancel`,
    'POST',
  );
  return mapApiSessionToMockSession(data);
}

/** F11: buy again after a "change" cancel: a new session with the old data and the old queue number. */
export async function rebuyApi(id: string): Promise<MockSession> {
  const data = await api<ApiSession>(
    `/sessions/${encodeURIComponent(id)}/rebuy`,
    'POST',
  );
  return mapApiSessionToMockSession(data);
}

export async function reportStockMissingApi(
  id: string,
  missingItems: string[],
  foundItems?: string[],
  stockNote?: string,
  missingItemIds?: string[],
): Promise<MockSession> {
  const data = await api<ApiSession>(
    `/sessions/${encodeURIComponent(id)}/stock/report-missing`,
    'POST',
    {
      missingItems,
      foundItems,
      stockNote,
      missingItemIds,
    },
  );
  return mapApiSessionToMockSession(data);
}

export async function resolveStockReviewApi(
  id: string,
  action: 'ACCEPT_PARTIAL' | 'CHANGE_ITEMS' | 'CANCEL',
  reason?: string,
  otherReason?: string,
): Promise<MockSession> {
  const data = await api<ApiSession>(
    `/sessions/${encodeURIComponent(id)}/staff/resolve-stock-review`,
    'POST',
    {
      action,
      reason,
      otherReason,
    },
  );
  return mapApiSessionToMockSession(data);
}

export async function fetchProductsApi(): Promise<Record<string, unknown>[]> {
  return api<Record<string, unknown>[]>('/products');
}

export async function acknowledgeManagerAlertApi(
  id: string,
): Promise<MockSession> {
  const data = await api<ApiSession>(
    `/sessions/${encodeURIComponent(id)}/manager/acknowledge-alert`,
    'POST',
  );
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
  return api<AuditLogItem[]>(
    `/admin/audit-logs?limit=${encodeURIComponent(limit)}`,
  );
}

/** D183: the units of one model FileMaker has ready in one branch; `taken` = which open SES order holds it ("ออเดอร์นี้", "คิว 012", ...). */
export interface BranchUnits {
  count: number;
  more: boolean;
  units: { sn: string; taken: string | null }[];
}

/**
 * D104: one scanned serial against FileMaker live. D183: the FileMaker orders go to (always on while that is the test FileMaker;
 * the real one only with `SERIAL_CHECK=fmp`); not ready here = also what the branch has of that model.
 */
export type SerialCheck =
  | { status: 'off' | 'unavailable'; reason: string }
  | {
      status: 'ok';
      source: 'fmp';
      target?: 'PRODUCTION' | 'UAT';
      asOf: string | null;
      sn: string;
      verdict:
        'here' | 'not-ready' | 'other-branch' | 'not-in-stock' | 'other-model';
      branchCode?: string | null;
      branchName?: string | null;
      stockStatus?: string;
      model?: string;
      branchUnits?: BranchUnits;
    };

export async function serialCheckApi(
  sn: string,
  part?: string,
  session?: string,
): Promise<SerialCheck> {
  const query = new URLSearchParams({
    sn,
    ...(part ? { part } : {}),
    ...(session ? { session } : {}),
  });
  return api<SerialCheck>(`/stock/serial-check?${query}`);
}

/** D140: Fetch survey questions. `all=true` for ADMIN management. */
export async function fetchSurveyQuestionsApi(
  target?: SurveyTarget,
  all = false,
): Promise<SurveyQuestion[]> {
  const params = new URLSearchParams();
  if (target) params.set('target', target);
  if (all) params.set('all', 'true');
  const qs = params.toString() ? `?${params.toString()}` : '';
  return api<SurveyQuestion[]>(`/surveys/questions${qs}`);
}

export async function createSurveyQuestionApi(
  data: Partial<SurveyQuestion> & {
    target: SurveyTarget;
    title: string;
    questionType: string;
  },
): Promise<SurveyQuestion> {
  return api<SurveyQuestion>('/surveys/questions', 'POST', data);
}

export async function updateSurveyQuestionApi(
  id: string,
  data: Partial<SurveyQuestion>,
): Promise<SurveyQuestion> {
  return api<SurveyQuestion>(
    `/surveys/questions/${encodeURIComponent(id)}`,
    'PUT',
    data,
  );
}

export async function deleteSurveyQuestionApi(
  id: string,
): Promise<SurveyQuestion> {
  return api<SurveyQuestion>(
    `/surveys/questions/${encodeURIComponent(id)}`,
    'DELETE',
  );
}

export async function moveSurveyQuestionApi(
  id: string,
  direction: 'UP' | 'DOWN',
): Promise<SurveyQuestion[]> {
  return api<SurveyQuestion[]>(
    `/surveys/questions/${encodeURIComponent(id)}/move`,
    'POST',
    { direction },
  );
}

export async function reorderSurveyQuestionsApi(
  target: SurveyTarget,
  orderedIds: string[],
): Promise<SurveyQuestion[]> {
  return api<SurveyQuestion[]>('/surveys/questions/reorder', 'POST', {
    target,
    orderedIds,
  });
}

export async function submitSurveyResponseApi(data: {
  sessionId: string;
  target: SurveyTarget;
  completed?: boolean;
  unboughtProducts?: string[];
  answers: SurveyAnswer[];
}): Promise<SurveyResponseItem> {
  return api<SurveyResponseItem>('/surveys/responses', 'POST', data);
}

export async function fetchSurveyResponsesApi(query: {
  target?: SurveyTarget;
  sessionId?: string;
  limit?: number;
}): Promise<SurveyResponseItem[]> {
  const params = new URLSearchParams();
  if (query.target) params.set('target', query.target);
  if (query.sessionId) params.set('sessionId', query.sessionId);
  if (query.limit) params.set('limit', String(query.limit));
  const qs = params.toString() ? `?${params.toString()}` : '';
  return api<SurveyResponseItem[]>(`/surveys/responses${qs}`);
}

export type BranchUnitsAnswer =
  | { status: 'off' | 'unavailable'; reason: string }
  | ({
      status: 'ok';
      source: 'fmp';
      target: 'PRODUCTION' | 'UAT';
      asOf: string;
      model: string;
      branchCode: string;
    } & BranchUnits);

/**
 * D183: what a FileMaker has ready of one model in a branch: `target` = the FileMaker the bill went to, `session` = the order looking
 * (its own units say so). An ADMIN names the branch; everyone else gets their own.
 */
export async function branchUnitsApi(
  part: string,
  opts: {
    branch?: string | null;
    target?: 'PRODUCTION' | 'UAT' | null;
    session?: string | null;
  } = {},
): Promise<BranchUnitsAnswer> {
  const query = new URLSearchParams({ part });
  if (opts.branch) query.set('branch', opts.branch);
  if (opts.target) query.set('target', opts.target);
  if (opts.session) query.set('session', opts.session);
  return api<BranchUnitsAnswer>(`/stock/branch-units?${query}`);
}
