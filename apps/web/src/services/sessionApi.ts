import { api } from './api';
import type {
  MockSession,
  Outcome,
  Selection,
  Timestamp,
  WorkflowState,
} from '../types/session';

export interface ApiSession {
  id: string;
  reference: string;
  branchId: string;
  branch?: { id: string; code: string; name: string; phone: string };
  staffId: string;
  customerId?: string | null;
  phone?: string | null;
  state: WorkflowState;
  confirmed: boolean;
  outcome?: Outcome | null;
  reason?: string | null;
  otherReason?: string | null;
  cancelledBy?: string | null;
  productId?: string | null;
  modelId?: string | null;
  skuId?: string | null;
  product?: { id: string; category: string; name: string } | null;
  model?: { id: string; name: string } | null;
  sku?: {
    id: string;
    sku: string;
    name: string;
    color?: string;
    storage?: string;
    model?: {
      id: string;
      name: string;
      product?: { id: string; category: string; name: string };
    };
  } | null;
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

  const resolvedCategory =
    s.product?.category ||
    s.sku?.model?.product?.category ||
    'iPhone';
  const resolvedProductName =
    s.product?.name ||
    s.sku?.model?.product?.name ||
    s.sku?.name ||
    '';
  const resolvedModelName =
    s.model?.name ||
    s.sku?.model?.name ||
    s.sku?.name ||
    '';

  const hasProduct = Boolean(s.product || s.sku || s.model || s.productId || s.skuId);

  return {
    id: s.id,
    reference: s.reference,
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
      product: hasProduct
        ? {
            id: s.sku?.id || s.productId || s.skuId || s.product?.id || '',
            category: resolvedCategory,
            product: resolvedProductName,
            model: resolvedModelName,
            sku: s.sku?.sku || '',
          }
        : null,
      accessories: accessoriesMap,
      ontop: s.ontop ? s.ontop.map((o) => o.name) : [],
      points: s.points ? s.points.map((p) => p.name) : [],
      burnPoints: s.burnPoints ? s.burnPoints.map((b) => b.name) : [],
      payments: s.payments ? s.payments.map((p) => p.method) : [],
    },
    events: s.events,
  };
}

export async function fetchSessionsApi(branchId?: string): Promise<MockSession[]> {
  const query = branchId ? `?branchId=${encodeURIComponent(branchId)}` : '';
  const data = await api<ApiSession[]>(`/sessions${query}`);
  return data.map(mapApiSessionToMockSession);
}

export async function createWalkInApi(branchId?: string): Promise<MockSession> {
  const data = await api<ApiSession>('/sessions', 'POST', { branchId });
  return mapApiSessionToMockSession(data);
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
  rawProductIds?: { productId?: string; modelId?: string; skuId?: string },
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
  };

  if (rawProductIds !== undefined) {
    payload.productId = rawProductIds.productId || null;
    payload.modelId = rawProductIds.modelId || null;
    payload.skuId = rawProductIds.skuId || null;
  } else if (selection.product) {
    if (selection.product.id) {
      payload.skuId = selection.product.id;
      payload.productId = selection.product.id;
    }
  }

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

export async function fetchProductsApi(): Promise<Record<string, unknown>[]> {
  return api<Record<string, unknown>[]>('/products');
}
