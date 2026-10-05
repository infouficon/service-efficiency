export type StepAction =
  | 'startDemo'
  | 'endDemo'
  | 'buy'
  | 'startSelection'
  | 'search'
  | 'found'
  | 'send'
  | 'receive'
  | 'scan'
  | 'bill'
  | 'complete';

export interface CreateSessionDto {
  branchId?: string;
}

export interface AdvanceStepDto {
  action: StepAction;
}

export interface NotBuyDto {
  reason: string;
  otherReason?: string;
}

export interface CancelSessionDto {
  reason: string;
  otherReason?: string;
}

export interface OutOfStockDto {
  reason?: string;
  otherReason?: string;
  outOfStockItems?: string[];
  action?: 'cancel' | 'partial';
  note?: string;
}

export interface AccessorySelectionDto {
  accessoryName: string;
  quantity: number;
}

export interface UpdateSelectionDto {
  phone?: string;
  productId?: string | null;
  modelId?: string | null;
  skuId?: string | null;
  accessories?: AccessorySelectionDto[];
  ontop?: string[];
  points?: string[];
  burnPoints?: string[];
  payments?: string[];
}

export interface ReportStockMissingDto {
  missingItems: string[];
  foundItems?: string[];
  stockNote?: string;
}

export interface ResolveStockReviewDto {
  action: 'ACCEPT_PARTIAL' | 'CHANGE_ITEMS' | 'CANCEL';
  reason?: string;
  otherReason?: string;
}

