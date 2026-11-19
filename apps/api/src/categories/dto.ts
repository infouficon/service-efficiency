import { Transform, Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';

export class CategoryAttributeSpecDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @Matches(/\S/)
  @MaxLength(64)
  key!: string;

  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @Matches(/\S/)
  @MaxLength(100)
  label!: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  options?: string[];

  @IsOptional()
  @IsBoolean()
  required?: boolean;
}

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

  /** D142: specification templates for this category */
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CategoryAttributeSpecDto)
  attributes?: CategoryAttributeSpecDto[];
}

/** The name never changes (products store it); a category is switched on or off. */
export class CategoryUpdateDto {
  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @IsOptional()
  @IsBoolean()
  isAccessory?: boolean;

  /** D142: specification templates for this category */
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CategoryAttributeSpecDto)
  attributes?: CategoryAttributeSpecDto[];
}

export class CategoryMoveDto {
  @IsIn(['up', 'down'])
  direction!: 'up' | 'down';
}
