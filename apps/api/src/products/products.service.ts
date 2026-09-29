import { Injectable, OnModuleInit } from '@nestjs/common';
import { ProductCategory } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ProductsService implements OnModuleInit {
  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    await this.seedCatalogIfEmpty();
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

  async findAll() {
    return this.prisma.product.findMany({
      where: { active: true },
      include: {
        models: {
          where: { active: true },
          include: {
            skus: {
              where: { active: true },
            },
          },
        },
      },
      orderBy: { name: 'asc' },
    });
  }

  async findAllAdmin() {
    return this.prisma.product.findMany({
      include: {
        models: {
          include: {
            skus: {
              orderBy: { sku: 'asc' },
            },
          },
          orderBy: { name: 'asc' },
        },
      },
      orderBy: { name: 'asc' },
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
    return this.prisma.product.update({
      where: { id },
      data,
      include: {
        models: {
          include: { skus: true },
        },
      },
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
    return this.prisma.productModel.update({
      where: { id: modelId },
      data,
      include: { skus: true },
    });
  }

  async createSku(modelId: string, data: { sku: string; name: string; color?: string; storage?: string }) {
    return this.prisma.productSku.create({
      data: {
        modelId,
        sku: data.sku,
        name: data.name,
        color: data.color || null,
        storage: data.storage || null,
        active: true,
      },
    });
  }

  async updateSku(skuId: string, data: { sku?: string; name?: string; color?: string; storage?: string; active?: boolean }) {
    return this.prisma.productSku.update({
      where: { id: skuId },
      data,
    });
  }
}
