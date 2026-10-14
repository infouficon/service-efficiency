import {
  BadRequestException,
  ConflictException,
  Injectable,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { RESERVATION_HOURS, warroomMode } from '../warroom/warroom-sync.service';

/** How long a "missing / out of stock" report (D41) keeps a SKU at 0 while warroom has not sent a newer snapshot. */
export const OUT_OF_STOCK_HOURS = 6;

/** A session item that reached FOUND and still holds `quantity` units (one when absent): when (if ever) its session was completed. */
export interface Reservation {
  branchId: string;
  skuId: string;
  completedAt: Date | null;
  quantity?: number;
}
export interface ErpInventory {
  branchId: string;
  skuId: string;
  erpReady: number | null;
  erpAsOf: Date | null;
  outOfStockAt: Date | null;
}

/**
 * Units SES can still promise for a branch + SKU, or null when there is no ERP number (D52):
 * the warroom `ready` count of the snapshot, minus sessions that reached FOUND and were not completed before the
 * snapshot (the ERP still counted their unit), and 0 when a "missing / out of stock" report is newer than the snapshot (D41).
 */
export function availableUnits(
  inv: ErpInventory,
  reservations: Map<string, Reservation[]>,
  now: Date = new Date(),
): number | null {
  if (inv.erpReady === null || !inv.erpAsOf) return null;
  // A report newer than the snapshot blocks the SKU, but only for OUT_OF_STOCK_HOURS: a mistaken tap must not black
  // out a SKU until warroom's next change.
  if (
    inv.outOfStockAt &&
    inv.outOfStockAt > inv.erpAsOf &&
    now.getTime() - inv.outOfStockAt.getTime() < OUT_OF_STOCK_HOURS * 3600_000
  )
    return 0;
  const asOf = inv.erpAsOf;
  const held = (reservations.get(`${inv.branchId}\u0000${inv.skuId}`) ?? [])
    .filter((r) => !r.completedAt || r.completedAt > asOf)
    .reduce((sum, r) => sum + (r.quantity ?? 1), 0);
  return Math.max(0, inv.erpReady - held);
}

@Injectable()
export class ProductsService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly settings: SettingsService,
  ) {}

  /** True when the warroom numbers drive what staff see (WARROOM_STOCK_MODE=on and a warroom database is set). */
  private erpOn(): boolean {
    return warroomMode(this.config) === 'on';
  }

  private erpLocked() {
    return new ConflictException(
      'รายการนี้ซิงก์จาก ERP (warroom): แก้ชื่อ รหัส สี ความจุได้ที่ ERP เท่านั้น (เปิด/ปิดการขายได้)',
    );
  }

  /** The oldest ERP snapshot time among the given inventory rows (null when none has ERP data). */
  private oldestAsOf(inv: { erpAsOf: Date | null }[]): Date | null {
    let oldest: Date | null = null;
    for (const i of inv)
      if (i.erpAsOf && (!oldest || i.erpAsOf < oldest)) oldest = i.erpAsOf;
    return oldest;
  }

  /** Sessions in the last 24 h that reached FOUND and have not ended with an outcome (cancelled, out of stock...). */
  private async loadReservations(
    branchId?: string,
    oldestAsOf?: Date | null,
  ): Promise<Map<string, Reservation[]>> {
    // Anchored to the OLDEST snapshot in play, not only to now: with a 30 h old snapshot a session found 26 h ago and
    // still open is still a unit the ERP does not know about.
    const anchor = Math.min(Date.now(), oldestAsOf?.getTime() ?? Date.now());
    const since = new Date(anchor - RESERVATION_HOURS * 3600_000);
    const sessions = await this.prisma.customerSession.findMany({
      where: {
        ...(branchId ? { branchId } : {}),
        items: { some: {} },
        stockFoundAt: { gte: since },
        outcome: null,
      },
      select: {
        branchId: true,
        items: { select: { skuId: true, quantity: true } },
        events: {
          where: { eventType: 'COMPLETED' },
          select: { createdAt: true },
          take: 1,
        },
      },
    });
    // F3: every item of the session holds its quantity
    const map = new Map<string, Reservation[]>();
    for (const s of sessions) {
      for (const item of s.items) {
        const key = `${s.branchId}\u0000${item.skuId}`;
        const list = map.get(key) ?? [];
        list.push({
          branchId: s.branchId,
          skuId: item.skuId,
          completedAt: s.events[0]?.createdAt ?? null,
          quantity: item.quantity,
        });
        map.set(key, list);
      }
    }
    return map;
  }

  async onModuleInit() {
    await this.syncBranchInventory();
  }

  async syncBranchInventory() {
    try {
      const [branches, skus] = await Promise.all([
        this.prisma.branch.findMany({ select: { id: true } }),
        this.prisma.productSku.findMany({ select: { id: true } }),
      ]);

      if (!branches.length || !skus.length) return;

      const existing = await this.prisma.branchInventory.findMany({
        select: { branchId: true, skuId: true },
      });
      const existingSet = new Set(existing.map((e) => `${e.branchId}:${e.skuId}`));

      const toCreate: { branchId: string; skuId: string; stock: number; active: boolean }[] = [];
      for (const b of branches) {
        for (const s of skus) {
          if (!existingSet.has(`${b.id}:${s.id}`)) {
            toCreate.push({
              branchId: b.id,
              skuId: s.id,
              stock: 0,
              active: true,
            });
          }
        }
      }

      if (toCreate.length > 0) {
        await this.prisma.branchInventory.createMany({
          data: toCreate,
          skipDuplicates: true,
        });
      }
    } catch {
      // Ignore if DB connection fails during build time
    }
  }

  async findByBranch(branchId: string) {
    await this.syncBranchInventory();
    const erpOn = this.erpOn();
    // D59: while "stock unlimited" is on nothing is blocked by stock; the real number is still returned for display
    const unlimited = await this.settings.stockUnlimited();

    const products = await this.prisma.product.findMany({
      where: { active: true, category: { in: await this.activeCategoryNames() } },
      include: {
        models: {
          where: { active: true },
          include: {
            skus: {
              where: {
                active: true,
                inventory: {
                  some: {
                    branchId,
                    active: true,
                  },
                },
              },
              include: {
                inventory: {
                  where: { branchId },
                },
              },
              orderBy: { sku: 'asc' },
            },
          },
          orderBy: { name: 'asc' },
        },
      },
      orderBy: { name: 'asc' },
    });

    const reservations = erpOn
      ? await this.loadReservations(
          branchId,
          this.oldestAsOf(
            products.flatMap((p) =>
              p.models.flatMap((m) => m.skus.flatMap((s) => s.inventory)),
            ),
          ),
        )
      : new Map<string, Reservation[]>();

    // Map each SKU with its branch stock and filter out empty models/products
    return products
      .map((p) => ({
        ...p,
        models: p.models
          .map((m) => ({
            ...m,
            skus: m.skus.map((s) => {
              const inv = s.inventory[0];
              // ERP number (net of what SES already promised) when it drives the screen, else the manual stock (D41)
              const available = erpOn && inv ? availableUnits(inv, reservations) : null;
              return {
                id: s.id,
                modelId: s.modelId,
                sku: s.sku,
                name: s.name,
                color: s.color,
                storage: s.storage,
                memory: s.memory,
                active: s.active,
                erpManaged: s.erpManaged,
                stock: available ?? inv?.stock ?? 0,
                /** where `stock` comes from: `unlimited` = the switch is on (D59, nothing blocked), `erp` = warroom minus promised units (D52), `manual` = the number ADMIN keeps (D41) */
                stockSource: unlimited
                  ? ('unlimited' as const)
                  : available != null
                    ? ('erp' as const)
                    : ('manual' as const),
                erpCovered: inv?.erpReady != null,
                erpAsOf: inv?.erpAsOf ?? null,
                branchActive: inv?.active ?? true,
              };
            }),
          }))
          .filter((m) => m.skus.length > 0),
      }))
      .filter((p) => p.models.length > 0);
  }

  async findAll() {
    return this.prisma.product.findMany({
      where: { active: true, category: { in: await this.activeCategoryNames() } },
      include: {
        models: {
          where: { active: true },
          include: {
            skus: {
              where: { active: true },
              orderBy: { sku: 'asc' },
            },
          },
          orderBy: { name: 'asc' },
        },
      },
      orderBy: { name: 'asc' },
    });
  }

  async findAllAdmin(branchId?: string) {
    await this.syncBranchInventory();

    const products = await this.prisma.product.findMany({
      include: {
        models: {
          include: {
            skus: {
              include: {
                inventory: branchId
                  ? { where: { branchId }, include: { branch: true } }
                  : { include: { branch: true } },
              },
              orderBy: { sku: 'asc' },
            },
          },
          orderBy: { name: 'asc' },
        },
      },
      orderBy: { name: 'asc' },
    });
    const reservations = await this.loadReservations(
      branchId,
      this.oldestAsOf(
        products.flatMap((p) =>
          p.models.flatMap((m) => m.skus.flatMap((s) => s.inventory)),
        ),
      ),
    );
    // `available` = ERP ready net of what SES already promised (null without ERP data), also shown in `shadow`
    return products.map((p) => ({
      ...p,
      models: p.models.map((m) => ({
        ...m,
        skus: m.skus.map((s) => ({
          ...s,
          inventory: s.inventory.map((inv) => ({
            ...inv,
            available: availableUnits(inv, reservations),
          })),
        })),
      })),
    }));
  }

  async getBranchInventory(branchId?: string) {
    await this.syncBranchInventory();

    return this.prisma.branchInventory.findMany({
      where: branchId ? { branchId } : undefined,
      include: {
        branch: true,
        sku: {
          include: {
            model: {
              include: {
                product: true,
              },
            },
          },
        },
      },
      orderBy: [
        { branch: { code: 'asc' } },
        { sku: { sku: 'asc' } },
      ],
    });
  }

  async updateBranchStock(branchId: string, skuId: string, stock: number) {
    if (this.erpOn()) {
      const current = await this.prisma.branchInventory.findUnique({
        where: { branchId_skuId: { branchId, skuId } },
        select: { erpReady: true },
      });
      if (current?.erpReady != null)
        throw new ConflictException(
          'สต็อกของสาขานี้มาจาก ERP (warroom) แก้ที่ ERP เท่านั้น',
        );
    }
    return this.prisma.branchInventory.upsert({
      where: {
        branchId_skuId: { branchId, skuId },
      },
      create: {
        branchId,
        skuId,
        stock,
        active: true,
      },
      update: {
        stock,
      },
      include: {
        branch: true,
        sku: true,
      },
    });
  }

  async toggleBranchActive(branchId: string, skuId: string, active: boolean) {
    return this.prisma.branchInventory.upsert({
      where: {
        branchId_skuId: { branchId, skuId },
      },
      create: {
        branchId,
        skuId,
        stock: 0,
        active,
      },
      update: {
        active,
      },
      include: {
        branch: true,
        sku: true,
      },
    });
  }

  /** The names of the active categories (D72): staff only see products of these. */
  private async activeCategoryNames(): Promise<string[]> {
    const rows = await this.prisma.category.findMany({
      where: { active: true },
      select: { name: true },
    });
    return rows.map((c) => c.name);
  }

  /** The stored spelling of a category name; a product can only be put in a category that exists (D72). */
  private async categoryName(name: string): Promise<string> {
    const found = await this.prisma.category.findUnique({ where: { name } });
    if (!found)
      throw new BadRequestException(
        `ไม่พบหมวดหมู่ "${name}" เพิ่มหมวดหมู่ก่อนที่หน้า หมวดหมู่สินค้า`,
      );
    return found.name;
  }

  async createProduct(data: { category: string; name: string }) {
    const category = await this.categoryName(data.category);
    return this.prisma.product.create({
      data: {
        category,
        name: data.name,
        active: true,
      },
      include: {
        models: {
          include: { skus: true },
        },
      },
    });
  }

  async updateProduct(id: string, data: { category?: string; name?: string; active?: boolean }) {
    if (data.category !== undefined)
      data = { ...data, category: await this.categoryName(data.category) };
    if (this.erpOn()) {
      const cur = await this.prisma.product.findUnique({
        where: { id },
        select: { erpManaged: true, category: true, name: true },
      });
      if (
        cur?.erpManaged &&
        ((data.category !== undefined && data.category !== cur.category) ||
          (data.name !== undefined && data.name !== cur.name))
      )
        throw this.erpLocked();
    }
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.product.update({
        where: { id },
        data,
        include: {
          models: {
            include: { skus: true },
          },
        },
      });

      if (data.active === false) {
        await tx.productModel.updateMany({
          where: { productId: id },
          data: { active: false },
        });

        await tx.productSku.updateMany({
          where: { model: { productId: id } },
          data: { active: false },
        });

        await tx.branchInventory.updateMany({
          where: { sku: { model: { productId: id } } },
          data: { active: false },
        });
      }

      return updated;
    });
  }

  async createModel(productId: string, data: { name: string }) {
    return this.prisma.productModel.create({
      data: {
        productId,
        name: data.name,
        active: true,
      },
      include: { skus: true },
    });
  }

  async updateModel(modelId: string, data: { name?: string; active?: boolean }) {
    if (this.erpOn()) {
      const cur = await this.prisma.productModel.findUnique({
        where: { id: modelId },
        select: { erpManaged: true, name: true },
      });
      if (cur?.erpManaged && data.name !== undefined && data.name !== cur.name)
        throw this.erpLocked();
    }
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.productModel.update({
        where: { id: modelId },
        data,
        include: { skus: true },
      });

      if (data.active === false) {
        await tx.productSku.updateMany({
          where: { modelId },
          data: { active: false },
        });

        await tx.branchInventory.updateMany({
          where: { sku: { modelId } },
          data: { active: false },
        });
      }

      return updated;
    });
  }

  async createSku(modelId: string, data: { sku: string; name: string; color?: string; storage?: string }) {
    const sku = await this.prisma.productSku.create({
      data: {
        modelId,
        sku: data.sku,
        name: data.name,
        color: data.color || null,
        storage: data.storage || null,
        active: true,
      },
    });

    // Create branch inventory for all existing branches
    const branches = await this.prisma.branch.findMany({ select: { id: true } });
    if (branches.length > 0) {
      await this.prisma.branchInventory.createMany({
        data: branches.map((b) => ({
          branchId: b.id,
          skuId: sku.id,
          stock: 0,
          active: true,
        })),
        skipDuplicates: true,
      });
    }

    return sku;
  }

  async updateSku(skuId: string, data: { sku?: string; name?: string; color?: string; storage?: string; active?: boolean }) {
    if (this.erpOn()) {
      const cur = await this.prisma.productSku.findUnique({
        where: { id: skuId },
        select: { erpManaged: true, sku: true, name: true, color: true, storage: true },
      });
      const differs = (next: string | undefined, now: string | null) =>
        next !== undefined && (next || null) !== (now || null);
      if (
        cur?.erpManaged &&
        (differs(data.sku, cur.sku) ||
          differs(data.name, cur.name) ||
          differs(data.color, cur.color) ||
          differs(data.storage, cur.storage))
      )
        throw this.erpLocked();
    }
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.productSku.update({
        where: { id: skuId },
        data,
      });

      if (data.active === false) {
        await tx.branchInventory.updateMany({
          where: { skuId },
          data: { active: false },
        });
      }

      return updated;
    });
  }
}


