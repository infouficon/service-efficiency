import {
  ArrayNotEmpty,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
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
