import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

type Db = Pick<PrismaService, 'setting'> | Prisma.TransactionClient;

/** Name of the row that holds the "stock unlimited" switch (D59). */
const STOCK_UNLIMITED = 'stockUnlimited';
/** Name of the row that holds where orders sent to the cashier go in FileMaker (D130). */
const FMP_PUSH_MODE = 'fmpPushMode';

/**
 * D130: where SES sends an order when STOCK sends it to the cashier. `production` = the real FileMaker (U POS opens a held bill),
 * `off` = nothing leaves SES (the message is only written to the log), `uat` = the test FileMaker set by `FMP_UAT_*`.
 */
export const FMP_PUSH_MODES = ['production', 'off', 'uat'] as const;
export type FmpPushMode = (typeof FMP_PUSH_MODES)[number];
const isFmpPushMode = (value: string | undefined): value is FmpPushMode =>
  FMP_PUSH_MODES.includes(value as FmpPushMode);

/**
 * Global switches set by ADMIN (D59). "Stock unlimited" is **on until the owner turns it off** (no row = on), so a fresh database
 * lets staff pick any product while the stock numbers are not trustworthy yet. "FileMaker push mode" (D130) is `production` until
 * ADMIN changes it (no row = production, as before the switch existed); it is changed from Admin → ส่งไป FileMaker.
 */
@Injectable()
export class SettingsService {
  constructor(private readonly prisma: PrismaService) {}

  /** While on, no SKU is blocked by stock, FOUND takes nothing from the shelf and a cancel gives nothing back. Pass `tx` to read inside a transaction. */
  async stockUnlimited(db: Db = this.prisma): Promise<boolean> {
    const row = await db.setting.findUnique({
      where: { name: STOCK_UNLIMITED },
    });
    return row ? row.value === 'true' : true;
  }

  /** `updatedBy` / `updatedAt` (of "stock unlimited") are null / absent until someone has changed the switch. */
  async read() {
    const [row, mode] = await Promise.all([
      this.prisma.setting.findUnique({ where: { name: STOCK_UNLIMITED } }),
      this.fmpPushMode(),
    ]);
    return {
      stockUnlimited: row ? row.value === 'true' : true,
      fmpPushMode: mode,
      updatedAt: row?.updatedAt ?? null,
      updatedBy: row?.updatedBy ?? null,
    };
  }

  /** D130: where an order sent to the cashier goes; `production` when unset or unreadable. Pass `tx` to read inside a transaction. */
  async fmpPushMode(db: Db = this.prisma): Promise<FmpPushMode> {
    const row = await db.setting.findUnique({ where: { name: FMP_PUSH_MODE } });
    return isFmpPushMode(row?.value) ? row.value : 'production';
  }

  /** D130: the switch with who set it and when (null until someone has changed it). */
  async fmpPushModeRow() {
    const row = await this.prisma.setting.findUnique({
      where: { name: FMP_PUSH_MODE },
    });
    return {
      mode: isFmpPushMode(row?.value) ? row.value : ('production' as const),
      updatedAt: row?.updatedAt ?? null,
      updatedBy: row?.updatedBy ?? null,
    };
  }

  async setFmpPushMode(mode: FmpPushMode, actorStaffId: string) {
    await this.prisma.setting.upsert({
      where: { name: FMP_PUSH_MODE },
      create: { name: FMP_PUSH_MODE, value: mode, updatedBy: actorStaffId },
      update: { value: mode, updatedBy: actorStaffId },
    });
    return this.fmpPushModeRow();
  }

  async setStockUnlimited(value: boolean, actorStaffId: string) {
    await this.prisma.setting.upsert({
      where: { name: STOCK_UNLIMITED },
      create: {
        name: STOCK_UNLIMITED,
        value: String(value),
        updatedBy: actorStaffId,
      },
      update: { value: String(value), updatedBy: actorStaffId },
    });
    return this.read();
  }
}
