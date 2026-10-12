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
@Controller('integrations/pos')
@UseGuards(PosKeyGuard)
export class PosController {
  constructor(private readonly sessions: SessionsService) {}

  /** The orders of a branch (`branch` = branch code) that have reached the cashier and are not billed; `queue` narrows to one queue number. */
  @Get('orders')
  orders(@Query('branch') branch?: string, @Query('queue') queue?: string) {
    if (!branch?.trim()) throw new BadRequestException('branch is required');
    return this.sessions.posOrders(branch.trim(), queue?.trim());
  }

  /** U POS opened the bill of an order: records its number and real time, and moves the order on to BILL_OPENED. */
  @Post('bills')
  bill(@Body() dto: PosBillDto) {
    return this.sessions.recordPosBill(dto);
  }
}
