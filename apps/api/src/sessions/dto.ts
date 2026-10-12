import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsNotEmpty,
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
  'receive',
  'scan',
  'bill',
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

export class AdvanceStepDto {
  @IsIn(STEP_ACTIONS)
  action!: StepAction;
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
