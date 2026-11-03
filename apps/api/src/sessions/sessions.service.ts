import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { PublicAccount } from '../accounts/accounts.service';
import { PrismaService } from '../prisma/prisma.service';
import { bangkokDay, formatQueue, QueueService } from '../queue/queue.service';
import { loadPaymentTypes, orderView } from './order-view';
import { FmpService } from '../fmp/fmp.service';
import { SettingsService } from '../settings/settings.service';
import type {
  AdvanceStepDto,
  CancelSessionDto,
  CashierRejectDto,
  CashierRemoveDamagedDto,
  ChangeSessionItemDto,
  CreateSessionDto,
  NotBuyDto,
  OutOfStockDto,
  ReportStockMissingDto,
  ResolveStockReviewDto,
  SessionItemDto,
  StepAction,
  UpdateSelectionDto,
} from './dto';
import { EventType, Prisma, WorkflowState } from '@prisma/client';

const STEPS: Record<
  StepAction,
  {
    from: WorkflowState;
    to: WorkflowState;
    timestampField?: string;
    eventType: EventType;
    requiredRole: 'STAFF' | 'STOCK' | 'CASHIER';
  }
> = {
  startDemo: {
    from: 'WALK_IN',
    to: 'DEMO',
    timestampField: 'demoStartAt',
    eventType: 'DEMO_STARTED',
    requiredRole: 'STAFF',
  },
  endDemo: {
    from: 'DEMO',
    to: 'DECISION',
    timestampField: 'demoEndAt',
    eventType: 'DEMO_ENDED',
    requiredRole: 'STAFF',
  },
  buy: {
    from: 'DECISION',
    to: 'DECISION',
    timestampField: 'decisionAt',
    eventType: 'DECISION_MADE',
    requiredRole: 'STAFF',
  },
  startSelection: {
    from: 'DECISION',
    to: 'PRODUCT_SELECTION',
    timestampField: 'productSelectionStartAt',
    eventType: 'PRODUCT_SELECTION_STARTED',
    requiredRole: 'STAFF',
  },
  search: {
    from: 'STOCK_REQUESTED',
    to: 'SEARCHING',
    timestampField: 'stockStartedAt',
    eventType: 'STOCK_SEARCHING',
    requiredRole: 'STOCK',
  },
  found: {
    from: 'SEARCHING',
    to: 'FOUND',
    timestampField: 'stockFoundAt',
    eventType: 'STOCK_FOUND',
    requiredRole: 'STOCK',
  },
  send: {
    from: 'FOUND',
    to: 'SENT_TO_CASHIER',
    eventType: 'STOCK_SENT_TO_CASHIER',
    requiredRole: 'STOCK',
  },
  receive: {
    from: 'SENT_TO_CASHIER',
    to: 'CASHIER_RECEIVED',
    timestampField: 'cashierReceivedAt',
    eventType: 'CASHIER_RECEIVED',
    requiredRole: 'CASHIER',
  },
  scan: {
    from: 'CASHIER_RECEIVED',
    to: 'CASHIER_SCAN',
    timestampField: 'cashierScanAt',
    eventType: 'CASHIER_SCANNED',
    requiredRole: 'CASHIER',
  },
  bill: {
    from: 'CASHIER_SCAN',
    to: 'BILL_OPENED',
    timestampField: 'billOpenedAt',
    eventType: 'BILL_OPENED',
    requiredRole: 'CASHIER',
  },
  complete: {
    from: 'BILL_OPENED',
    to: 'COMPLETED',
    eventType: 'COMPLETED',
    requiredRole: 'CASHIER',
  },
};

/** What every endpoint returns for a Customer Session: one shape, so the web mapper can rely on it (H-19). */
const sessionInclude = {
  branch: true,
  staff: { select: { staffId: true, branchId: true } },
  customerType: { select: { id: true, letter: true, name: true } },
  // F3: the main products, in the order the staff added them, each with its SKU, model and product
  items: {
    include: {
      sku: { include: { model: { include: { product: true } } } },
      serials: { orderBy: { position: 'asc' } }, // D92
    },
    orderBy: { createdAt: 'asc' },
  },
  accessories: true,
  ontop: true,
  points: true,
  burnPoints: true,
  payments: true,
  events: { orderBy: { createdAt: 'asc' } },
  // F11: the cancelled session this one was bought again from, and the one that replaced this one
  rebuyOf: { select: { id: true, reference: true } },
  rebuiltAs: { select: { id: true, reference: true } },
} satisfies Prisma.CustomerSessionInclude;

/**
 * F11: cancel reasons that allow "buy again" (the customer changes the model, colour or capacity, or the staff picked
 * the wrong product). Keep equal to `changeReasons` in apps/web/src/constants/options.ts.
 */
const CHANGE_REASONS = [
  'เปลี่ยนรุ่น',
  'เปลี่ยนสี',
  'เปลี่ยนความจุ',
  'พนักงานเลือกสินค้าผิดพลาด',
];

type Tx = Prisma.TransactionClient;
/** States in which STOCK has already picked the goods (a cancel then needs them brought back). */
const FOUND_OR_LATER: string[] = [
  'FOUND',
  'SENT_TO_CASHIER',
  'CASHIER_RECEIVED',
  'CASHIER_SCAN',
  'BILL_OPENED',
];
type SessionItemRow = Prisma.CustomerSessionGetPayload<{
  include: typeof sessionInclude;
}>['items'][number];

@Injectable()
export class SessionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: QueueService,
    private readonly settings: SettingsService,
    private readonly fmp: FmpService,
  ) {}

  /**
   * Takes the quantity of each item off the branch shelf when STOCK finds them (D41), unless "stock unlimited" is on
   * (D59). Each item records how many units were really taken (`deducted`): a cancel gives back exactly that, whatever the
   * switch says by then. Returns the total (written on the STOCK_FOUND event).
   */
  private async takeItemsFromShelf(
    tx: Tx,
    branchId: string,
    items: { id: string; skuId: string; quantity: number }[],
  ): Promise<number> {
    if (items.length === 0 || (await this.settings.stockUnlimited(tx))) return 0;
    let total = 0;
    for (const item of items) {
      const { count } = await tx.branchInventory.updateMany({
        where: { branchId, skuId: item.skuId },
        data: { stock: { decrement: item.quantity } },
      });
      if (count > 0) {
        await tx.sessionItem.update({
          where: { id: item.id },
          data: { deducted: item.quantity },
        });
        total += item.quantity;
      }
    }
    return total;
  }

  /** Gives back what FOUND took off the shelf: each item's `deducted` units, then nothing is held any more. */
  private async returnItemsToShelf(
    tx: Tx,
    branchId: string,
    items: { id: string; skuId: string; deducted: number }[],
  ) {
    for (const item of items) {
      if (item.deducted <= 0) continue;
      await tx.branchInventory.updateMany({
        where: { branchId, skuId: item.skuId },
        data: { stock: { increment: item.deducted } },
      });
      await tx.sessionItem.update({
        where: { id: item.id },
        data: { deducted: 0 },
      });
    }
  }

  /** D41: a main product reported missing / out of stock sets that SKU's branch stock to 0 until a newer ERP snapshot. */
  private async zeroShelf(
    tx: Tx,
    branchId: string,
    items: { skuId: string }[],
    now: Date,
  ) {
    for (const item of items) {
      await tx.branchInventory.updateMany({
        where: { branchId, skuId: item.skuId },
        data: { stock: 0, outOfStockAt: now },
      });
    }
  }

  /**
   * The main products a stock report names the way reports did before F3: by name ("สินค้าหลัก", the model, the SKU name or
   * code), unless the product is also listed as found. Reports made now carry item ids and never reach this.
   */
  private legacyMissingItems(
    items: SessionItemRow[],
    missingNames: string[],
    foundNames: string[],
  ): SessionItemRow[] {
    return items.filter((item) => {
      const modelName = item.sku.model.name;
      const label = modelName || item.sku.name || item.sku.model.product.name;
      if (foundNames.some((f) => f === label || f.includes(modelName))) return false;
      return missingNames.some(
        (name) =>
          name === 'สินค้าหลัก' ||
          name === modelName ||
          name === item.sku.name ||
          name === item.sku.sku,
      );
    });
  }

  /**
   * SES-YYYYMMDD-NNNNNN is the internal key (lookups, links); staff see the queue number instead (D57). A number that is
   * already taken (a session from before the counters existed, a restored backup) is skipped, never failed.
   */
  private async newReference(tx: Tx, day: string): Promise<string> {
    let reference: string;
    do {
      const referenceNo = await this.queue.nextNumber(tx, 'reference', day);
      reference = `SES-${day.replaceAll('-', '')}-${String(referenceNo).padStart(6, '0')}`;
    } while (
      await tx.customerSession.findUnique({
        where: { reference },
        select: { id: true },
      })
    );
    return reference;
  }

  /** The items of a selection: every SKU must exist (an id or a SKU code) and appear only once. */
  private async resolveItems(tx: Tx, items: SessionItemDto[]) {
    const resolved: { skuId: string; quantity: number }[] = [];
    for (const item of items) {
      const sku = await tx.productSku.findFirst({
        where: { OR: [{ id: item.skuId }, { sku: item.skuId }] },
        select: { id: true },
      });
      if (!sku) {
        throw new BadRequestException(`ไม่พบสินค้า (SKU) ${item.skuId}`);
      }
      if (resolved.some((r) => r.skuId === sku.id)) {
        throw new BadRequestException(`สินค้า (SKU) ${item.skuId} ซ้ำในรายการ`);
      }
      resolved.push({ skuId: sku.id, quantity: item.quantity });
    }
    return resolved;
  }

  private checkRole(user: PublicAccount, role: 'STAFF' | 'STOCK' | 'CASHIER' | 'MANAGER' | 'ADMIN') {
    if (user.roles.includes('ADMIN')) return;
    if (!user.roles.includes(role)) {
      throw new ForbiddenException(`Missing required role: ${role}`);
    }
  }

  private checkBranchAccess(user: PublicAccount, branchId: string) {
    if (user.roles.includes('ADMIN')) return;
    if (user.branchId !== branchId) {
      throw new ForbiddenException('Cannot access sessions outside of assigned branch');
    }
  }

  async list(user: PublicAccount, filterBranchId?: string) {
    const isAdmin = user.roles.includes('ADMIN');
    let branchId = isAdmin ? filterBranchId : user.branchId;

    if (!isAdmin && !branchId) {
      throw new ForbiddenException('User has no assigned branch');
    }

    if (branchId) {
      const branch = await this.prisma.branch.findFirst({
        where: { OR: [{ id: branchId }, { code: branchId }] },
      });
      if (branch) {
        branchId = branch.id;
      }
    }

    return this.prisma.customerSession.findMany({
      where: branchId ? { branchId } : undefined,
      include: sessionInclude,
      orderBy: { customerWalkInAt: 'desc' },
    });
  }

  /**
   * D100: the FileMaker side of each order, for the people at the shop: the latest message SES sent for it and what FileMaker
   * answered (the `ses` script's verdict, D95, or a report on the callback door, D90). `null` when nothing was sent (FileMaker
   * off, or the order has not reached the cashier).
   */
  async withFmp<T extends { id: string }>(sessions: T[]) {
    const ids = sessions.map((s) => s.id);
    const rows = ids.length
      ? await this.prisma.fmpOutbox.findMany({
          where: { sessionId: { in: ids } },
          orderBy: { createdAt: 'desc' },
          select: { sessionId: true, status: true, attempts: true, lastError: true, ackStatus: true, ackMessage: true, ackReceivedAt: true, sentAt: true, createdAt: true },
        })
      : [];
    const latest = new Map<string, (typeof rows)[number]>();
    for (const r of rows) if (!latest.has(r.sessionId)) latest.set(r.sessionId, r);
    return sessions.map((s) => {
      const r = latest.get(s.id);
      return {
        ...s,
        fmp: r
          ? {
              status: r.status, // pending | sending | sent | failed
              attempts: r.attempts,
              error: r.status === 'sent' ? null : r.lastError,
              ackStatus: r.ackStatus, // success | error | reported | null (no answer yet)
              ackMessage: r.ackMessage,
              at: (r.ackReceivedAt ?? r.sentAt ?? r.createdAt).toISOString(),
            }
          : null,
      };
    });
  }

  async getById(user: PublicAccount, idOrRef: string) {
    const session = await this.prisma.customerSession.findFirst({
      where: {
        OR: [{ id: idOrRef }, { reference: idOrRef }],
      },
      include: sessionInclude,
    });

    if (!session) {
      throw new NotFoundException('Session not found');
    }

    this.checkBranchAccess(user, session.branchId);
    return session;
  }

  async createWalkIn(user: PublicAccount, dto: CreateSessionDto) {
    this.checkRole(user, 'STAFF');
    const branchKey = user.roles.includes('ADMIN') ? (dto.branchId ?? user.branchId) : user.branchId;

    let targetBranch = null;
    if (branchKey) {
      targetBranch = await this.prisma.branch.findFirst({
        where: {
          active: true,
          OR: [{ id: branchKey }, { code: branchKey }],
        },
      });
    }

    if (!targetBranch && user.roles.includes('ADMIN')) {
      targetBranch = await this.prisma.branch.findFirst({
        where: { active: true },
        orderBy: { code: 'asc' },
      });
    }

    if (!targetBranch) {
      throw new BadRequestException('ยังไม่มีสาขา (Branch) ในระบบ กรุณาสร้างสาขาก่อนเริ่มบันทึก Session');
    }

    // READ COMMITTED (see the options at the end): the counters are hot rows, so each statement must see the latest
    // committed number. Under MariaDB's snapshot isolation a REPEATABLE READ walk-in would fail on a row another one just
    // committed (ADR 0001).
    return this.prisma.$transaction(async (tx) => {
      const now = new Date();
      const day = bangkokDay(now);

      // D56: a walk-in starts at the phone number, so the Customer exists from the first moment.
      const customer = await tx.customer.upsert({
        where: { phone: dto.phone },
        create: { phone: dto.phone },
        update: {},
      });
      if (dto.customerTypeId) {
        const type = await tx.customerType.findUnique({
          where: { id: dto.customerTypeId },
        });
        if (!type || !type.active) {
          throw new BadRequestException('ไม่พบประเภทลูกค้าที่เปิดใช้งาน');
        }
      }

      // D70: queue number is allocated at confirmation, not at walk-in.
      const reference = await this.newReference(tx, day);

      return tx.customerSession.create({
        data: {
          reference,
          branchId: targetBranch.id,
          staffId: user.staffId,
          customerId: customer.id,
          phone: dto.phone,
          customerTypeId: null,
          queueLetter: null,
          queueNo: null,
          state: 'PRODUCT_SELECTION',
          customerWalkInAt: now,
          productSelectionStartAt: now,
          events: {
            create: [
              {
                eventType: 'SESSION_CREATED',
                actorStaffId: user.staffId,
                createdAt: now,
                metadata: {
                  phone: dto.phone,
                },
              },
              {
                eventType: 'PRODUCT_SELECTION_STARTED',
                actorStaffId: user.staffId,
                createdAt: now,
              },
            ],
          },
        },
        include: sessionInclude,
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
  }

  /**
   * F17 (D60): the orders of a branch that have reached the cashier and have no bill yet, with their lines, for U POS to
   * prefill a bill from. `queue` ("A012") narrows to one queue number. Read-only; the caller is U POS, not a user.
   */
  async posOrders(branchCode: string, queue?: string) {
    const branch = await this.prisma.branch.findFirst({
      where: { code: branchCode },
      orderBy: { active: 'desc' },
    });
    if (!branch) throw new NotFoundException('Unknown branch');
    const sessions = await this.prisma.customerSession.findMany({
      where: {
        branchId: branch.id,
        outcome: null,
        state: { in: ['SENT_TO_CASHIER', 'CASHIER_RECEIVED', 'CASHIER_SCAN'] },
      },
      include: sessionInclude,
      orderBy: { customerWalkInAt: 'asc' },
    });
    const wanted = queue?.toUpperCase();
    const paymentTypes = await loadPaymentTypes(this.prisma);
    return {
      branch: { code: branch.code, name: branch.name },
      orders: sessions
        .map((s) => orderView(s, paymentTypes))
        .filter((order) => !wanted || order.queue === wanted),
    };
  }

  /**
   * F17 (D60): U POS opened the bill of an order. The bill number and its real time are recorded; an order that is still at
   * the cashier moves on to BILL_OPENED (milestone = the real time, the cashier does not press anything in SES). When the
   * cashier pressed first, SES's own milestone stays and the U POS bill is added beside it. The same report again changes
   * nothing; another bill number for the same order is a conflict.
   */
  async recordPosBill(dto: { reference: string; billNo: string; openedAt: string }) {
    const session = await this.prisma.customerSession.findUnique({
      where: { reference: dto.reference },
      include: sessionInclude,
    });
    if (!session) throw new NotFoundException('Unknown order');
    if (session.outcome) throw new ConflictException('The order has ended');
    const summary = (s: { reference: string; state: string; posBillNo: string | null; posBillOpenedAt: Date | null; billOpenedAt: Date | null }) => ({
      reference: s.reference,
      state: s.state,
      posBillNo: s.posBillNo,
      posBillOpenedAt: s.posBillOpenedAt,
      billOpenedAt: s.billOpenedAt,
    });
    if (session.posBillNo !== null) {
      if (session.posBillNo === dto.billNo) return summary(session);
      throw new ConflictException('This order already has another bill');
    }

    const openedAt = new Date(dto.openedAt);
    const now = Date.now();
    if (
      openedAt.getTime() > now + 5 * 60_000 ||
      openedAt.getTime() < now - 366 * 86_400_000 ||
      openedAt < session.customerWalkInAt
    ) {
      throw new BadRequestException('openedAt is not a plausible time for this order');
    }
    const atCashier = ['SENT_TO_CASHIER', 'CASHIER_RECEIVED', 'CASHIER_SCAN'].includes(session.state);
    if (!atCashier && !['BILL_OPENED', 'COMPLETED'].includes(session.state)) {
      throw new ConflictException('The order has not reached the cashier');
    }

    // the event keeps its place in the history even if the bill was opened before SES saw the last step
    const lastEvent = session.events.at(-1)?.createdAt ?? openedAt;
    const eventAt = openedAt > lastEvent ? openedAt : lastEvent;
    const updated = await this.prisma.customerSession.update({
      where: { id: session.id },
      data: {
        posBillNo: dto.billNo,
        posBillOpenedAt: openedAt,
        ...(atCashier
          ? {
              state: 'BILL_OPENED',
              billOpenedAt: openedAt,
              events: {
                create: {
                  eventType: 'BILL_OPENED',
                  actorStaffId: 'U-POS',
                  createdAt: eventAt,
                  metadata: {
                    source: 'U-POS',
                    billNo: dto.billNo,
                    openedAt: openedAt.toISOString(),
                  },
                },
              },
            }
          : {}),
      },
    });
    return summary(updated);
  }

  /**
   * H-01: claims the session row inside the caller's transaction (`SELECT … FOR UPDATE`) under the same condition the method
   * checked on its plain read. A second click or a retry waits on the lock, then reads the committed row, finds the condition
   * false and gets 409, instead of applying the action twice (stock taken or given back twice, two events, a timestamp overwritten).
   */
  private async claim(tx: Prisma.TransactionClient, id: string, condition: Prisma.Sql) {
    const rows = await tx.$queryRaw<{ id: string }[]>(
      Prisma.sql`SELECT id FROM CustomerSession WHERE id = ${id} AND ${condition} FOR UPDATE`,
    );
    if (rows.length !== 1) throw new ConflictException('รายการนี้ถูกดำเนินการไปแล้ว (อาจกดซ้ำ) กรุณารีเฟรชหน้า');
  }

  async advanceStep(user: PublicAccount, id: string, dto: AdvanceStepDto) {
    const session = await this.getById(user, id);

    if (session.outcome || session.state === 'COMPLETED') {
      throw new BadRequestException('Session is finished and cannot be advanced');
    }

    const step = STEPS[dto.action];
    if (!step) {
      throw new BadRequestException(`Unknown step action: ${dto.action}`);
    }

    this.checkRole(user, step.requiredRole);

    if (session.state !== step.from) {
      throw new BadRequestException(
        `Cannot execute ${dto.action} from state ${session.state} (expected ${step.from})`,
      );
    }

    if (dto.action === 'startSelection' && !session.decisionAt) {
      throw new BadRequestException('Must record BUY decision before starting selection');
    }

    // D92: the goods leave stock with their serial numbers; checked before anything is written
    const serials = dto.action === 'send' ? this.checkSerials(session.items, dto.serials) : [];

    const now = new Date();

    return this.prisma.$transaction(async (tx) => {
      await this.claim(tx, session.id, Prisma.sql`state = ${step.from} AND outcome IS NULL`); // H-01
      if (dto.action === 'send') await this.saveSerials(tx, session, serials);
      const deducted =
        dto.action === 'found'
          ? await this.takeItemsFromShelf(tx, session.branchId, session.items)
          : undefined;

      const updated = await tx.customerSession.update({
        where: { id: session.id },
        data: {
          state: step.to,
          ...(step.timestampField ? { [step.timestampField]: now } : {}),
          events: {
            create: {
              eventType: step.eventType,
              actorStaffId: user.staffId,
              createdAt: now,
              ...(deducted === undefined ? {} : { metadata: { deducted } }),
            },
          },
        },
        include: sessionInclude,
      });

      // D88: the order is now at the cashier: tell FileMaker (queued in this transaction, sent by the worker)
      if (dto.action === 'send') await this.fmp.enqueue(tx, updated, 'SENT_TO_CASHIER');

      return updated;
    });
  }

  /**
   * D92: STOCK scans the serial number of every unit when it sends the goods to the cashier (the FileMaker bill script opens the
   * bill from them). Exactly `quantity` per main product, each printable ASCII without spaces, none twice. Returns what to save.
   */
  private checkSerials(
    items: { id: string; quantity: number; sku: { name: string } }[],
    given: { itemId: string; sn: string[] }[] | undefined,
  ): { itemId: string; sn: string[] }[] {
    if (!items.length) return [];
    if (!given?.length) throw new BadRequestException('ต้องสแกน Serial Number ของสินค้าทุกเครื่องก่อนส่งไปแคชเชียร์');
    const byItem = new Map<string, string[]>();
    for (const entry of given) {
      if (!items.some((i) => i.id === entry.itemId)) throw new BadRequestException(`ไม่พบรายการสินค้า ${entry.itemId} ในออเดอร์นี้`);
      if (byItem.has(entry.itemId)) throw new BadRequestException('ส่ง Serial Number ของสินค้ารายการเดียวกันมากกว่าหนึ่งชุด');
      // D95: FileMaker keeps serial numbers in capitals (Apple serials, IMEIs): a typed lower-case one would never match
      byItem.set(entry.itemId, entry.sn.map((sn) => sn.trim().toUpperCase()));
    }
    const seen = new Set<string>();
    const out: { itemId: string; sn: string[] }[] = [];
    for (const item of items) {
      const sn = byItem.get(item.id);
      if (!sn) throw new BadRequestException(`${item.sku.name}: ยังไม่ได้สแกน Serial Number`);
      if (sn.length !== item.quantity)
        throw new BadRequestException(`${item.sku.name}: ต้องสแกน ${item.quantity} เครื่อง แต่ได้ ${sn.length}`);
      for (const one of sn) {
        if (!/^[\x21-\x7E]{1,64}$/.test(one))
          throw new BadRequestException(`Serial Number "${one}" ไม่ถูกต้อง (ใช้ตัวอักษรหรือตัวเลขที่พิมพ์ได้ ไม่มีเว้นวรรค ยาวไม่เกิน 64 ตัว)`);
        const key = one.toLowerCase();
        if (seen.has(key)) throw new BadRequestException(`Serial Number "${one}" ซ้ำกันในรายการที่สแกน`);
        seen.add(key);
      }
      out.push({ itemId: item.id, sn });
    }
    return out;
  }

  /**
   * D92: replaces the serial numbers of the session with the ones just scanned. A serial that is in another order that is still
   * open (not cancelled, not sold) is refused: one unit cannot be promised to two customers. (Two scans at the very same moment
   * can both pass; FileMaker's script refuses the second bill, `SN_ALREADY_SOLD_OR_HELD`.)
   */
  private async saveSerials(
    tx: Prisma.TransactionClient,
    session: { id: string },
    serials: { itemId: string; sn: string[] }[],
  ) {
    if (!serials.length) return;
    const all = serials.flatMap((s) => s.sn);
    const taken = await tx.sessionItemSerial.findFirst({
      where: {
        sn: { in: all },
        item: { session: { id: { not: session.id }, outcome: null, state: { not: 'COMPLETED' } } },
      },
      include: { item: { select: { session: { select: { reference: true, queueLetter: true, queueNo: true } } } } },
    });
    if (taken) {
      const other = taken.item.session;
      const queue = other.queueNo === null ? other.reference : formatQueue(other.queueLetter, other.queueNo);
      throw new ConflictException(`Serial Number "${taken.sn}" อยู่ในออเดอร์ ${queue} ที่ยังไม่จบ`);
    }
    await tx.sessionItemSerial.deleteMany({ where: { item: { sessionId: session.id } } });
    for (const { itemId, sn } of serials)
      await tx.sessionItemSerial.createMany({ data: sn.map((one, position) => ({ sessionItemId: itemId, sn: one, position })) });
  }

  async recordNotBuy(user: PublicAccount, id: string, dto: NotBuyDto) {
    this.checkRole(user, 'STAFF');
    const session = await this.getById(user, id);

    if (session.outcome || session.state !== 'DECISION') {
      throw new BadRequestException('Can only record NOT_BUY during DECISION stage');
    }

    if (!dto.reason || (dto.reason === 'อื่น ๆ' && !dto.otherReason?.trim())) {
      throw new BadRequestException('Reason is required for NOT_BUY');
    }

    const now = new Date();

    return this.prisma.$transaction(async (tx) => {
      return tx.customerSession.update({
        where: { id: session.id },
        data: {
          outcome: 'NOT_BUY',
          reason: dto.reason,
          otherReason: dto.otherReason?.trim() || null,
          decisionAt: now,
          events: {
            create: {
              eventType: 'DECISION_MADE',
              actorStaffId: user.staffId,
              createdAt: now,
              metadata: { outcome: 'NOT_BUY', reason: dto.reason },
            },
          },
        },
        include: sessionInclude,
      });
    });
  }

  async updateSelection(user: PublicAccount, id: string, dto: UpdateSelectionDto) {
    this.checkRole(user, 'STAFF');
    const session = await this.getById(user, id);

    const isEditable =
      !session.confirmed &&
      !session.outcome &&
      (session.state === 'PRODUCT_SELECTION' ||
        (session.state === 'DECISION' && session.decisionAt !== null));

    if (!isEditable) {
      throw new BadRequestException('Purchase data is locked and cannot be edited');
    }

    if (dto.phone && !/^[0-9]{10}$/.test(dto.phone)) {
      throw new BadRequestException('Phone number must contain exactly 10 digits (0-9)');
    }

    return this.prisma.$transaction(async (tx) => {
      let customerId = session.customerId;
      if (dto.phone) {
        const customer = await tx.customer.upsert({
          where: { phone: dto.phone },
          create: { phone: dto.phone },
          update: {},
        });
        customerId = customer.id;
      }

      // F3: the main products, replaced as a whole (a save without `items` leaves them alone)
      if (dto.items) {
        const items = await this.resolveItems(tx, dto.items);
        await tx.sessionItem.deleteMany({ where: { sessionId: session.id } });
        const base = Date.now();
        for (const [index, item] of items.entries()) {
          await tx.sessionItem.create({
            data: {
              sessionId: session.id,
              skuId: item.skuId,
              quantity: item.quantity,
              // one millisecond apart, so they come back in the order the staff added them
              createdAt: new Date(base + index),
            },
          });
        }
      }

      // Update accessories
      if (dto.accessories) {
        await tx.sessionAccessory.deleteMany({ where: { sessionId: session.id } });
        for (const acc of dto.accessories) {
          if (acc.quantity > 0) {
            await tx.sessionAccessory.create({
              data: {
                sessionId: session.id,
                accessoryName: acc.accessoryName,
                quantity: acc.quantity,
              },
            });
          }
        }
      }

      // Update ontop
      if (dto.ontop) {
        await tx.sessionOntop.deleteMany({ where: { sessionId: session.id } });
        for (const name of dto.ontop) {
          if (name !== 'None') {
            await tx.sessionOntop.create({
              data: { sessionId: session.id, name },
            });
          }
        }
      }

      // Update points
      if (dto.points) {
        await tx.sessionPoint.deleteMany({ where: { sessionId: session.id } });
        for (const name of dto.points) {
          if (name !== 'None') {
            await tx.sessionPoint.create({
              data: { sessionId: session.id, name },
            });
          }
        }
      }

      // Update burnPoints
      if (dto.burnPoints) {
        await tx.sessionBurnPoint.deleteMany({ where: { sessionId: session.id } });
        for (const name of dto.burnPoints) {
          if (name !== 'None') {
            await tx.sessionBurnPoint.create({
              data: { sessionId: session.id, name },
            });
          }
        }
      }

      // Update payments and auto-classify customer type (D69, D70)
      let nextCustomerTypeId = session.customerTypeId;
      if (dto.payments) {
        await tx.sessionPayment.deleteMany({ where: { sessionId: session.id } });
        for (const method of dto.payments) {
          await tx.sessionPayment.create({
            data: { sessionId: session.id, method },
          });
        }
      }

      if (dto.payments || dto.ontop || dto.points || dto.burnPoints) {
        const types = await tx.customerType.findMany({
          where: { active: true },
          orderBy: { letter: 'asc' },
        });

        const allPayments =
          dto.payments ??
          (
            await tx.sessionPayment.findMany({
              where: { sessionId: session.id },
            })
          ).map((p) => p.method);
        const allOntop =
          dto.ontop ??
          (
            await tx.sessionOntop.findMany({
              where: { sessionId: session.id },
            })
          ).map((o) => o.name);
        const allPoints =
          dto.points ??
          (
            await tx.sessionPoint.findMany({
              where: { sessionId: session.id },
            })
          ).map((p) => p.name);
        const allBurnPoints =
          dto.burnPoints ??
          (
            await tx.sessionBurnPoint.findMany({
              where: { sessionId: session.id },
            })
          ).map((b) => b.name);

        const matchesType = (t: {
          paymentMethods: unknown;
          ontop: unknown;
          points: unknown;
          burnPoints: unknown;
        }) => {
          const pm = Array.isArray(t.paymentMethods)
            ? (t.paymentMethods as string[])
            : [];
          const ot = Array.isArray(t.ontop) ? (t.ontop as string[]) : [];
          const pt = Array.isArray(t.points) ? (t.points as string[]) : [];
          const bp = Array.isArray(t.burnPoints)
            ? (t.burnPoints as string[])
            : [];

          return (
            pm.some((m) => allPayments.includes(m)) ||
            ot.some((m) => allOntop.includes(m)) ||
            pt.some((m) => allPoints.includes(m)) ||
            bp.some((m) => allBurnPoints.includes(m))
          );
        };

        const matchedType =
          types.find((t) => t.letter === 'B' && matchesType(t)) ||
          types.find((t) => matchesType(t));

        if (matchedType) {
          nextCustomerTypeId = matchedType.id;
        } else if (session.queueLetter) {
          const defaultType = types.find((t) => t.letter === session.queueLetter);
          if (defaultType) nextCustomerTypeId = defaultType.id;
        } else {
          const defaultType = types.find((t) => t.letter === 'A') || types[0];
          if (defaultType) nextCustomerTypeId = defaultType.id;
        }
      }

      return tx.customerSession.update({
        where: { id: session.id },
        data: {
          phone: dto.phone ?? session.phone,
          customerId,
          customerTypeId: nextCustomerTypeId,
        },
        include: sessionInclude,
      });
    });
  }

  async confirmPurchase(user: PublicAccount, id: string) {
    this.checkRole(user, 'STAFF');
    const session = await this.getById(user, id);

    if (session.confirmed || session.state !== 'PRODUCT_SELECTION' || session.outcome) {
      throw new BadRequestException('Session is already confirmed or cannot be confirmed');
    }

    if (!session.phone || !/^[0-9]{10}$/.test(session.phone)) {
      throw new BadRequestException('Valid customer phone number (10 digits) is required to confirm purchase');
    }

    if (session.items.length === 0) {
      throw new BadRequestException('A main product selection is required before confirmation');
    }

    const now = new Date();

    return this.prisma.$transaction(async (tx) => {
      await this.claim(tx, session.id, Prisma.sql`state = 'PRODUCT_SELECTION' AND outcome IS NULL AND confirmed = false`); // H-01
      // D70: allocate queue number if not already allocated (e.g. rebuy keeps old queue)
      let customerTypeId = session.customerTypeId;
      let queueLetter = session.queueLetter;
      let queueNo = session.queueNo;

      if (queueNo === null) {
        const types = await tx.customerType.findMany({
          where: { active: true },
          orderBy: { letter: 'asc' },
        });

        const paymentNames = session.payments.map((p) => p.method);
        const ontopNames = session.ontop.map((o) => o.name);
        const pointNames = session.points.map((p) => p.name);
        const burnPointNames = session.burnPoints.map((b) => b.name);

        const matchesType = (t: {
          paymentMethods: unknown;
          ontop: unknown;
          points: unknown;
          burnPoints: unknown;
        }) => {
          const pm = Array.isArray(t.paymentMethods)
            ? (t.paymentMethods as string[])
            : [];
          const ot = Array.isArray(t.ontop) ? (t.ontop as string[]) : [];
          const pt = Array.isArray(t.points) ? (t.points as string[]) : [];
          const bp = Array.isArray(t.burnPoints)
            ? (t.burnPoints as string[])
            : [];

          return (
            pm.some((m) => paymentNames.includes(m)) ||
            ot.some((m) => ontopNames.includes(m)) ||
            pt.some((m) => pointNames.includes(m)) ||
            bp.some((m) => burnPointNames.includes(m))
          );
        };

        const matchedType =
          types.find((t) => t.letter === 'B' && matchesType(t)) ||
          types.find((t) => matchesType(t)) ||
          types.find((t) => t.letter === 'A') ||
          types[0];

        if (!matchedType) {
          throw new BadRequestException('ไม่พบประเภทลูกค้าที่เปิดใช้งาน');
        }

        const queue = await this.queue.allocate(
          tx,
          session.branchId,
          matchedType.id,
          now,
        );
        customerTypeId = queue.customerTypeId;
        queueLetter = queue.queueLetter;
        queueNo = queue.queueNo;
      }

      const queueStr = formatQueue(queueLetter, queueNo ?? 0);

      return tx.customerSession.update({
        where: { id: session.id },
        data: {
          confirmed: true,
          state: 'STOCK_REQUESTED',
          productSelectionConfirmedAt: now,
          customerTypeId,
          queueLetter,
          queueNo,
          events: {
            create: {
              eventType: 'PRODUCT_SELECTION_CONFIRMED',
              actorStaffId: user.staffId,
              createdAt: now,
              metadata: {
                queue: queueStr,
              },
            },
          },
        },
        include: sessionInclude,
      });
    });
  }

  async recordOutOfStock(user: PublicAccount, id: string, dto: OutOfStockDto) {
    this.checkRole(user, 'STOCK');
    const session = await this.getById(user, id);

    if (session.outcome || session.state !== 'SEARCHING') {
      throw new BadRequestException('OUT_OF_STOCK can only be recorded during SEARCHING stage');
    }

    const now = new Date();
    const outOfStockItems = dto.outOfStockItems || [];

    return this.prisma.$transaction(async (tx) => {
      await this.claim(tx, session.id, Prisma.sql`state = 'SEARCHING' AND outcome IS NULL`); // H-01
      if (dto.action === 'partial') {
        // Customer proceeds with remaining items: remove out of stock items and advance to FOUND
        const missing = session.items.filter(
          (item) =>
            outOfStockItems.includes('MAIN_PRODUCT') ||
            outOfStockItems.includes(item.sku.sku) ||
            outOfStockItems.includes(item.sku.model.product.name),
        );
        await this.zeroShelf(tx, session.branchId, missing, now);
        await tx.sessionItem.deleteMany({
          where: { id: { in: missing.map((item) => item.id) } },
        });
        const deducted = await this.takeItemsFromShelf(
          tx,
          session.branchId,
          session.items.filter((item) => !missing.includes(item)),
        );

        if (outOfStockItems.length > 0) {
          await tx.sessionAccessory.deleteMany({
            where: {
              sessionId: session.id,
              accessoryName: { in: outOfStockItems },
            },
          });
        }

        return tx.customerSession.update({
          where: { id: session.id },
          data: {
            state: 'FOUND',
            stockFoundAt: now,
            events: {
              create: {
                eventType: 'STOCK_FOUND',
                actorStaffId: user.staffId,
                createdAt: now,
                metadata: {
                  partialFulfillment: true,
                  outOfStockItems,
                  note: dto.note || dto.otherReason || null,
                  deducted,
                },
              },
            },
          },
          include: sessionInclude,
        });
      }

      // Customer cancels entire session due to out of stock
      await this.zeroShelf(tx, session.branchId, session.items, now);

      const detailedReason =
        dto.otherReason ||
        (outOfStockItems.length > 0 ? `สินค้าหมด: ${outOfStockItems.join(', ')}` : null);

      return tx.customerSession.update({
        where: { id: session.id },
        data: {
          outcome: 'OUT_OF_STOCK',
          reason: dto.reason || 'OUT_OF_STOCK',
          otherReason: detailedReason,
          events: {
            create: {
              eventType: 'STOCK_OUT_OF_STOCK',
              actorStaffId: user.staffId,
              createdAt: now,
              metadata: {
                outOfStockItems,
                note: dto.note || dto.otherReason || null,
              },
            },
          },
        },
        include: sessionInclude,
      });
    });
  }

  async cancelSession(user: PublicAccount, id: string, dto: CancelSessionDto) {
    const session = await this.getById(user, id);

    if (session.outcome || session.state === 'COMPLETED') {
      throw new BadRequestException('Session is already ended');
    }

    // F12: any role of the branch can cancel at any stage (`getById` already limited the session to the user's branch)
    if (!dto.reason || (dto.reason === 'อื่น ๆ' && !dto.otherReason?.trim())) {
      throw new BadRequestException('Cancellation reason is required');
    }

    const now = new Date();
    // F12: after the stock request, stock has to be told (the notice stays until it acknowledges). Nothing to tell when
    // a STOCK user cancels before anything was picked: they know already.
    const goodsPicked = session.stockFoundAt !== null || FOUND_OR_LATER.includes(session.state);
    const stockKnows =
      session.productSelectionConfirmedAt !== null && !goodsPicked && user.roles.includes('STOCK');

    return this.prisma.$transaction(async (tx) => {
      await this.claim(tx, session.id, Prisma.sql`outcome IS NULL AND state <> 'COMPLETED'`); // H-01
      // Give back what FOUND took off the shelf (D41): exactly the units recorded per item (none while "stock unlimited" was on, D59)
      await this.returnItemsToShelf(tx, session.branchId, session.items);

      return tx.customerSession.update({
        where: { id: session.id },
        data: {
          outcome: 'CUSTOMER_CANCELLED',
          reason: dto.reason,
          otherReason: dto.otherReason?.trim() || null,
          cancelledBy: user.staffId,
          cancelledAt: now,
          ...(stockKnows ? { stockAckAt: now, stockAckBy: user.staffId } : {}),
          events: {
            create: {
              eventType: 'CUSTOMER_CANCELLED',
              actorStaffId: user.staffId,
              createdAt: now,
              metadata: { reason: dto.reason, otherReason: dto.otherReason },
            },
          },
        },
        include: sessionInclude,
      });
    });
  }

  /**
   * F13: the cashier sends the order back to stock (the wrong item was picked). Allowed from SENT_TO_CASHIER,
   * CASHIER_RECEIVED and CASHIER_SCAN, not once the bill is open. The units FOUND took go back to the shelf, the session is
   * at the stock stage again (SEARCHING) and its milestones for the stock-found and cashier steps start over; the first
   * round stays in the events (CASHIER_REJECTED, then a second STOCK_FOUND...).
   */
  async cashierReject(user: PublicAccount, id: string, dto: CashierRejectDto) {
    this.checkRole(user, 'CASHIER');
    const session = await this.getById(user, id);

    if (
      session.outcome ||
      !['SENT_TO_CASHIER', 'CASHIER_RECEIVED', 'CASHIER_SCAN'].includes(session.state)
    ) {
      throw new BadRequestException(
        'Only an order that is with the cashier and not yet billed can be sent back to stock',
      );
    }
    if (dto.reason === 'อื่น ๆ' && !dto.otherReason?.trim()) {
      throw new BadRequestException('Reason is required to send an order back to stock');
    }

    const now = new Date();
    return this.prisma.$transaction(async (tx) => {
      await this.claim(tx, session.id, Prisma.sql`outcome IS NULL AND state IN ('SENT_TO_CASHIER', 'CASHIER_RECEIVED', 'CASHIER_SCAN')`); // H-01
      await this.returnItemsToShelf(tx, session.branchId, session.items);
      // D92: the units go back to the shelf, so the serial numbers scanned for them are no longer true; STOCK scans again
      await tx.sessionItemSerial.deleteMany({ where: { item: { sessionId: session.id } } });
      return tx.customerSession.update({
        where: { id: session.id },
        data: {
          state: 'SEARCHING',
          stockFoundAt: null,
          cashierReceivedAt: null,
          cashierScanAt: null,
          events: {
            create: {
              eventType: 'CASHIER_REJECTED',
              actorStaffId: user.staffId,
              createdAt: now,
              metadata: {
                reason: dto.reason,
                otherReason: dto.otherReason?.trim() || null,
                wrongItems: dto.wrongItems ?? [],
                wrongItemIds: dto.wrongItemIds ?? [],
                wrongItemDetails: dto.wrongItemDetails ?? null,
                fromState: session.state,
              },
            },
          },
        },
        include: sessionInclude,
      });
    });
  }

  /**
   * D75: Cashier removes damaged item(s) from an order and proceeds with remaining items.
   * If all items in the order are removed, the session is cancelled with CUSTOMER_CANCELLED (reason: 'สินค้าชำรุด/มีตำหนิ').
   */
  async cashierRemoveDamaged(user: PublicAccount, id: string, dto: CashierRemoveDamagedDto) {
    this.checkRole(user, 'CASHIER');
    const session = await this.getById(user, id);

    if (
      session.outcome ||
      !['SENT_TO_CASHIER', 'CASHIER_RECEIVED', 'CASHIER_SCAN'].includes(session.state)
    ) {
      throw new BadRequestException(
        'Only an order that is with the cashier and not yet billed can have damaged items removed',
      );
    }
    if (!Array.isArray(dto.itemIds) || dto.itemIds.length === 0) {
      throw new BadRequestException('At least one item must be specified to remove');
    }

    const removedItemIds = new Set(dto.itemIds);
    const removedMainItems = session.items.filter(
      (item) => removedItemIds.has(item.id) || removedItemIds.has(item.skuId),
    );
    const removedAccessories = session.accessories.filter(
      (acc) => removedItemIds.has(acc.id) || removedItemIds.has(acc.accessoryName),
    );

    const remainingMainCount = session.items.length - removedMainItems.length;
    const remainingAccCount = session.accessories.length - removedAccessories.length;
    const totalRemaining = remainingMainCount + remainingAccCount;

    const now = new Date();
    const removedNames = [
      ...removedMainItems.map((i) => `${i.sku.name} (${i.sku.sku})`),
      ...removedAccessories.map((a) => `${a.accessoryName} (x${a.quantity})`),
    ];

    return this.prisma.$transaction(async (tx) => {
      await this.claim(tx, session.id, Prisma.sql`outcome IS NULL AND state IN ('SENT_TO_CASHIER', 'CASHIER_RECEIVED', 'CASHIER_SCAN')`); // H-01
      // the same items may have been removed by a click a moment ago: only what is still on the order counts
      const stillThere = await tx.sessionItem.count({ where: { sessionId: session.id, id: { in: removedMainItems.map((i) => i.id) } } });
      const accStillThere = await tx.sessionAccessory.count({ where: { sessionId: session.id, id: { in: removedAccessories.map((a) => a.id) } } });
      if (stillThere !== removedMainItems.length || accStillThere !== removedAccessories.length)
        throw new ConflictException('รายการนี้ถูกดำเนินการไปแล้ว (อาจกดซ้ำ) กรุณารีเฟรชหน้า');
      // Return deducted units of the removed main items to shelf
      await this.returnItemsToShelf(tx, session.branchId, removedMainItems);

      // If all items are removed, cancel the session
      if (totalRemaining <= 0) {
        return tx.customerSession.update({
          where: { id: session.id },
          data: {
            outcome: 'CUSTOMER_CANCELLED',
            reason: 'สินค้าชำรุด/มีตำหนิ',
            otherReason: dto.note?.trim() || null,
            cancelledBy: user.staffId,
            cancelledAt: now,
            events: {
              create: {
                eventType: 'CUSTOMER_CANCELLED',
                actorStaffId: user.staffId,
                createdAt: now,
                metadata: {
                  reason: 'สินค้าชำรุด/มีตำหนิ',
                  otherReason: dto.note?.trim() || null,
                  removedItems: removedNames,
                  allRemoved: true,
                },
              },
            },
          },
          include: sessionInclude,
        });
      }

      // Delete removed main product rows
      for (const item of removedMainItems) {
        await tx.sessionItem.delete({ where: { id: item.id } });
      }

      // Delete removed accessory rows
      for (const acc of removedAccessories) {
        await tx.sessionAccessory.delete({ where: { id: acc.id } });
      }

      // Record CASHIER_REJECTED event with action: REMOVE_DAMAGED
      return tx.customerSession.update({
        where: { id: session.id },
        data: {
          events: {
            create: {
              eventType: 'CASHIER_REJECTED',
              actorStaffId: user.staffId,
              createdAt: now,
              metadata: {
                action: 'REMOVE_DAMAGED',
                reason: 'สินค้าชำรุด/มีตำหนิ',
                otherReason: dto.note?.trim() || null,
                removedItems: removedNames,
                removedItemIds: dto.itemIds,
              },
            },
          },
        },
        include: sessionInclude,
      });
    });
  }

  /**
   * D78: Staff or Cashier changes a main product item (model, color, capacity) in the order.
   * Allowed stages:
   * - STAFF (or ADMIN): STOCK_REQUESTED, SEARCHING, FOUND
   * - CASHIER (or ADMIN): CASHIER_RECEIVED, CASHIER_SCAN (before bill is opened)
   * The old item is replaced with the new SKU. If the session had already reached FOUND or later,
   * previously deducted shelf stock is returned. If the session is in STOCK_REQUESTED, it stays in
   * STOCK_REQUESTED (D82); otherwise it transitions back to SEARCHING for Stock to pick the new item.
   */
  async changeItem(user: PublicAccount, id: string, dto: ChangeSessionItemDto) {
    const session = await this.getById(user, id);

    if (session.outcome || session.state === 'COMPLETED' || session.state === 'BILL_OPENED') {
      throw new BadRequestException('คิวนี้เสร็จสิ้นหรือเปิดบิลแล้ว ไม่สามารถเปลี่ยนสินค้าได้');
    }

    const isAdmin = user.roles.includes('ADMIN');
    const isCashier = user.roles.includes('CASHIER');
    const isStaff = user.roles.includes('STAFF');

    const cashierStates: WorkflowState[] = ['CASHIER_RECEIVED', 'CASHIER_SCAN'];
    const staffStates: WorkflowState[] = ['STOCK_REQUESTED', 'SEARCHING', 'FOUND'];

    let actorRole: 'STAFF' | 'CASHIER';
    if ((isCashier || isAdmin) && cashierStates.includes(session.state)) {
      actorRole = 'CASHIER';
    } else if ((isStaff || isAdmin) && staffStates.includes(session.state)) {
      actorRole = 'STAFF';
    } else {
      if (!isCashier && !isStaff && !isAdmin) {
        throw new ForbiddenException('เฉพาะ Staff หรือ Cashier เท่านั้นที่มีสิทธิ์เปลี่ยนสินค้า');
      }
      throw new BadRequestException(
        `ไม่สามารถเปลี่ยนสินค้าในสถานะ ${session.state} ได้ (Staff: รอค้นหา/พบแล้ว, Cashier: ตรวจรับ/สแกน)`,
      );
    }

    if (!dto.reason?.trim()) {
      throw new BadRequestException('กรุณาระบุเหตุผลในการเปลี่ยนสินค้า');
    }

    // Find the old item in the session
    const oldItem = session.items.find(
      (it) => it.id === dto.oldItemId || it.skuId === dto.oldItemId,
    );
    if (!oldItem) {
      throw new BadRequestException('ไม่พบรายการสินค้าที่ต้องการเปลี่ยนในคิวนี้');
    }

    // Find the new SKU
    const newSku = await this.prisma.productSku.findFirst({
      where: {
        OR: [{ id: dto.newSkuId }, { sku: dto.newSkuId }],
        active: true,
      },
      include: {
        model: {
          include: {
            product: true,
          },
        },
      },
    });
    if (!newSku) {
      throw new BadRequestException('ไม่พบสินค้าใหม่ที่เลือก หรือสินค้านี้ปิดการขายแล้ว');
    }

    if (newSku.id === oldItem.skuId) {
      throw new BadRequestException('สินค้าใหม่เป็นรายการเดิม กรุณาเลือกรุ่น สี หรือความจุอื่น');
    }

    const now = new Date();
    const oldProductName = `${oldItem.sku.model.product.name} ${oldItem.sku.model.name} ${[oldItem.sku.storage, oldItem.sku.color].filter(Boolean).join(' ')}`.trim();
    const newProductName = `${newSku.model.product.name} ${newSku.model.name} ${[newSku.storage, newSku.color].filter(Boolean).join(' ')}`.trim();
    const nextState: WorkflowState =
      session.state === 'STOCK_REQUESTED' ? 'STOCK_REQUESTED' : 'SEARCHING';

    return this.prisma.$transaction(async (tx) => {
      // If the old item had been picked (FOUND or cashier states), return shelf stock
      if (['FOUND', 'SENT_TO_CASHIER', 'CASHIER_RECEIVED', 'CASHIER_SCAN'].includes(session.state)) {
        await this.returnItemsToShelf(tx, session.branchId, session.items);
      }

      // Update the session item to the new SKU
      await tx.sessionItem.update({
        where: { id: oldItem.id },
        data: {
          skuId: newSku.id,
          deducted: 0,
        },
      });

      // Keep STOCK_REQUESTED if not started searching yet (D82); otherwise reset to SEARCHING for Stock to pick the new item
      return tx.customerSession.update({
        where: { id: session.id },
        data: {
          state: nextState,
          stockFoundAt: null,
          cashierReceivedAt: null,
          cashierScanAt: null,
          events: {
            create: {
              eventType: 'ITEM_CHANGED',
              actorStaffId: user.staffId,
              createdAt: now,
              metadata: {
                oldItemId: oldItem.id,
                oldSkuId: oldItem.skuId,
                oldSku: oldItem.sku.sku,
                oldName: oldProductName,
                newSkuId: newSku.id,
                newSku: newSku.sku,
                newName: newProductName,
                reason: dto.reason.trim(),
                note: dto.note?.trim() || null,
                changedByRole: actorRole,
                fromState: session.state,
              },
            },
          },
        },
        include: sessionInclude,
      });
    });
  }

  /**
   * F12: stock (or a manager of the branch, or an admin) confirms it has seen a cancel and, when the goods had been
   * picked, brought them back. Stored on the session so every device sees it; only once.
   */
  async acknowledgeStockCancel(user: PublicAccount, id: string) {
    const session = await this.getById(user, id);
    const isManagerOfBranch = user.roles.includes('MANAGER') && user.branchId === session.branchId;
    if (!user.roles.includes('ADMIN') && !user.roles.includes('STOCK') && !isManagerOfBranch) {
      throw new ForbiddenException('Only stock, a branch manager or an admin can acknowledge a cancelled order');
    }
    if (
      session.outcome !== 'CUSTOMER_CANCELLED' ||
      session.productSelectionConfirmedAt === null ||
      session.stockAckAt !== null
    ) {
      throw new BadRequestException('Nothing to acknowledge on this session');
    }

    const now = new Date();
    return this.prisma.$transaction(async (tx) => {
      await this.claim(tx, session.id, Prisma.sql`outcome = 'CUSTOMER_CANCELLED' AND stockAckAt IS NULL`); // H-01
      return tx.customerSession.update({
        where: { id: session.id },
        data: {
          stockAckAt: now,
          stockAckBy: user.staffId,
          events: {
            create: {
              eventType: 'STOCK_ACKNOWLEDGED_CANCEL',
              actorStaffId: user.staffId,
              createdAt: now,
            },
          },
        },
        include: sessionInclude,
      });
    });
  }

  /**
   * F11: "buy again" after a cancel for a change reason (model, colour, capacity, wrong product picked). A NEW session,
   * pre-filled from the cancelled one (customer, items, accessories, Ontop, points, payments) that keeps its queue number
   * and type, starts at product selection (the customer already decided to buy) and links back with `rebuyOfId`. The
   * cancelled session stays cancelled (D20: no reopen); each can be bought again once.
   */
  async rebuy(user: PublicAccount, id: string) {
    this.checkRole(user, 'STAFF');
    const old = await this.getById(user, id);

    if (old.outcome !== 'CUSTOMER_CANCELLED' || !CHANGE_REASONS.includes(old.reason ?? '')) {
      throw new BadRequestException(
        'Only a session cancelled for a change (model, colour, capacity, wrong product) can be bought again',
      );
    }
    if (old.rebuiltAs) {
      throw new ConflictException('This session has already been bought again');
    }

    const now = new Date();
    // one millisecond later, so the two events and the milestone keep their order
    const started = new Date(now.getTime() + 1);
    try {
      return await this.prisma.$transaction(async (tx) => {
        const reference = await this.newReference(tx, bangkokDay(now));
        return tx.customerSession.create({
          data: {
            reference,
            branchId: old.branchId,
            staffId: user.staffId,
            customerId: old.customerId,
            phone: old.phone,
            customerTypeId: old.customerTypeId,
            queueLetter: old.queueLetter,
            queueNo: old.queueNo,
            state: 'PRODUCT_SELECTION',
            customerWalkInAt: now,
            decisionAt: now,
            productSelectionStartAt: started,
            rebuyOfId: old.id,
            items: {
              create: old.items.map((item, index) => ({
                skuId: item.skuId,
                quantity: item.quantity,
                createdAt: new Date(now.getTime() + index),
              })),
            },
            accessories: {
              create: old.accessories.map((a) => ({
                accessoryName: a.accessoryName,
                quantity: a.quantity,
              })),
            },
            ontop: { create: old.ontop.map((o) => ({ name: o.name })) },
            points: { create: old.points.map((p) => ({ name: p.name })) },
            burnPoints: { create: old.burnPoints.map((b) => ({ name: b.name })) },
            payments: { create: old.payments.map((p) => ({ method: p.method })) },
            events: {
              create: [
                {
                  eventType: 'SESSION_CREATED',
                  actorStaffId: user.staffId,
                  createdAt: now,
                  metadata: {
                    queue: formatQueue(old.queueLetter, old.queueNo ?? 0),
                    rebuyOf: old.reference,
                  },
                },
                {
                  eventType: 'PRODUCT_SELECTION_STARTED',
                  actorStaffId: user.staffId,
                  createdAt: started,
                },
              ],
            },
          },
          include: sessionInclude,
        });
      }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
    } catch (err) {
      // two staff pressing "buy again" on the same cancelled session at the same moment
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException('This session has already been bought again');
      }
      throw err;
    }
  }

  async reportStockMissing(user: PublicAccount, id: string, dto: ReportStockMissingDto) {
    this.checkRole(user, 'STOCK');
    const session = await this.getById(user, id);

    if (session.outcome || !['STOCK_REQUESTED', 'SEARCHING'].includes(session.state)) {
      throw new BadRequestException('Can only report missing stock during stock searching');
    }

    if (!dto.missingItems || dto.missingItems.length === 0) {
      throw new BadRequestException('At least one missing item is required');
    }

    // F3: the missing main products are named by id; a report without ids (an older client) names them like before
    let missingRows: SessionItemRow[];
    if (dto.missingItemIds === undefined) {
      missingRows = this.legacyMissingItems(session.items, dto.missingItems, dto.foundItems ?? []);
    } else {
      const own = new Set(session.items.map((item) => item.id));
      if (dto.missingItemIds.some((itemId) => !own.has(itemId))) {
        throw new BadRequestException('missingItemIds must be items of this session');
      }
      missingRows = session.items.filter((item) => dto.missingItemIds?.includes(item.id));
    }

    const now = new Date();
    const stockReviewData = {
      missingItems: dto.missingItems,
      foundItems: dto.foundItems || [],
      stockNote: dto.stockNote?.trim() || null,
      reportedAt: now.toISOString(),
      reportedBy: user.staffId,
      missingItemIds: missingRows.map((item) => item.id),
    };

    return this.prisma.$transaction(async (tx) => {
      await this.claim(tx, session.id, Prisma.sql`outcome IS NULL AND state IN ('STOCK_REQUESTED', 'SEARCHING')`); // H-01
      // D41: a missing main product sets that SKU's branch stock to 0 (and only that one)
      await this.zeroShelf(tx, session.branchId, missingRows, now);

      return tx.customerSession.update({
        where: { id: session.id },
        data: {
          stockReview: stockReviewData,
          events: {
            create: {
              eventType: 'STOCK_REPORTED_MISSING',
              actorStaffId: user.staffId,
              createdAt: now,
              metadata: stockReviewData,
            },
          },
        },
        include: sessionInclude,
      });
    });
  }

  async resolveStockReview(user: PublicAccount, id: string, dto: ResolveStockReviewDto) {
    const session = await this.getById(user, id);

    // Permission check: assigned staff, or manager of the branch, or admin
    const isAssignedStaff = session.staffId === user.staffId;
    const isManagerOfBranch = user.roles.includes('MANAGER') && user.branchId === session.branchId;
    const isAdmin = user.roles.includes('ADMIN');

    if (!isAssignedStaff && !isManagerOfBranch && !isAdmin) {
      throw new ForbiddenException('Only the assigned staff, branch manager, or admin can resolve customer review');
    }

    if (session.outcome) {
      throw new BadRequestException('Session is already finished');
    }

    if (!session.stockReview) {
      throw new BadRequestException('No pending stock review found on this session');
    }

    const now = new Date();
    const review = session.stockReview as {
      missingItems?: string[];
      foundItems?: string[];
      missingItemIds?: string[];
    };
    const missingItems = Array.isArray(review?.missingItems) ? review.missingItems : [];
    // F3: the review points at the missing items by id; a review made before F3 names the main product instead
    const missingRows = Array.isArray(review?.missingItemIds)
      ? session.items.filter((item) => review.missingItemIds?.includes(item.id))
      : this.legacyMissingItems(session.items, missingItems, review?.foundItems ?? []);
    const missingAccessory = (name: string) => name.replace(/\s*\(x\d+\)$/, '').trim();

    return this.prisma.$transaction(async (tx) => {
      await this.claim(tx, session.id, Prisma.sql`outcome IS NULL AND state IN ('STOCK_REQUESTED', 'SEARCHING')`); // H-01
      if (dto.action === 'ACCEPT_PARTIAL') {
        // Remove missing accessories and main products, then take what is left off the shelf
        for (const missing of missingItems) {
          await tx.sessionAccessory.deleteMany({
            where: { sessionId: session.id, accessoryName: missingAccessory(missing) },
          });
        }
        await tx.sessionItem.deleteMany({
          where: { id: { in: missingRows.map((item) => item.id) } },
        });
        const deducted = await this.takeItemsFromShelf(
          tx,
          session.branchId,
          session.items.filter((item) => !missingRows.includes(item)),
        );

        return tx.customerSession.update({
          where: { id: session.id },
          data: {
            state: 'FOUND',
            stockFoundAt: now,
            stockReview: null as unknown as undefined,
            events: {
              create: [
                {
                  eventType: 'STAFF_RESOLVED_STOCK_REVIEW',
                  actorStaffId: user.staffId,
                  createdAt: now,
                  metadata: { action: 'ACCEPT_PARTIAL', missingItems },
                },
                {
                  eventType: 'STOCK_FOUND',
                  actorStaffId: user.staffId,
                  createdAt: now,
                  metadata: { source: 'CUSTOMER_ACCEPT_PARTIAL', deducted },
                },
              ],
            },
          },
          include: sessionInclude,
        });
      }

      if (dto.action === 'CHANGE_ITEMS') {
        // Remove missing accessories and main products and reopen the selection
        for (const missing of missingItems) {
          await tx.sessionAccessory.deleteMany({
            where: { sessionId: session.id, accessoryName: missingAccessory(missing) },
          });
        }
        await tx.sessionItem.deleteMany({
          where: { id: { in: missingRows.map((item) => item.id) } },
        });

        return tx.customerSession.update({
          where: { id: session.id },
          data: {
            state: 'PRODUCT_SELECTION',
            confirmed: false,
            stockReview: null as unknown as undefined,
            events: {
              create: {
                eventType: 'STAFF_RESOLVED_STOCK_REVIEW',
                actorStaffId: user.staffId,
                createdAt: now,
                metadata: { action: 'CHANGE_ITEMS', missingItems },
              },
            },
          },
          include: sessionInclude,
        });
      }

      if (dto.action === 'CANCEL') {
        if (!dto.reason || (dto.reason === 'อื่น ๆ' && !dto.otherReason?.trim())) {
          throw new BadRequestException('Cancellation reason is required');
        }

        return tx.customerSession.update({
          where: { id: session.id },
          data: {
            outcome: 'CUSTOMER_CANCELLED',
            reason: dto.reason,
            otherReason: dto.otherReason?.trim() || null,
            cancelledBy: user.staffId,
            cancelledAt: now,
            stockReview: null as unknown as undefined,
            events: {
              create: [
                {
                  eventType: 'STAFF_RESOLVED_STOCK_REVIEW',
                  actorStaffId: user.staffId,
                  createdAt: now,
                  metadata: { action: 'CANCEL', reason: dto.reason },
                },
                {
                  eventType: 'CUSTOMER_CANCELLED',
                  actorStaffId: user.staffId,
                  createdAt: now,
                  metadata: { reason: dto.reason, otherReason: dto.otherReason },
                },
              ],
            },
          },
          include: sessionInclude,
        });
      }

      throw new BadRequestException('Invalid resolve action');
    });
  }

  async acknowledgeAlert(user: PublicAccount, id: string) {
    const session = await this.getById(user, id);

    const isManagerOfBranch = user.roles.includes('MANAGER') && user.branchId === session.branchId;
    const isAdmin = user.roles.includes('ADMIN');

    if (!isManagerOfBranch && !isAdmin) {
      throw new ForbiddenException('Only the branch manager or admin can acknowledge alerts');
    }

    const now = new Date();
    const currentReview = (session.stockReview as Record<string, unknown>) || {};
    const updatedReview = {
      ...currentReview,
      acknowledgedAt: now.toISOString(),
      acknowledgedBy: user.staffId,
    };

    return this.prisma.customerSession.update({
      where: { id: session.id },
      data: {
        stockReview: updatedReview,
      },
      include: sessionInclude,
    });
  }
}


