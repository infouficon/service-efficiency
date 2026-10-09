import { Injectable, OnModuleInit } from '@nestjs/common';
import { ProductCategory } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ProductsService implements OnModuleInit {
  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    await this.seedCatalogIfEmpty();
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

  async seedCatalogIfEmpty() {
    try {
      const count = await this.prisma.product.count();
      if (count > 0) return;

      const catalog = [
        {
          category: 'iPhone' as const,
          name: 'iPhone 16 Pro',
          models: [
            {
              name: 'iPhone 16 Pro',
              skus: [
                { sku: 'IP16P-128-NAT', name: '128GB Natural Titanium', storage: '128GB', color: 'Natural Titanium' },
                { sku: 'IP16P-256-BLK', name: '256GB Black Titanium', storage: '256GB', color: 'Black Titanium' },
                { sku: 'IP16P-512-WHT', name: '512GB White Titanium', storage: '512GB', color: 'White Titanium' },
              ],
            },
          ],
        },
        {
          category: 'iPhone' as const,
          name: 'iPhone 16',
          models: [
            {
              name: 'iPhone 16',
              skus: [
                { sku: 'IP16-128-BLK', name: '128GB Black', storage: '128GB', color: 'Black' },
                { sku: 'IP16-256-BLU', name: '256GB Ultramarine', storage: '256GB', color: 'Ultramarine' },
              ],
            },
          ],
        },
        {
          category: 'iPad' as const,
          name: 'iPad Pro 11"',
          models: [
            {
              name: 'iPad Pro (M4) 11"',
              skus: [
                { sku: 'IPAD-PRO11-256-SPB', name: '256GB Space Black', storage: '256GB', color: 'Space Black' },
                { sku: 'IPAD-PRO11-512-SIL', name: '512GB Silver', storage: '512GB', color: 'Silver' },
              ],
            },
          ],
        },
        {
          category: 'iPad' as const,
          name: 'iPad Air 11"',
          models: [
            {
              name: 'iPad Air (M2) 11"',
              skus: [
                { sku: 'IPAD-AIR11-128-BLU', name: '128GB Blue', storage: '128GB', color: 'Blue' },
                { sku: 'IPAD-AIR11-256-PUR', name: '256GB Purple', storage: '256GB', color: 'Purple' },
              ],
            },
          ],
        },
        {
          category: 'Mac' as const,
          name: 'MacBook Air 13"',
          models: [
            {
              name: 'MacBook Air (M3) 13"',
              skus: [
                { sku: 'MBA13-256-MID', name: '256GB Midnight', storage: '256GB', color: 'Midnight' },
                { sku: 'MBA13-512-SLR', name: '512GB Starlight', storage: '512GB', color: 'Starlight' },
              ],
            },
          ],
        },
        {
          category: 'Watch' as const,
          name: 'Apple Watch Series 10',
          models: [
            {
              name: 'Apple Watch Series 10 (GPS)',
              skus: [
                { sku: 'AWS10-42-AL-BLK', name: '42mm Jet Black', storage: '64GB', color: 'Jet Black' },
                { sku: 'AWS10-46-AL-RSG', name: '46mm Rose Gold', storage: '64GB', color: 'Rose Gold' },
              ],
            },
          ],
        },
      ];

      for (const item of catalog) {
        const product = await this.prisma.product.create({
          data: {
            category: item.category,
            name: item.name,
            active: true,
          },
        });

        for (const m of item.models) {
          const model = await this.prisma.productModel.create({
            data: {
              productId: product.id,
              name: m.name,
              active: true,
            },
          });

          for (const s of m.skus) {
            await this.prisma.productSku.create({
              data: {
                modelId: model.id,
                sku: s.sku,
                name: s.name,
                color: s.color,
                storage: s.storage,
                active: true,
              },
            });
          }
        }
      }
    } catch {
      // Ignore if DB connection fails during build time
    }
  }

  async findByBranch(branchId: string) {
    await this.syncBranchInventory();

    const products = await this.prisma.product.findMany({
      where: { active: true },
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

    // Map each SKU with its branch stock and filter out empty models/products
    return products
      .map((p) => ({
        ...p,
        models: p.models
          .map((m) => ({
            ...m,
            skus: m.skus.map((s) => ({
              id: s.id,
              modelId: s.modelId,
              sku: s.sku,
              name: s.name,
              color: s.color,
              storage: s.storage,
              active: s.active,
              stock: s.inventory[0]?.stock ?? 0,
              branchActive: s.inventory[0]?.active ?? true,
            })),
          }))
          .filter((m) => m.skus.length > 0),
      }))
      .filter((p) => p.models.length > 0);
  }

  async findAll() {
    return this.prisma.product.findMany({
      where: { active: true },
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

    return this.prisma.product.findMany({
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

  async createProduct(data: { category: ProductCategory; name: string }) {
    return this.prisma.product.create({
      data: {
        category: data.category,
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

  async updateProduct(id: string, data: { category?: ProductCategory; name?: string; active?: boolean }) {
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


