import { ProductCategory } from '@prisma/client';
import {
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class ProductCreateDto {
  @IsEnum(ProductCategory)
  category!: ProductCategory;

  @IsString()
  @MinLength(1)
  @MaxLength(191)
  name!: string;
}

export class ProductUpdateDto {
  @IsOptional()
  @IsEnum(ProductCategory)
  category?: ProductCategory;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(191)
  name?: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class ModelCreateDto {
  @IsString()
  @MinLength(1)
  @MaxLength(191)
  name!: string;
}

export class ModelUpdateDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(191)
  name?: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class SkuCreateDto {
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  sku!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(191)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  color?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  storage?: string;
}

export class SkuUpdateDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  sku?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(191)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  color?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  storage?: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
