import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const ORDER: Prisma.PaymentMethodOrderByWithRelationInput[] = [
  { position: 'asc' },
  { createdAt: 'asc' },
  { id: 'asc' },
];

/**
 * The payment methods staff can pick on a session (F6), kept by ADMIN. The name is what a session stores, so a method is
 * switched off and never renamed or deleted: history keeps its meaning.
 */
@Injectable()
export class PaymentsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Staff see the active methods; the back office (`all`) sees every one, in display order. */
  list(all = false) {
    return this.prisma.paymentMethod.findMany({
      where: all ? undefined : { active: true },
      orderBy: ORDER,
    });
  }

  async create(name: string) {
    const last = await this.prisma.paymentMethod.aggregate({
      _max: { position: true },
    });
    try {
      return await this.prisma.paymentMethod.create({
        data: { name, position: (last._max.position ?? 0) + 1 },
      });
    } catch (err) {
      // the name is unique, and the database compares without regard to case
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      )
        throw new ConflictException(`มีช่องทางชำระเงิน "${name}" อยู่แล้ว`);
      throw err;
    }
  }

  async setActive(id: string, active: boolean) {
    const method = await this.prisma.paymentMethod.findUnique({
      where: { id },
    });
    if (!method) throw new NotFoundException('ไม่พบช่องทางชำระเงิน');
    if (!active && method.active) {
      const others = await this.prisma.paymentMethod.count({
        where: { active: true, id: { not: id } },
      });
      if (others === 0)
        throw new BadRequestException(
          'ต้องมีช่องทางชำระเงินที่เปิดใช้งานอย่างน้อย 1 ช่องทาง',
        );
    }
    return this.prisma.paymentMethod.update({
      where: { id },
      data: { active },
    });
  }

  /** Swaps a method with its neighbour in the full list (switched-off ones included) and renumbers the list 1..n. */
  async move(id: string, direction: 'up' | 'down') {
    return this.prisma.$transaction(async (tx) => {
      const all = await tx.paymentMethod.findMany({ orderBy: ORDER });
      const index = all.findIndex((m) => m.id === id);
      if (index < 0) throw new NotFoundException('ไม่พบช่องทางชำระเงิน');
      const other = direction === 'up' ? index - 1 : index + 1;
      if (other >= 0 && other < all.length)
        [all[index], all[other]] = [all[other], all[index]];
      for (const [i, method] of all.entries()) {
        if (method.position !== i + 1)
          await tx.paymentMethod.update({
            where: { id: method.id },
            data: { position: i + 1 },
          });
      }
      return tx.paymentMethod.findUniqueOrThrow({ where: { id } });
    });
  }
}
