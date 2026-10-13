import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsString, Matches, MaxLength } from 'class-validator';

export class PaymentMethodCreateDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @Matches(/\S/)
  @MaxLength(64)
  name!: string;
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
