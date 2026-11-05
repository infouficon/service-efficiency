import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export const STEP_ACTIONS = [
  'startDemo',
  'endDemo',
  'buy',
  'startSelection',
  'search',
  'found',
  'send',
  // D105: no receive / scan / bill: the cashiers work in U POS, which reports the bill and the payment (/integrations/pos/bills).
  // `complete` is ADMIN's fallback while U POS reports nothing.
  'complete',
] as const;

export type StepAction = (typeof STEP_ACTIONS)[number];

export class CreateSessionDto {
  @IsOptional()
  @IsString()
  branchId?: string;

  /** D56: a walk-in starts at the customer's phone number: exactly 10 ASCII digits. */
  @IsString()
  @Matches(/^[0-9]{10}$/, {
    message: 'Phone number must contain exactly 10 digits (0-9)',
  })
  phone!: string;

  /** D57: the customer type picked at the phone step. Left out, the active type with the lowest letter is used. */
  @IsOptional()
  @IsString()
  @MaxLength(36)
  customerTypeId?: string;
}

/** D92: the serial numbers scanned for one main product (`itemId` = the SessionItem), exactly `quantity` of them. */
export class StepSerialsDto {
  @IsString()
  @MaxLength(36)
  itemId!: string;

  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @MaxLength(64, { each: true })
  sn!: string[];
}

/** D101: one serial number STOCK just scanned for one main product (the order's SessionItem). */
export class AddSerialDto {
  @IsString()
  @MaxLength(36)
  itemId!: string;

  @IsString()
  @MaxLength(80)
  sn!: string;
}

export class AdvanceStepDto {
  @IsIn(STEP_ACTIONS)
  action!: StepAction;

  /** D92: for `send`: the serial numbers; left out (D101), the ones STOCK scanned while searching are used and must be complete. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => StepSerialsDto)
  serials?: StepSerialsDto[];

  /**
   * D103: for `send` with the saved serials: send even when some units have no serial yet (the unit is in the shop but FileMaker
   * does not have it here yet, e.g. a transfer not received). The missing ones are scanned in FileMaker later.
   */
  @IsOptional()
  @IsBoolean()
  serialsLater?: boolean;
}

export class NotBuyDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(191)
  reason!: string;

  @IsOptional()
  @IsString()
  otherReason?: string;
}

export class CancelSessionDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(191)
  reason!: string;

  @IsOptional()
  @IsString()
  otherReason?: string;
}

/** F13: the cashier sends an order back to stock; the reason is required (`อื่น ๆ` needs text, like every other reason). */
export class CashierRejectDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(191)
  reason!: string;

  @IsOptional()
  @IsString()
  otherReason?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  wrongItems?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  wrongItemIds?: string[];

  @IsOptional()
  @IsObject()
  wrongItemDetails?: Record<string, { reason: string; note?: string }>;
}

export class OutOfStockDto {
  @IsOptional()
  @IsString()
  reason?: string;

  @IsOptional()
  @IsString()
  otherReason?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  outOfStockItems?: string[];

  @IsOptional()
  @IsIn(['cancel', 'partial'])
  action?: 'cancel' | 'partial';

  @IsOptional()
  @IsString()
  note?: string;
}

export class AccessorySelectionDto {
  @IsString()
  @IsNotEmpty()
  accessoryName!: string;

  @IsInt()
  @Min(1)
  quantity!: number;
}

/** One main product of a session (F3): a SKU (its id or its SKU code) and how many. */
export class SessionItemDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  skuId!: string;

  @IsInt()
  @Min(1)
  quantity!: number;
}

export class UpdateSelectionDto {
  @IsOptional()
  @IsString()
  phone?: string;

  /** The main products as a whole list; left out, the current ones stay. An empty list clears them. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => SessionItemDto)
  items?: SessionItemDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AccessorySelectionDto)
  accessories?: AccessorySelectionDto[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  ontop?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  points?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  burnPoints?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  payments?: string[];
}

export class ReportStockMissingDto {
  /** What is missing, as text for the review and the history (accessories are matched by this name). */
  @IsArray()
  @IsString({ each: true })
  missingItems!: string[];

  /** F3: the ids of the missing main products (`SessionItem.id`). Left out, they are matched by name, as before F3. */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  missingItemIds?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  foundItems?: string[];

  @IsOptional()
  @IsString()
  stockNote?: string;
}

export class ResolveStockReviewDto {
  @IsIn(['ACCEPT_PARTIAL', 'CHANGE_ITEMS', 'CANCEL'])
  action!: 'ACCEPT_PARTIAL' | 'CHANGE_ITEMS' | 'CANCEL';

  @IsOptional()
  @IsString()
  reason?: string;

  @IsOptional()
  @IsString()
  otherReason?: string;
}

export class ChangeSessionItemDto {
  @IsString()
  @IsNotEmpty()
  oldItemId!: string;

  @IsString()
  @IsNotEmpty()
  newSkuId!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(191)
  reason!: string;

  @IsOptional()
  @IsString()
  note?: string;
}
