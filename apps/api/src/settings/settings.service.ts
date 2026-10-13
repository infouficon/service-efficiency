import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

type Db = PrismaService | Prisma.TransactionClient;

/** Name of the row that holds the "stock unlimited" switch (D59). */
const STOCK_UNLIMITED = 'stockUnlimited';

/**
 * Global switches set by ADMIN (D59). Today only one: "stock unlimited". It is **on until the owner turns it off**
 * (no row = on), so a fresh database lets staff pick any product while the stock numbers are not trustworthy yet.
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

  /** `updatedBy` / `updatedAt` are null / absent until someone has changed the switch. */
  async read() {
    const row = await this.prisma.setting.findUnique({
      where: { name: STOCK_UNLIMITED },
    });
    return {
      stockUnlimited: row ? row.value === 'true' : true,
      updatedAt: row?.updatedAt ?? null,
      updatedBy: row?.updatedBy ?? null,
    };
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
