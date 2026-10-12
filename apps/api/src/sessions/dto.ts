import { Type } from 'class-transformer';
import {
  IsArray,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
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

export class UpdateSelectionDto {
  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  productId?: string | null;

  @IsOptional()
  @IsString()
  modelId?: string | null;

  @IsOptional()
  @IsString()
  skuId?: string | null;

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
  @IsArray()
  @IsString({ each: true })
  missingItems!: string[];

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
