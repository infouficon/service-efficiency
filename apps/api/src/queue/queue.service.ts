import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { CustomerTypeCreateDto, CustomerTypeUpdateDto } from './dto';

type Tx = Prisma.TransactionClient;

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/**
 * Calendar day (YYYY-MM-DD) in the shop's time zone. Queue numbers and session references restart at midnight in
 * Bangkok, whatever time zone the server runs in (H-05).
 */
export function bangkokDay(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

/** "A012": the type letter plus at least three digits ("A1000" after 999). Sessions from before D57 have no letter ("012"). */
export function formatQueue(
  letter: string | null | undefined,
  no: number,
): string {
  return `${letter ?? ''}${String(no).padStart(3, '0')}`;
}

/** Customer types (D57) and the running numbers that make queue numbers and session references. */
@Injectable()
export class QueueService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Next number of `scope` for `day`. One statement increments (or creates) the counter row and hands the new value
   * back through LAST_INSERT_ID, so two concurrent walk-ins can never get the same number; the row stays locked until
   * the caller's transaction ends.
   */
  async nextNumber(tx: Tx, scope: string, day: string): Promise<number> {
    await tx.$executeRaw`INSERT INTO DailyCounter (scope, day, lastNo) VALUES (${scope}, ${day}, LAST_INSERT_ID(1)) ON DUPLICATE KEY UPDATE lastNo = LAST_INSERT_ID(lastNo + 1)`;
    const rows = await tx.$queryRaw<
      { n: bigint | number }[]
    >`SELECT LAST_INSERT_ID() AS n`;
    return Number(rows[0].n);
  }

  /**
   * The queue number for a new walk-in of `branchId`: one running number per branch, per type letter, per Bangkok day.
   * Without a `customerTypeId` the active type with the lowest letter is used.
   */
  async allocate(
    tx: Tx,
    branchId: string,
    customerTypeId: string | undefined,
    now: Date,
  ) {
    const type = customerTypeId
      ? await tx.customerType.findUnique({ where: { id: customerTypeId } })
      : await tx.customerType.findFirst({
          where: { active: true },
          orderBy: { letter: 'asc' },
        });
    if (!type?.active)
      throw new BadRequestException('ไม่พบประเภทลูกค้าที่เปิดใช้งาน');
    const queueNo = await this.nextNumber(
      tx,
      `queue:${branchId}:${type.letter}`,
      bangkokDay(now),
    );
    return {
      customerTypeId: type.id,
      queueLetter: type.letter,
      queueNo,
    };
  }

  /** Staff see only the active types; the back office (`all`) sees every type, in letter order. */
  listTypes(all = false) {
    return this.prisma.customerType.findMany({
      where: all ? undefined : { active: true },
      orderBy: { letter: 'asc' },
    });
  }

  async createType(dto: CustomerTypeCreateDto) {
    const taken = new Set(
      (
        await this.prisma.customerType.findMany({ select: { letter: true } })
      ).map((t) => t.letter),
    );
    const letter = dto.letter ?? [...LETTERS].find((l) => !taken.has(l));
    if (!letter) throw new BadRequestException('ครบ 26 ประเภท (A-Z) แล้ว');
    if (taken.has(letter))
      throw new ConflictException(
        `ตัวอักษร ${letter} ถูกใช้เป็นประเภทอื่นแล้ว`,
      );
    try {
      return await this.prisma.customerType.create({
        data: {
          letter,
          name: dto.name,
          description: dto.description || null,
        },
      });
    } catch (err) {
      // two admins taking the same free letter at the same moment
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      )
        throw new ConflictException(
          `ตัวอักษร ${letter} ถูกใช้เป็นประเภทอื่นแล้ว`,
        );
      throw err;
    }
  }

  async updateType(id: string, dto: CustomerTypeUpdateDto) {
    const type = await this.prisma.customerType.findUnique({ where: { id } });
    if (!type) throw new NotFoundException('ไม่พบประเภทลูกค้า');
    if (dto.active === false && type.active) {
      const others = await this.prisma.customerType.count({
        where: { active: true, id: { not: id } },
      });
      if (others === 0)
        throw new BadRequestException(
          'ต้องมีประเภทลูกค้าที่เปิดใช้งานอย่างน้อย 1 ประเภท',
        );
    }
    return this.prisma.customerType.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.description !== undefined
          ? { description: dto.description || null }
          : {}),
        ...(dto.active !== undefined ? { active: dto.active } : {}),
      },
    });
  }
}
