import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  ValidateIf,
} from 'class-validator';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class CustomerTypeCreateDto {
  /** A-Z. Left out, the next free letter is taken, so types fill A, B, C... in order. */
  @IsOptional()
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @Matches(/^[A-Z]$/, { message: 'letter ต้องเป็นตัวอักษร A-Z หนึ่งตัว' })
  letter?: string;

  @Transform(trim)
  @IsString()
  @Matches(/\S/)
  @MaxLength(64)
  name!: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(191)
  description?: string;
}

/** The letter never changes after creation: queue numbers already given out carry it. */
export class CustomerTypeUpdateDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Matches(/\S/)
  @MaxLength(64)
  name?: string;

  @IsOptional()
  @ValidateIf((_object, value) => value !== null)
  @Transform(trim)
  @IsString()
  @MaxLength(191)
  description?: string | null;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
