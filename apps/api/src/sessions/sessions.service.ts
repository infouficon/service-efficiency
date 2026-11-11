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
import { isValidPhone, normalizePhone } from '../common/phone.util';
import { loadPaymentTypes, orderView } from './order-view';
import { FmpService } from '../fmp/fmp.service';
import { SettingsService } from '../settings/settings.service';
import type {
  AdvanceStepDto,
  CancelSessionDto,
  CashierRejectDto,
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

/** The orders that left stock and wait for the till (U POS); the CASHIER_* states only hold orders from before D105. */
const AT_TILL: WorkflowState[] = ['SENT_TO_CASHIER', 'CASHIER_RECEIVED', 'CASHIER_SCAN', 'BILL_OPENED'];

const STEPS: Record<
  StepAction,
  {
    from: WorkflowState | WorkflowState[];
    to: WorkflowState;
    timestampField?: string;
    eventType: EventType;
    requiredRole: 'STAFF' | 'STOCK' | 'ADMIN';
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
  // D111: straight from SEARCHING once every unit is scanned (found + send in one step); FOUND still sends (an order the customer
  // accepted short, D73, or a screen open from before)
  send: {
    from: ['SEARCHING', 'FOUND'],
    to: 'SENT_TO_CASHIER',
    eventType: 'STOCK_SENT_TO_CASHIER',
    requiredRole: 'STOCK',
  },
  // D105: ADMIN closes a sale U POS did not report (U POS normally completes it with the payment time, D101)
  complete: {
    from: AT_TILL,
    to: 'COMPLETED',
    eventType: 'COMPLETED',
    requiredRole: 'ADMIN',
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

/** IMEI check digit (Luhn): every second digit from the right doubled, the sum a multiple of 10. */
function luhnOk(digits: string): boolean {
  let sum = 0;
  for (let i = 0; i < digits.length; i += 1) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

/**
 * D125: which number FileMaker keeps for a main product, from its category and names (the shops' rule, 2026-11-10):
 * `imei` (digits) for iPhone, iPad Cellular and Watch Cellular; `serial` (starts with a letter A-Z) for Mac, iPad Wi-Fi and
 * Watch GPS; null (no rule beyond D124) for everything else (AirPods, HomePod, accessories...). "Cellular" / "Cell" is read in
 * the product, model or SKU name (warroom writes "Wi-Fi + Cellular", "GPS + Cell").
 */
export type SerialKind = 'imei' | 'serial' | null;
export function serialKindOf(category: string | null | undefined, ...names: (string | null | undefined)[]): SerialKind {
  const c = (category ?? '').trim().toLowerCase();
  const cellular = names.some((n) => /cell/i.test(n ?? ''));
  if (c === 'iphone') return 'imei';
  if (c === 'ipad' || c === 'watch') return cellular ? 'imei' : 'serial';
  if (c === 'mac') return 'serial';
  return null;
}

/** D125: the serial kind of a session item (its SKU with model and product, as `sessionInclude` loads it). */
function kindOfItem(item: { sku: { name: string; model?: { name: string; product?: { category: string; name: string } | null } | null } }): SerialKind {
  return serialKindOf(item.sku.model?.product?.category, item.sku.model?.product?.name, item.sku.model?.name, item.sku.name);
}

/**
 * D124: what is wrong with a serial number STOCK typed or scanned, or null. Printable ASCII without spaces, 1 to 64 characters
 * (D92). A number made only of digits is an iPhone IMEI, which FileMaker keeps for iPhones: exactly 15 digits with a valid check
 * digit. 14 digits is the MEID on the same label (the IMEI without its check digit), 12 / 13 digits the UPC / EAN: FileMaker would
 * never find them and the cashier would have to scan the unit by hand (2026-11-10, SES-20261110-000002).
 */
export function serialProblem(sn: string, kind: SerialKind = null): string | null {
  if (!/^[\x21-\x7E]{1,64}$/.test(sn)) return 'ใช้ตัวอักษรหรือตัวเลขที่พิมพ์ได้ ไม่มีเว้นวรรค ยาวไม่เกิน 64 ตัว';
  // D125: the kind of number the product carries in FileMaker
  if (kind === 'imei' && !/^\d+$/.test(sn))
    return 'สินค้านี้ (iPhone / iPad Cellular / Watch Cellular) ใช้ IMEI ตัวเลข 15 หลัก ไม่ใช่ Serial No.: สแกนบาร์โค้ด IMEI บนกล่อง';
  if (kind === 'serial' && !/^[A-Z]/.test(sn))
    return 'สินค้านี้ (Mac / iPad Wi-Fi / Watch GPS) ใช้ Serial No. ขึ้นต้นด้วยตัวอักษร A-Z ไม่ใช่ IMEI: สแกนบาร์โค้ด Serial No. บนกล่อง';
  if (kind === 'serial' && !/^[A-Z][A-Z0-9]{7,19}$/.test(sn))
    return 'Serial No. ต้องเป็นตัวอักษรภาษาอังกฤษหรือตัวเลข 8-20 ตัว ขึ้นต้นด้วยตัวอักษร';
  if (!/^\d+$/.test(sn)) return null;
  if (sn.length === 14) return 'เลข 14 หลักคือ MEID ไม่ใช่ IMEI: สแกนบาร์โค้ด IMEI (15 หลัก) บนกล่อง';
  if (sn.length !== 15) return `ตัวเลข ${sn.length} หลักไม่ใช่ IMEI (IMEI มี 15 หลัก; 12/13 หลักคือบาร์โค้ดสินค้า)`;
  return luhnOk(sn) ? null : 'IMEI ไม่ถูกต้อง (เลขตรวจหลักสุดท้ายไม่ตรง) สแกนหรือพิมพ์ผิด ลองสแกนใหม่';
}
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

  private checkRole(user: PublicAccount, role: 'STAFF' | 'STOCK' | 'MANAGER' | 'ADMIN') {
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

      const normalizedPhone = normalizePhone(dto.phone) ?? dto.phone;

      // D56, D120: a walk-in starts at the phone number, so the Customer exists from the first moment.
      const customer = await tx.customer.upsert({
        where: { phone: normalizedPhone },
        create: { phone: normalizedPhone },
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
          phone: normalizedPhone,
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
                  phone: normalizedPhone,
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
    const rawWanted = queue?.trim();
    const wanted = rawWanted?.toUpperCase();
    const wantedPadded =
      rawWanted && /^\d+$/.test(rawWanted) ? rawWanted.padStart(3, '0') : undefined;
    const paymentTypes = await loadPaymentTypes(this.prisma);
    return {
      branch: { code: branch.code, name: branch.name },
      orders: sessions
        .map((s) => orderView(s, paymentTypes))
        .filter((order) => {
          if (!wanted) return true;
          return (
            order.queue === wanted ||
            (wantedPadded !== undefined && order.queue === wantedPadded) ||
            order.reference === wanted
          );
        }),
    };
  }

  /**
   * F17 (D60): U POS opened the bill of an order. The bill number and its real time are recorded; an order that is still at
   * the cashier moves on to BILL_OPENED (milestone = the real time, the cashier does not press anything in SES). When the
   * cashier pressed first, SES's own milestone stays and the U POS bill is added beside it. The same report again changes
   * nothing; another bill number for the same order is a conflict.
   */
  async recordPosBill(dto: { reference: string; billNo: string; openedAt: string; completedAt?: string }) {
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
    if (session.posBillNo !== null && session.posBillNo !== dto.billNo) throw new ConflictException('This order already has another bill');
    if (session.posBillNo !== null && !dto.completedAt) return summary(session);

    const openedAt = new Date(dto.openedAt);
    const now = Date.now();
    const plausible = (t: Date) => t.getTime() <= now + 5 * 60_000 && t.getTime() >= now - 366 * 86_400_000 && t >= session.customerWalkInAt;
    if (session.posBillNo === null && !plausible(openedAt)) {
      throw new BadRequestException('openedAt is not a plausible time for this order');
    }
    const completedAt = dto.completedAt ? new Date(dto.completedAt) : null;
    if (completedAt && (!plausible(completedAt) || completedAt < (session.posBillOpenedAt ?? openedAt)))
      throw new BadRequestException('completedAt is not a plausible time for this order (before the bill, or in the future)');
    const atCashier = ['SENT_TO_CASHIER', 'CASHIER_RECEIVED', 'CASHIER_SCAN'].includes(session.state);
    if (!atCashier && !['BILL_OPENED', 'COMPLETED'].includes(session.state)) {
      throw new ConflictException('The order has not reached the cashier');
    }

    return this.prisma.$transaction(async (tx) => {
      let current = session;
      // the event keeps its place in the history even if the bill was opened before SES saw the last step
      const lastEventAt = () => current.events.at(-1)?.createdAt ?? openedAt;
      if (session.posBillNo === null) {
        await this.claim(tx, session.id, Prisma.sql`posBillNo IS NULL AND outcome IS NULL`); // H-01: two reports at once
        const eventAt = openedAt > lastEventAt() ? openedAt : lastEventAt();
        current = await tx.customerSession.update({
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
                      metadata: { source: 'U-POS', billNo: dto.billNo, openedAt: openedAt.toISOString() },
                    },
                  },
                }
              : {}),
          },
          include: sessionInclude,
        });
      }
      // D101: the POS closed the sale: the order is completed with the POS's real time (the cashier presses nothing in SES)
      if (completedAt && current.state === 'BILL_OPENED') {
        await this.claim(tx, session.id, Prisma.sql`state = 'BILL_OPENED' AND outcome IS NULL`);
        const eventAt = completedAt > lastEventAt() ? completedAt : lastEventAt();
        current = await tx.customerSession.update({
          where: { id: session.id },
          data: {
            state: 'COMPLETED',
            events: {
              create: {
                eventType: 'COMPLETED',
                actorStaffId: 'U-POS',
                createdAt: eventAt,
                metadata: { source: 'U-POS', billNo: dto.billNo, completedAt: completedAt.toISOString() },
              },
            },
          },
          include: sessionInclude,
        });
      } else if (completedAt && current.state !== 'COMPLETED') {
        throw new ConflictException('The bill is not open in SES yet (the order is not at the cashier)');
      }
      return summary(current);
    });
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

    const from = Array.isArray(step.from) ? step.from : [step.from];
    if (!from.includes(session.state)) {
      throw new BadRequestException(
        `Cannot execute ${dto.action} from state ${session.state} (expected ${from.join(' / ')})`,
      );
    }

    if (dto.action === 'startSelection' && !session.decisionAt) {
      throw new BadRequestException('Must record BUY decision before starting selection');
    }

    // D92: the goods leave stock with their serial numbers; checked before anything is written. D101: without a list in the body,
    // the serials STOCK scanned one by one while searching are used (checked again inside the transaction)
    const useSaved = dto.action === 'send' && dto.serials === undefined;
    const serials = dto.action === 'send' && !useSaved ? this.checkSerials(session.items, dto.serials) : [];
    // D111: every unit leaves stock with its serial; "send with serials missing" (D103) is gone. An old screen still open may ask.
    if (dto.serialsLater)
      throw new BadRequestException('ต้องสแกน Serial Number ให้ครบทุกเครื่องก่อนส่ง (ไม่มี "ส่งโดย SN ยังไม่ครบ" แล้ว) กรุณารีเฟรชหน้าจอ');

    const now = new Date();

    return this.prisma.$transaction(async (tx) => {
      await this.claim(tx, session.id, Prisma.sql`state IN (${Prisma.join(from)}) AND outcome IS NULL`); // H-01
      if (dto.action === 'send' && !useSaved) await this.saveSerials(tx, session, serials);
      if (useSaved) await this.assertSerialsComplete(tx, session.items);
      // D111: sent straight from SEARCHING, the goods were found when the last unit was scanned: FOUND is recorded at that real
      // time (D101), with the shelf deduction, before the hand-over
      const foundOnSend = dto.action === 'send' && session.state === 'SEARCHING';
      const foundAt = foundOnSend ? await this.lastScanAt(tx, session.items, session.stockStartedAt, now) : null;
      const deducted =
        dto.action === 'found' || foundOnSend
          ? await this.takeItemsFromShelf(tx, session.branchId, session.items)
          : undefined;
      const metadata = deducted === undefined || foundOnSend ? {} : { deducted };
      const event = {
        eventType: step.eventType,
        actorStaffId: user.staffId,
        createdAt: now,
        ...(Object.keys(metadata).length ? { metadata } : {}),
      };

      const updated = await tx.customerSession.update({
        where: { id: session.id },
        data: {
          state: step.to,
          ...(step.timestampField ? { [step.timestampField]: now } : {}),
          ...(foundAt ? { stockFoundAt: foundAt } : {}),
          events: {
            create: foundAt
              ? [
                  { eventType: 'STOCK_FOUND', actorStaffId: user.staffId, createdAt: foundAt, metadata: { deducted: deducted ?? 0 } },
                  event,
                ]
              : event,
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
    items: { id: string; quantity: number; sku: { name: string; model?: { name: string; product?: { category: string; name: string } | null } | null } }[],
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
        const problem = serialProblem(one, kindOfItem(item)); // D124, D125
        if (problem) throw new BadRequestException(`Serial Number "${one}" ไม่ถูกต้อง (${problem})`);
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
    await this.assertSerialsFree(tx, session.id, serials.flatMap((s) => s.sn));
    await tx.sessionItemSerial.deleteMany({ where: { item: { sessionId: session.id } } });
    for (const { itemId, sn } of serials)
      await tx.sessionItemSerial.createMany({ data: sn.map((one, position) => ({ sessionItemId: itemId, sn: one, position })) });
  }

  /** D92: a serial that is in another order that is still open (not cancelled, not sold) cannot be used again. */
  private async assertSerialsFree(tx: Prisma.TransactionClient, sessionId: string, all: string[]) {
    const taken = await tx.sessionItemSerial.findFirst({
      where: {
        sn: { in: all },
        item: { session: { id: { not: sessionId }, outcome: null, state: { not: 'COMPLETED' } } },
      },
      include: { item: { select: { session: { select: { reference: true, queueLetter: true, queueNo: true } } } } },
    });
    if (taken) {
      const other = taken.item.session;
      const queue = other.queueNo === null ? other.reference : formatQueue(other.queueLetter, other.queueNo);
      throw new ConflictException(`Serial Number "${taken.sn}" อยู่ในออเดอร์ ${queue} ที่ยังไม่จบ`);
    }
  }

  /** D101: every main product has exactly `quantity` serial numbers saved (read inside the caller's transaction). */
  private async assertSerialsComplete(tx: Prisma.TransactionClient, items: { id: string; quantity: number; sku: { name: string } }[]) {
    for (const item of items) {
      const n = await tx.sessionItemSerial.count({ where: { sessionItemId: item.id } });
      if (n !== item.quantity)
        throw new BadRequestException(`${item.sku.name}: สแกน Serial Number แล้ว ${n} จาก ${item.quantity} เครื่อง ต้องสแกนให้ครบก่อนส่งไปแคชเชียร์`);
    }
  }

  /** D111: when the last unit of the order was scanned (never before STOCK took the job, never after now); now without serials. */
  private async lastScanAt(tx: Prisma.TransactionClient, items: { id: string }[], startedAt: Date | null, now: Date): Promise<Date> {
    const last = await tx.sessionItemSerial.aggregate({ where: { sessionItemId: { in: items.map((i) => i.id) } }, _max: { createdAt: true } });
    const at = last._max.createdAt ?? now;
    if (startedAt && at < startedAt) return startedAt;
    return at > now ? now : at;
  }

  /** D95/D101: a serial number as FileMaker keeps it: trimmed, in capitals, printable ASCII without spaces, 1–64 characters. */
  private normalizeSerial(raw: string, kind: SerialKind = null): string {
    const sn = raw.trim().toUpperCase();
    const problem = serialProblem(sn, kind); // D124, D125
    if (problem) throw new BadRequestException(`Serial Number "${raw.trim()}" ไม่ถูกต้อง (${problem})`);
    return sn;
  }

  /**
   * D101: STOCK scans the serial number of one unit while it is at the shelf. Saved at once with the server's time, so the moment
   * the last unit is scanned is the real moment the goods are in hand (the stock screen then records FOUND). Allowed while
   * SEARCHING and FOUND (a wrong scan can be removed and scanned again until the goods are sent).
   */
  async addSerial(user: PublicAccount, id: string, dto: { itemId: string; sn: string }) {
    this.checkRole(user, 'STOCK');
    const session = await this.getById(user, id);
    if (session.outcome || !['SEARCHING', 'FOUND'].includes(session.state))
      throw new BadRequestException('สแกน Serial Number ได้ระหว่างค้นหาสินค้าหรือหลังพบสินค้าเท่านั้น');
    const item = session.items.find((i) => i.id === dto.itemId);
    if (!item) throw new BadRequestException(`ไม่พบรายการสินค้า ${dto.itemId} ในออเดอร์นี้`);
    const sn = this.normalizeSerial(dto.sn, kindOfItem(item));
    return this.prisma.$transaction(async (tx) => {
      await this.claim(tx, session.id, Prisma.sql`outcome IS NULL AND state IN ('SEARCHING', 'FOUND')`);
      const existing = await tx.sessionItemSerial.findMany({ where: { item: { sessionId: session.id } } });
      if (existing.some((s) => s.sn.toLowerCase() === sn.toLowerCase()))
        throw new BadRequestException(`Serial Number "${sn}" สแกนไปแล้วในออเดอร์นี้`);
      const mine = existing.filter((s) => s.sessionItemId === item.id);
      if (mine.length >= item.quantity)
        throw new BadRequestException(`${item.sku.name}: สแกนครบ ${item.quantity} เครื่องแล้ว`);
      await this.assertSerialsFree(tx, session.id, [sn]);
      await tx.sessionItemSerial.create({
        data: { sessionItemId: item.id, sn, position: mine.reduce((max, s) => Math.max(max, s.position + 1), 0) },
      });
      return tx.customerSession.findUniqueOrThrow({ where: { id: session.id }, include: sessionInclude });
    });
  }

  /** D101: removes one scanned serial number (a wrong unit) before the goods are sent. */
  async removeSerial(user: PublicAccount, id: string, serialId: string) {
    this.checkRole(user, 'STOCK');
    const session = await this.getById(user, id);
    if (session.outcome || !['SEARCHING', 'FOUND'].includes(session.state))
      throw new BadRequestException('แก้ Serial Number ได้ก่อนส่งสินค้าไปแคชเชียร์เท่านั้น');
    return this.prisma.$transaction(async (tx) => {
      await this.claim(tx, session.id, Prisma.sql`outcome IS NULL AND state IN ('SEARCHING', 'FOUND')`);
      const { count } = await tx.sessionItemSerial.deleteMany({ where: { id: serialId, item: { sessionId: session.id } } });
      if (count !== 1) throw new NotFoundException('ไม่พบ Serial Number นี้ในออเดอร์');
      return tx.customerSession.findUniqueOrThrow({ where: { id: session.id }, include: sessionInclude });
    });
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

    let normalizedPhone: string | undefined;
    if (dto.phone) {
      const normalized = normalizePhone(dto.phone);
      if (!normalized) {
        throw new BadRequestException('Phone number must be a valid phone number (Thai or international)');
      }
      normalizedPhone = normalized;
    }

    return this.prisma.$transaction(async (tx) => {
      let customerId = session.customerId;
      if (normalizedPhone) {
        const customer = await tx.customer.upsert({
          where: { phone: normalizedPhone },
          create: { phone: normalizedPhone },
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
      if (dto.paymentDetails || dto.payments) {
        await tx.sessionPayment.deleteMany({ where: { sessionId: session.id } });
        if (dto.paymentDetails) {
          for (const item of dto.paymentDetails) {
            await tx.sessionPayment.create({
              data: {
                sessionId: session.id,
                method: item.method,
                cardType: item.cardType ?? null,
                installmentMonths: item.installmentMonths ?? null,
              },
            });
          }
        } else if (dto.payments) {
          for (const method of dto.payments) {
            await tx.sessionPayment.create({
              data: { sessionId: session.id, method },
            });
          }
        }
      }

      if (dto.paymentDetails || dto.payments || dto.ontop || dto.points || dto.burnPoints) {
        const types = await tx.customerType.findMany({
          where: { active: true },
          orderBy: { letter: 'asc' },
        });

        const allPayments =
          (dto.paymentDetails ? dto.paymentDetails.map((p) => p.method) : dto.payments) ??
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

      const nextReceiptType =
        dto.receiptType !== undefined ? dto.receiptType : session.receiptType;
      const nextTaxInvoice =
        nextReceiptType != null
          ? nextReceiptType === 'TAX_CORPORATE' || nextReceiptType === 'TAX_INDIVIDUAL'
          : (dto.taxInvoice ?? session.taxInvoice);

      return tx.customerSession.update({
        where: { id: session.id },
        data: {
          phone: normalizedPhone ?? session.phone,
          customerId,
          customerTypeId: nextCustomerTypeId,
          vatRefund: dto.vatRefund ?? session.vatRefund,
          taxInvoice: nextTaxInvoice,
          receiptType: nextReceiptType,
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

    if (!session.phone || !isValidPhone(session.phone)) {
      throw new BadRequestException('Valid customer phone number is required to confirm purchase');
    }

    if (session.items.length === 0) {
      throw new BadRequestException('A main product selection is required before confirmation');
    }

    if (!session.receiptType) {
      throw new BadRequestException('Receipt type selection is required before confirmation');
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

      const updated = await tx.customerSession.update({
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
      // D123: an order FileMaker already got: its held bill goes away and the order is refused from then on
      await this.fmp.release(tx, updated, 'CANCELLED');
      return updated;
    });
  }

  /**
   * F13/D105: the order goes back to stock (the wrong item was picked). Since D105 STAFF does it (the cashiers work in U POS and
   * tell the staff). Allowed from SENT_TO_CASHIER (and the CASHIER_* states of older orders), not once the bill is open. The
   * units FOUND took go back to the shelf, the session is at the stock stage again (SEARCHING) and its stock-found milestone
   * starts over; the first round stays in the events (CASHIER_REJECTED, then a second STOCK_FOUND...).
   */
  async cashierReject(user: PublicAccount, id: string, dto: CashierRejectDto) {
    this.checkRole(user, 'STAFF');
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
      const updated = await tx.customerSession.update({
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
      // D123: FileMaker takes the held bill away and frees the serials; STOCK's next send opens it again as revision 2
      await this.fmp.release(tx, updated, 'RETURNED_TO_STOCK');
      return updated;
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

    // D105: only STAFF (or ADMIN) changes a product, while the order is with stock; the cashier's change at the till is gone
    if (!user.roles.includes('STAFF') && !user.roles.includes('ADMIN'))
      throw new ForbiddenException('เฉพาะ Staff เท่านั้นที่มีสิทธิ์เปลี่ยนสินค้า');
    const staffStates: WorkflowState[] = ['STOCK_REQUESTED', 'SEARCHING', 'FOUND'];
    if (!staffStates.includes(session.state))
      throw new BadRequestException(`ไม่สามารถเปลี่ยนสินค้าในสถานะ ${session.state} ได้ (ได้เฉพาะตอนรอค้นหา / กำลังค้นหา / พบแล้ว)`);
    const actorRole = 'STAFF' as const;

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

      // D101: the serials scanned for the old product belong to units of another SKU; STOCK scans the new one again
      await tx.sessionItemSerial.deleteMany({ where: { sessionItemId: oldItem.id } });

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
            vatRefund: old.vatRefund,
            taxInvoice: old.taxInvoice,
            receiptType: old.receiptType,
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
            payments: {
              create: old.payments.map((p) => ({
                method: p.method,
                cardType: p.cardType,
                installmentMonths: p.installmentMonths,
              })),
            },
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
      reportedAt?: string;
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

        // D105: stock found what it found when it reported the rest missing, not when the customer decided (real times, D101)
        const reportedAt = review?.reportedAt ? new Date(review.reportedAt) : null;
        const foundAt = reportedAt && !Number.isNaN(reportedAt.getTime()) && reportedAt <= now ? reportedAt : now;
        return tx.customerSession.update({
          where: { id: session.id },
          data: {
            state: 'FOUND',
            stockFoundAt: foundAt,
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
                  metadata: { source: 'CUSTOMER_ACCEPT_PARTIAL', deducted, foundAt: foundAt.toISOString() },
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

        const cancelled = await tx.customerSession.update({
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
        // D123: an order sent back from the cashier earlier may still be known to FileMaker: it is refused from now on
        await this.fmp.release(tx, cancelled, 'CANCELLED');
        return cancelled;
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


