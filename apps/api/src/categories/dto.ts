import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

export class CategoryCreateDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @Matches(/\S/)
  @MaxLength(100)
  name!: string;

  /** accessory-like categories are not offered as a main product in the picker */
  @IsOptional()
  @IsBoolean()
  isAccessory?: boolean;
}

/** The name never changes (products store it); a category is switched on or off. */
export class CategoryUpdateDto {
  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @IsOptional()
  @IsBoolean()
  isAccessory?: boolean;
}

export class CategoryMoveDto {
  @IsIn(['up', 'down'])
  direction!: 'up' | 'down';
}
