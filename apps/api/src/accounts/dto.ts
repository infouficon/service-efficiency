import {
  ArrayMaxSize,
  ArrayNotEmpty,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { RoleCode } from '@prisma/client';
export class LoginDto {
  @IsString() @MinLength(1) @MaxLength(64) staffId!: string;
  @IsString() @MinLength(1) @MaxLength(128) password!: string;
}
export class ChangePasswordDto {
  @IsString() @MinLength(1) @MaxLength(128) currentPassword!: string;
  @IsString() @MinLength(8) @MaxLength(128) newPassword!: string;
}
export class ResetPasswordDto {
  @IsString() @MinLength(8) @MaxLength(128) password!: string;
}
/** A Thai mobile number as 10 digits; `null` clears it (D85: where the login OTP goes). */
export const PHONE_PATTERN = /^0[689]\d{8}$/;
export class StaffUpdateDto {
  @IsString()
  @MaxLength(100)
  firstName?: string;

  @IsString()
  @MaxLength(100)
  lastName?: string;

  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @IsIn(Object.values(RoleCode), { each: true })
  roles!: RoleCode[];
  @ValidateIf((_object, value) => value !== null)
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  branchId!: string | null;
  @IsBoolean() active!: boolean;
  /** omit = unchanged; null = clear. ERP accounts cannot be changed here (their phone is the ERP's tel). */
  @IsOptional()
  @IsString()
  @Matches(PHONE_PATTERN, { message: 'เบอร์โทรต้องเป็นเบอร์มือถือ 10 หลัก เช่น 0812345678' })
  phone?: string | null;
}
export class StaffCreateDto extends StaffUpdateDto {
  @IsString() @MinLength(1) @MaxLength(64) staffId!: string;
  @IsString() @MinLength(8) @MaxLength(128) password!: string;
}
/** F10: the address the receipt's QR opens. `null` clears it. */
export class BranchRegistrationDto {
  @ValidateIf((_object, value) => value !== null)
  @IsUrl(
    { protocols: ['http', 'https'], require_protocol: true, require_tld: false },
    { message: 'url ต้องเป็นที่อยู่ http:// หรือ https://' },
  )
  @MaxLength(512)
  url!: string | null;
}
export class BranchDto {
  @IsString() @MinLength(1) @MaxLength(64) code!: string;
  @IsString() @Matches(/\S/) @MaxLength(191) name!: string;
  @IsString() @MaxLength(64) phone!: string;
  @IsBoolean() active!: boolean;
}

/** D86: the rows of the staff spreadsheet, as the browser read them (header = column key). */
export class StaffImportDto {
  @IsArray()
  @ArrayMaxSize(2000)
  @IsObject({ each: true })
  rows!: Record<string, unknown>[];

  @IsOptional()
  @IsBoolean()
  dryRun?: boolean;
}
export class OtpRequestDto {
  @IsString() @MinLength(1) @MaxLength(64) staffId!: string;
}
export class OtpVerifyDto {
  @IsString() @MinLength(1) @MaxLength(64) staffId!: string;
  @IsString() @Matches(/^\d{6}$/, { message: 'รหัส OTP ต้องเป็นตัวเลข 6 หลัก' }) code!: string;
}
export class SmsTestDto {
  @IsString() @Matches(PHONE_PATTERN, { message: 'เบอร์โทรต้องเป็นเบอร์มือถือ 10 หลัก' }) phone!: string;
}
