import {
  BadRequestException,
  Body,
  CanActivate,
  Controller,
  ExecutionContext,
  Get,
  Injectable,
  NotFoundException,
  Post,
  Query,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, timingSafeEqual } from 'node:crypto';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { SessionsService } from '../sessions/sessions.service';
import { PosBillDto } from './dto';

/**
 * The key U POS sends as `Authorization: Bearer <key>` (D60), set in the API's environment as `POS_API_KEY`. Without a key
 * (or with a short one) the integration does not exist: the routes answer 404. The key is compared in constant time.
 */
@Injectable()
export class PosKeyGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}
  canActivate(context: ExecutionContext): boolean {
    const http = context.switchToHttp();
    http.getResponse<Response>().setHeader('Cache-Control', 'no-store');
    const key = (this.config.get<string>('POS_API_KEY') ?? '').trim();
    if (key.length < 32) throw new NotFoundException();
    const header = http.getRequest<Request>().headers.authorization ?? '';
    const given = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    const digest = (value: string) =>
      createHash('sha256').update(value).digest();
    if (!timingSafeEqual(digest(given), digest(key)))
      throw new UnauthorizedException();
    return true;
  }
}

/**
 * Server-to-server door for U POS (`infouficon/UFPOS`, D60, F17): it reads the orders waiting for a bill at a branch so
 * the cashier does not retype them, and reports the bill it opened so SES records the real time. No cookie, no CSRF
 * guard: the bearer key is the only credential (see docs/agents/pos-integration.md).
 */
@ApiTags('integrations/pos')
@ApiBearerAuth('pos-key')
@ApiResponse({ status: 401, description: 'wrong or missing bearer key' })
@ApiResponse({ status: 404, description: 'POS_API_KEY is not set (or shorter than 32 characters) on the SES server: the integration is off' })
@Controller('integrations/pos')
@UseGuards(PosKeyGuard)
export class PosController {
  constructor(private readonly sessions: SessionsService) {}

  /** The orders of a branch (`branch` = branch code) that have reached the cashier and are not billed; `queue` narrows to one queue number. */
  @ApiOperation({
    summary: 'Orders waiting for a bill at a branch',
    description:
      'States SENT_TO_CASHIER, CASHIER_RECEIVED and CASHIER_SCAN that are not cancelled and have no bill yet, oldest first. No prices. `items[].partNo` is the Apple part number (the key warroom uses); accessories are free names without SKU. `customerPhone` is personal data.',
  })
  @ApiQuery({ name: 'branch', required: true, description: 'ERP branch_code of the branch', example: 'ISTUDIO-01' })
  @ApiQuery({ name: 'queue', required: false, description: 'Narrow to one queue number', example: 'A012' })
  @ApiOkResponse({
    description: 'the branch and its orders',
    schema: {
      example: {
        branch: { code: 'ISTUDIO-01', name: 'iStudio Central' },
        orders: [
          {
            reference: 'SES-20261013-000042',
            queue: 'A012',
            state: 'SENT_TO_CASHIER',
            customerPhone: '0812345678',
            staffId: '100234',
            confirmedAt: '2026-10-13T05:12:03.411Z',
            items: [{ partNo: 'MG8G4ZP/A', name: 'iPhone 16 Pro 256GB Desert Titanium', quantity: 2 }],
            accessories: [{ name: 'Case', quantity: 1 }],
            payments: ['Cash', 'Transfer'],
            ontop: ['AIS'],
            points: ['MCard'],
            burnPoints: [],
            posBillNo: null,
          },
        ],
      },
    },
  })
  @ApiResponse({ status: 400, description: 'branch is missing' })
  @ApiResponse({ status: 404, description: 'unknown branch (or the integration is off)' })
  @Get('orders')
  orders(@Query('branch') branch?: string, @Query('queue') queue?: string) {
    if (!branch?.trim()) throw new BadRequestException('branch is required');
    return this.sessions.posOrders(branch.trim(), queue?.trim());
  }

  /** U POS opened the bill of an order: records its number and real time, and moves the order on to BILL_OPENED. */
  @ApiOperation({
    summary: 'Report the bill U POS opened',
    description:
      'Idempotent: the same reference + billNo again returns 201 with the same body. An order at the cashier moves to BILL_OPENED with billOpenedAt = openedAt; if the cashier pressed first in SES, SES keeps its own time and stores the bill number and time beside it. Retry until a 2xx.',
  })
  @ApiCreatedResponse({
    schema: {
      example: {
        reference: 'SES-20261013-000042',
        state: 'BILL_OPENED',
        posBillNo: 'INV-2026-000123',
        posBillOpenedAt: '2026-10-13T05:20:11.000Z',
        billOpenedAt: '2026-10-13T05:20:11.000Z',
      },
    },
  })
  @ApiResponse({ status: 400, description: 'bad body, or openedAt out of range (more than 5 min ahead, before the walk-in, older than a year)' })
  @ApiResponse({ status: 404, description: 'unknown reference' })
  @ApiResponse({ status: 409, description: 'order cancelled/ended or not at the cashier yet, or another billNo was already reported' })
  @Post('bills')
  bill(@Body() dto: PosBillDto) {
    return this.sessions.recordPosBill(dto);
  }
}
