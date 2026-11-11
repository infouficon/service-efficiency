import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/**
 * The payment types FileMaker knows (D89), in the FMP team's own words. A payment method (what staff pick in SES, e.g.
 * "PayNext") is filed under one of them so the FMP push can say `paymentTypes: ["บัตรเงินผ่อน"]` next to `payments`.
 * The web app lists the same strings (`fmpPaymentTypes` in `constants/options.ts`); a test keeps the two in step.
 * D105: no "Trade In" (it is an On top item in SES) and no "Partner Mall" (not sold through SES), as the shops' team said.
 */
export const FMP_PAYMENT_TYPES = [
  'เงินสด',
  'โอนเงิน',
  'บัตรเครดิต',
  'บัตรเงินผ่อน',
  'ใช้มัดจำ',
  'U-Joy',
  'อื่นๆ',
] as const;
/** What FileMaker is told for a method that has no type yet (or whose name SES no longer lists). */
export const FMP_PAYMENT_TYPE_FALLBACK = 'อื่นๆ';

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
      include: {
        cardOptions: {
          where: all ? undefined : { active: true },
          orderBy: [{ position: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
        },
      },
      orderBy: ORDER,
    });
  }

  async create(name: string, fmpType: string | null = null) {
    const last = await this.prisma.paymentMethod.aggregate({
      _max: { position: true },
    });
    try {
      return await this.prisma.paymentMethod.create({
        data: { name, fmpType, position: (last._max.position ?? 0) + 1 },
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

  /** Files a method under one of the FMP payment types; `null` clears it (the push then says "อื่นๆ"). */
  async setFmpType(id: string, fmpType: string | null) {
    const method = await this.prisma.paymentMethod.findUnique({
      where: { id },
    });
    if (!method) throw new NotFoundException('ไม่พบช่องทางชำระเงิน');
    return this.prisma.paymentMethod.update({
      where: { id },
      data: { fmpType },
    });
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

  /** Reorders payment methods according to the given array of IDs and updates positions 1..n. */
  async reorder(ids: string[]) {
    return this.prisma.$transaction(async (tx) => {
      const all = await tx.paymentMethod.findMany();
      const allMap = new Map(all.map((m) => [m.id, m]));
      for (const id of ids) {
        if (!allMap.has(id)) {
          throw new NotFoundException(`ไม่พบช่องทางชำระเงิน id: ${id}`);
        }
      }
      for (const [index, id] of ids.entries()) {
        const method = allMap.get(id);
        const newPos = index + 1;
        if (method && method.position !== newPos) {
          await tx.paymentMethod.update({
            where: { id },
            data: { position: newPos },
          });
        }
      }
      return tx.paymentMethod.findMany({ orderBy: ORDER });
    });
  }

  /** D127: Add a card option to a payment method */
  async addCardOption(
    paymentMethodId: string,
    name: string,
    installmentMonths?: number[] | null,
  ) {
    const method = await this.prisma.paymentMethod.findUnique({
      where: { id: paymentMethodId },
    });
    if (!method) throw new NotFoundException('ไม่พบช่องทางชำระเงิน');

    const last = await this.prisma.paymentCardOption.aggregate({
      where: { paymentMethodId },
      _max: { position: true },
    });

    try {
      return await this.prisma.paymentCardOption.create({
        data: {
          paymentMethodId,
          name,
          installmentMonths: installmentMonths
            ? (installmentMonths as Prisma.InputJsonValue)
            : Prisma.JsonNull,
          position: (last._max.position ?? 0) + 1,
        },
      });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      )
        throw new ConflictException(`มีประเภทบัตร "${name}" ในช่องทางนี้อยู่แล้ว`);
      throw err;
    }
  }

  /** D127: Update a card option */
  async updateCardOption(
    id: string,
    data: {
      name?: string;
      active?: boolean;
      installmentMonths?: number[] | null;
    },
  ) {
    const card = await this.prisma.paymentCardOption.findUnique({
      where: { id },
    });
    if (!card) throw new NotFoundException('ไม่พบประเภทบัตร');

    try {
      return await this.prisma.paymentCardOption.update({
        where: { id },
        data: {
          name: data.name,
          active: data.active,
          installmentMonths:
            data.installmentMonths !== undefined
              ? data.installmentMonths === null
                ? Prisma.JsonNull
                : (data.installmentMonths as Prisma.InputJsonValue)
              : undefined,
        },
      });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      )
        throw new ConflictException(`มีประเภทบัตร "${data.name}" ในช่องทางนี้อยู่แล้ว`);
      throw err;
    }
  }

  /** D127: Delete a card option */
  async deleteCardOption(id: string) {
    const card = await this.prisma.paymentCardOption.findUnique({
      where: { id },
    });
    if (!card) throw new NotFoundException('ไม่พบประเภทบัตร');
    return this.prisma.paymentCardOption.delete({
      where: { id },
    });
  }

  /** D127: Reorder card options */
  async reorderCardOptions(paymentMethodId: string, ids: string[]) {
    return this.prisma.$transaction(async (tx) => {
      for (const [index, id] of ids.entries()) {
        await tx.paymentCardOption.update({
          where: { id, paymentMethodId },
          data: { position: index + 1 },
        });
      }
      return tx.paymentCardOption.findMany({
        where: { paymentMethodId },
        orderBy: [{ position: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
      });
    });
  }
}
