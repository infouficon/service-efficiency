import { RoleCode } from '@prisma/client';
import { ArrayNotEmpty, ArrayUnique, IsArray, IsIn, IsInt, IsOptional, IsString, MaxLength, Min, MinLength } from 'class-validator';

/** D87: one person picked by hand for the ERP import. */
export class ErpExtraDto {
  @IsInt() @Min(1) erpStaffId!: number;
  @IsArray() @ArrayNotEmpty() @ArrayUnique() @IsIn(['STAFF', 'STOCK', 'CASHIER'], { each: true }) roles!: RoleCode[];
  @IsString() @MinLength(1) @MaxLength(36) branchId!: string;
  @IsOptional() @IsString() @MaxLength(191) note?: string;
}
