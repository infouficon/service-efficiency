import { IsISO8601, IsString, MaxLength, MinLength } from 'class-validator';

/** U POS reports that it opened the bill of an order (D60). */
export class PosBillDto {
  /** The order's reference, as returned by `GET /integrations/pos/orders`. */
  @IsString()
  @MinLength(1)
  @MaxLength(32)
  reference!: string;

  /** The bill number in U POS. */
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  billNo!: string;

  /** When U POS opened the bill (ISO 8601 with a time zone). */
  @IsISO8601({ strict: true })
  openedAt!: string;
}
