import { IsBoolean } from 'class-validator';

/** One field per switch; a body with no known field, a non-boolean value or an unknown field is a 400. */
export class SettingsUpdateDto {
  @IsBoolean()
  stockUnlimited!: boolean;
}
