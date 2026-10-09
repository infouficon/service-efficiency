import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { PublicAccount } from '../accounts/accounts.service';
import { PrismaService } from '../prisma/prisma.service';
import type {
  AdvanceStepDto,
  CancelSessionDto,
  CreateSessionDto,
  NotBuyDto,
  OutOfStockDto,
  ReportStockMissingDto,
  ResolveStockReviewDto,
  StepAction,
  UpdateSelectionDto,
} from './dto';
import { EventType, WorkflowState } from '@prisma/client';

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

@Injectable()
export class SessionsService {
  constructor(private readonly prisma: PrismaService) {}

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
      include: {
        branch: true,
        staff: { select: { staffId: true, branchId: true } },
        product: true,
        model: true,
        sku: {
          include: {
            model: {
              include: {
                product: true,
              },
            },
          },
        },
        accessories: true,
        ontop: true,
        points: true,
        burnPoints: true,
        payments: true,
        events: {
          orderBy: { createdAt: 'asc' },
        },
      },
      orderBy: { customerWalkInAt: 'desc' },
    });
  }

  async getById(user: PublicAccount, idOrRef: string) {
    const session = await this.prisma.customerSession.findFirst({
      where: {
        OR: [{ id: idOrRef }, { reference: idOrRef }],
      },
      include: {
        branch: true,
        staff: { select: { staffId: true, branchId: true } },
        product: true,
        model: true,
        sku: {
          include: {
            model: {
              include: {
                product: true,
              },
            },
          },
        },
        accessories: true,
        ontop: true,
        points: true,
        burnPoints: true,
        payments: true,
        events: {
          orderBy: { createdAt: 'asc' },
        },
      },
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

    return this.prisma.$transaction(async (tx) => {
      // Generate sequential reference SES-YYYYMMDD-NNNNNN
      const now = new Date();
      const yyyy = now.getFullYear();
      const mm = String(now.getMonth() + 1).padStart(2, '0');
      const dd = String(now.getDate()).padStart(2, '0');
      const datePrefix = `SES-${yyyy}${mm}${dd}-`;

      const lastForDay = await tx.customerSession.findFirst({
        where: { reference: { startsWith: datePrefix } },
        orderBy: { reference: 'desc' },
      });

      let nextNum = 1;
      if (lastForDay) {
        const lastSeq = parseInt(lastForDay.reference.replace(datePrefix, ''), 10);
        if (!Number.isNaN(lastSeq)) {
          nextNum = lastSeq + 1;
        }
      }

      const reference = `${datePrefix}${String(nextNum).padStart(6, '0')}`;

      const session = await tx.customerSession.create({
        data: {
          reference,
          branchId: targetBranch.id,
          staffId: user.staffId,
          state: 'WALK_IN',
          customerWalkInAt: now,
          events: {
            create: {
              eventType: 'SESSION_CREATED',
              actorStaffId: user.staffId,
              createdAt: now,
            },
          },
        },
        include: {
          branch: true,
          staff: { select: { staffId: true, branchId: true } },
          product: true,
          model: true,
          sku: true,
          accessories: true,
          ontop: true,
          points: true,
          burnPoints: true,
          payments: true,
          events: true,
        },
      });

      return session;
    });
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

    const now = new Date();

    return this.prisma.$transaction(async (tx) => {
      if (dto.action === 'found' && session.skuId && session.branchId) {
        await tx.branchInventory.updateMany({
          where: { branchId: session.branchId, skuId: session.skuId },
          data: { stock: { decrement: 1 } },
        });
      }

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
            },
          },
        },
        include: {
          branch: true,
          staff: { select: { staffId: true, branchId: true } },
          product: true,
          model: true,
          sku: true,
          accessories: true,
          ontop: true,
          points: true,
          burnPoints: true,
          payments: true,
          events: {
            orderBy: { createdAt: 'asc' },
          },
        },
      });

      return updated;
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
        include: {
          branch: true,
          staff: { select: { staffId: true, branchId: true } },
          product: true,
          model: true,
          sku: true,
          accessories: true,
          ontop: true,
          points: true,
          burnPoints: true,
          payments: true,
          events: {
            orderBy: { createdAt: 'asc' },
          },
        },
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

      // Update payments
      if (dto.payments) {
        await tx.sessionPayment.deleteMany({ where: { sessionId: session.id } });
        for (const method of dto.payments) {
          await tx.sessionPayment.create({
            data: { sessionId: session.id, method },
          });
        }
      }

      // Safely resolve foreign keys for product/model/sku
      let resolvedProductId = session.productId;
      let resolvedModelId = session.modelId;
      let resolvedSkuId = session.skuId;

      if (dto.skuId) {
        const foundSku = await tx.productSku.findFirst({
          where: { OR: [{ id: dto.skuId }, { sku: dto.skuId }] },
          include: { model: true },
        });
        if (foundSku) {
          resolvedSkuId = foundSku.id;
          resolvedModelId = foundSku.modelId;
          resolvedProductId = foundSku.model.productId;
        }
      } else if (dto.skuId === null) {
        resolvedSkuId = null;
      }

      if (dto.modelId && !resolvedModelId) {
        const foundModel = await tx.productModel.findUnique({
          where: { id: dto.modelId },
        });
        if (foundModel) {
          resolvedModelId = foundModel.id;
          resolvedProductId = foundModel.productId;
        }
      } else if (dto.modelId === null && dto.skuId === null) {
        resolvedModelId = null;
      }

      if (dto.productId && !resolvedProductId) {
        const foundProduct = await tx.product.findUnique({
          where: { id: dto.productId },
        });
        if (foundProduct) {
          resolvedProductId = foundProduct.id;
        }
      } else if (dto.productId === null && dto.skuId === null && dto.modelId === null) {
        resolvedProductId = null;
      }

      return tx.customerSession.update({
        where: { id: session.id },
        data: {
          phone: dto.phone ?? session.phone,
          customerId,
          productId: resolvedProductId,
          modelId: resolvedModelId,
          skuId: resolvedSkuId,
        },
        include: {
          branch: true,
          staff: { select: { staffId: true, branchId: true } },
          product: true,
          model: true,
          sku: {
            include: {
              model: {
                include: {
                  product: true,
                },
              },
            },
          },
          accessories: true,
          ontop: true,
          points: true,
          burnPoints: true,
          payments: true,
          events: {
            orderBy: { createdAt: 'asc' },
          },
        },
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

    if (!session.skuId && !session.productId) {
      throw new BadRequestException('A main product selection is required before confirmation');
    }

    const now = new Date();

    return this.prisma.$transaction(async (tx) => {
      return tx.customerSession.update({
        where: { id: session.id },
        data: {
          confirmed: true,
          state: 'STOCK_REQUESTED',
          productSelectionConfirmedAt: now,
          events: {
            create: {
              eventType: 'PRODUCT_SELECTION_CONFIRMED',
              actorStaffId: user.staffId,
              createdAt: now,
            },
          },
        },
        include: {
          branch: true,
          staff: { select: { staffId: true, branchId: true } },
          product: true,
          model: true,
          sku: true,
          accessories: true,
          ontop: true,
          points: true,
          burnPoints: true,
          payments: true,
          events: {
            orderBy: { createdAt: 'asc' },
          },
        },
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
      if (dto.action === 'partial') {
        // Customer proceeds with remaining items: remove out of stock items and advance to FOUND
        const removeMainProduct =
          outOfStockItems.includes('MAIN_PRODUCT') ||
          (session.sku?.sku && outOfStockItems.includes(session.sku.sku)) ||
          (session.product?.name && outOfStockItems.includes(session.product.name));

        if (removeMainProduct && session.skuId && session.branchId) {
          await tx.branchInventory.updateMany({
            where: { branchId: session.branchId, skuId: session.skuId },
            data: { stock: 0 },
          });
        } else if (!removeMainProduct && session.skuId && session.branchId) {
          await tx.branchInventory.updateMany({
            where: { branchId: session.branchId, skuId: session.skuId },
            data: { stock: { decrement: 1 } },
          });
        }

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
            ...(removeMainProduct ? { productId: null, modelId: null, skuId: null } : {}),
            events: {
              create: {
                eventType: 'STOCK_FOUND',
                actorStaffId: user.staffId,
                createdAt: now,
                metadata: {
                  partialFulfillment: true,
                  outOfStockItems,
                  note: dto.note || dto.otherReason || null,
                },
              },
            },
          },
          include: {
            branch: true,
            staff: { select: { staffId: true, branchId: true } },
            product: true,
            model: true,
            sku: {
              include: {
                model: {
                  include: {
                    product: true,
                  },
                },
              },
            },
            accessories: true,
            ontop: true,
            points: true,
            burnPoints: true,
            payments: true,
            events: {
              orderBy: { createdAt: 'asc' },
            },
          },
        });
      }

      // Customer cancels entire session due to out of stock
      if (session.skuId && session.branchId) {
        await tx.branchInventory.updateMany({
          where: { branchId: session.branchId, skuId: session.skuId },
          data: { stock: 0 },
        });
      }

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
        include: {
          branch: true,
          staff: { select: { staffId: true, branchId: true } },
          product: true,
          model: true,
          sku: {
            include: {
              model: {
                include: {
                  product: true,
                },
              },
            },
          },
          accessories: true,
          ontop: true,
          points: true,
          burnPoints: true,
          payments: true,
          events: {
            orderBy: { createdAt: 'asc' },
          },
        },
      });
    });
  }

  async cancelSession(user: PublicAccount, id: string, dto: CancelSessionDto) {
    const session = await this.getById(user, id);

    if (session.outcome || session.state === 'COMPLETED') {
      throw new BadRequestException('Session is already ended');
    }

    // Role check by state
    if (['DEMO', 'PRODUCT_SELECTION'].includes(session.state)) {
      this.checkRole(user, 'STAFF');
    } else if (['STOCK_REQUESTED', 'SEARCHING', 'FOUND'].includes(session.state)) {
      this.checkRole(user, 'STOCK');
    } else if (['SENT_TO_CASHIER', 'CASHIER_RECEIVED', 'CASHIER_SCAN', 'BILL_OPENED'].includes(session.state)) {
      this.checkRole(user, 'CASHIER');
    }

    if (!dto.reason || (dto.reason === 'อื่น ๆ' && !dto.otherReason?.trim())) {
      throw new BadRequestException('Cancellation reason is required');
    }

    const now = new Date();

    return this.prisma.$transaction(async (tx) => {
      // Restore stock if session was already at FOUND or beyond
      if (
        session.skuId &&
        session.branchId &&
        (session.stockFoundAt ||
          ['FOUND', 'SENT_TO_CASHIER', 'CASHIER_RECEIVED', 'CASHIER_SCAN', 'BILL_OPENED'].includes(
            session.state,
          ))
      ) {
        await tx.branchInventory.updateMany({
          where: { branchId: session.branchId, skuId: session.skuId },
          data: { stock: { increment: 1 } },
        });
      }

      return tx.customerSession.update({
        where: { id: session.id },
        data: {
          outcome: 'CUSTOMER_CANCELLED',
          reason: dto.reason,
          otherReason: dto.otherReason?.trim() || null,
          cancelledBy: user.staffId,
          cancelledAt: now,
          events: {
            create: {
              eventType: 'CUSTOMER_CANCELLED',
              actorStaffId: user.staffId,
              createdAt: now,
              metadata: { reason: dto.reason, otherReason: dto.otherReason },
            },
          },
        },
        include: {
          branch: true,
          staff: { select: { staffId: true, branchId: true } },
          product: true,
          model: true,
          sku: true,
          accessories: true,
          ontop: true,
          points: true,
          burnPoints: true,
          payments: true,
          events: {
            orderBy: { createdAt: 'asc' },
          },
        },
      });
    });
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

    const now = new Date();
    const stockReviewData = {
      missingItems: dto.missingItems,
      foundItems: dto.foundItems || [],
      stockNote: dto.stockNote?.trim() || null,
      reportedAt: now.toISOString(),
      reportedBy: user.staffId,
    };

    return this.prisma.$transaction(async (tx) => {
      // Set branch stock to 0 for reported missing items/SKU
      if (session.skuId && session.branchId) {
        await tx.branchInventory.updateMany({
          where: { branchId: session.branchId, skuId: session.skuId },
          data: { stock: 0 },
        });
      }

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
        include: {
          branch: true,
          staff: { select: { staffId: true, branchId: true } },
          product: true,
          model: true,
          sku: {
            include: {
              model: {
                include: {
                  product: true,
                },
              },
            },
          },
          accessories: true,
          ontop: true,
          points: true,
          burnPoints: true,
          payments: true,
          events: {
            orderBy: { createdAt: 'asc' },
          },
        },
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
    const stockReviewObj = session.stockReview as { missingItems?: string[]; foundItems?: string[] };
    const missingItems = Array.isArray(stockReviewObj?.missingItems) ? stockReviewObj.missingItems : [];

    return this.prisma.$transaction(async (tx) => {
      if (dto.action === 'ACCEPT_PARTIAL') {
        // Remove missing accessories
        for (const missing of missingItems) {
          await tx.sessionAccessory.deleteMany({
            where: {
              sessionId: session.id,
              accessoryName: missing.replace(/\s*\(x\d+\)$/, '').trim(),
            },
          });
        }

        // Check if main product was among missing items
        const isMainProductMissing =
          session.product &&
          missingItems.some((item) =>
            item.includes(session.product?.name || '') ||
            (session.model && item.includes(session.model.name))
          );

        if (!isMainProductMissing && session.skuId && session.branchId) {
          await tx.branchInventory.updateMany({
            where: { branchId: session.branchId, skuId: session.skuId },
            data: { stock: { decrement: 1 } },
          });
        }

        return tx.customerSession.update({
          where: { id: session.id },
          data: {
            state: 'FOUND',
            stockFoundAt: now,
            stockReview: null as unknown as undefined,
            productId: isMainProductMissing ? null : session.productId,
            modelId: isMainProductMissing ? null : session.modelId,
            skuId: isMainProductMissing ? null : session.skuId,
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
                  metadata: { source: 'CUSTOMER_ACCEPT_PARTIAL' },
                },
              ],
            },
          },
          include: {
            branch: true,
            staff: { select: { staffId: true, branchId: true } },
            product: true,
            model: true,
            sku: {
              include: {
                model: {
                  include: {
                    product: true,
                  },
                },
              },
            },
            accessories: true,
            ontop: true,
            points: true,
            burnPoints: true,
            payments: true,
            events: {
              orderBy: { createdAt: 'asc' },
            },
          },
        });
      }

      if (dto.action === 'CHANGE_ITEMS') {
        // Remove missing accessories
        for (const missing of missingItems) {
          await tx.sessionAccessory.deleteMany({
            where: {
              sessionId: session.id,
              accessoryName: missing.replace(/\s*\(x\d+\)$/, '').trim(),
            },
          });
        }

        // Check if main product was among missing items
        const isMainProductMissing =
          session.product &&
          missingItems.some((item) =>
            item.includes(session.product?.name || '') ||
            (session.model && item.includes(session.model.name))
          );

        return tx.customerSession.update({
          where: { id: session.id },
          data: {
            state: 'PRODUCT_SELECTION',
            confirmed: false,
            stockReview: null as unknown as undefined,
            productId: isMainProductMissing ? null : session.productId,
            modelId: isMainProductMissing ? null : session.modelId,
            skuId: isMainProductMissing ? null : session.skuId,
            events: {
              create: {
                eventType: 'STAFF_RESOLVED_STOCK_REVIEW',
                actorStaffId: user.staffId,
                createdAt: now,
                metadata: { action: 'CHANGE_ITEMS', missingItems },
              },
            },
          },
          include: {
            branch: true,
            staff: { select: { staffId: true, branchId: true } },
            product: true,
            model: true,
            sku: {
              include: {
                model: {
                  include: {
                    product: true,
                  },
                },
              },
            },
            accessories: true,
            ontop: true,
            points: true,
            burnPoints: true,
            payments: true,
            events: {
              orderBy: { createdAt: 'asc' },
            },
          },
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
          include: {
            branch: true,
            staff: { select: { staffId: true, branchId: true } },
            product: true,
            model: true,
            sku: {
              include: {
                model: {
                  include: {
                    product: true,
                  },
                },
              },
            },
            accessories: true,
            ontop: true,
            points: true,
            burnPoints: true,
            payments: true,
            events: {
              orderBy: { createdAt: 'asc' },
            },
          },
        });
      }

      throw new BadRequestException('Invalid resolve action');
    });
  }
}

