import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const ORDER: Prisma.CategoryOrderByWithRelationInput[] = [
  { position: 'asc' },
  { createdAt: 'asc' },
  { id: 'asc' },
];

/**
 * The product categories (D68), kept by ADMIN and added by the warroom sync (always switched off at first). Products store
 * the category NAME, so a category is switched on/off and never renamed or deleted. Staff only see products of an active
 * category; accessory-like categories are not offered as a main product.
 */
@Injectable()
export class CategoriesService {
  constructor(private readonly prisma: PrismaService) {}

  /** Staff read the active categories; the back office (`all`) also gets the switched-off ones and the product counts. */
  async list(all = false) {
    const rows = await this.prisma.category.findMany({
      where: all ? undefined : { active: true },
      orderBy: ORDER,
    });
    if (!all) return rows;
    const counts = await this.prisma.product.groupBy({
      by: ['category'],
      _count: { _all: true },
    });
    // the database compares names without regard to case, so the count is matched the same way
    const byName = new Map(
      counts.map((c) => [c.category.toLowerCase(), c._count._all]),
    );
    return rows.map((c) => ({
      ...c,
      productCount: byName.get(c.name.toLowerCase()) ?? 0,
    }));
  }

  async create(name: string, isAccessory = false) {
    const last = await this.prisma.category.aggregate({
      _max: { position: true },
    });
    try {
      return await this.prisma.category.create({
        data: { name, isAccessory, position: (last._max.position ?? 0) + 1 },
      });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      )
        throw new ConflictException(`มีหมวดหมู่ "${name}" อยู่แล้ว`);
      throw err;
    }
  }

  async update(id: string, data: { active?: boolean; isAccessory?: boolean }) {
    const found = await this.prisma.category.findUnique({ where: { id } });
    if (!found) throw new NotFoundException('ไม่พบหมวดหมู่');
    return this.prisma.category.update({ where: { id }, data });
  }

  /** Swaps a category with its neighbour in the full list and renumbers the list 1..n. */
  async move(id: string, direction: 'up' | 'down') {
    return this.prisma.$transaction(async (tx) => {
      const all = await tx.category.findMany({ orderBy: ORDER });
      const index = all.findIndex((c) => c.id === id);
      if (index < 0) throw new NotFoundException('ไม่พบหมวดหมู่');
      const other = direction === 'up' ? index - 1 : index + 1;
      if (other >= 0 && other < all.length)
        [all[index], all[other]] = [all[other], all[index]];
      for (const [i, category] of all.entries()) {
        if (category.position !== i + 1)
          await tx.category.update({
            where: { id: category.id },
            data: { position: i + 1 },
          });
      }
      return tx.category.findUniqueOrThrow({ where: { id } });
    });
  }
}
