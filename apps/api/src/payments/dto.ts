import { Transform } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { FMP_PAYMENT_TYPES } from './payments.service';

export class PaymentMethodCreateDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @Matches(/\S/)
  @MaxLength(64)
  name!: string;

  /** D89: the FMP payment type to file the new method under (optional; unset is sent to FileMaker as "อื่นๆ"). */
  @IsOptional()
  @IsIn(FMP_PAYMENT_TYPES)
  fmpType?: string;
}

/** The name never changes (it is what sessions store); a method is only switched on or off. */
export class PaymentMethodUpdateDto {
  @IsBoolean()
  active!: boolean;
}

export class PaymentMethodMoveDto {
  @IsIn(['up', 'down'])
  direction!: 'up' | 'down';
}

export class PaymentMethodReorderDto {
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  ids!: string[];
}

/** D89: `fmpType` must be sent; null clears the type, a missing key is rejected. */
export class PaymentMethodFmpTypeDto {
  @ValidateIf((_, value: unknown) => value !== null)
  @IsIn(FMP_PAYMENT_TYPES)
  fmpType!: string | null;
}
