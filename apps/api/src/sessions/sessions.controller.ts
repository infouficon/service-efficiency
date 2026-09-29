import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { AccountsService } from '../accounts/accounts.service';
import type {
  AdvanceStepDto,
  CancelSessionDto,
  CreateSessionDto,
  NotBuyDto,
  OutOfStockDto,
  UpdateSelectionDto,
} from './dto';
import { SessionsService } from './sessions.service';

@Controller('sessions')
export class SessionsController {
  constructor(
    private readonly sessions: SessionsService,
    private readonly accounts: AccountsService,
  ) {}

  @Get()
  async list(
    @Req() req: Request,
    @Query('branchId') branchId?: string,
  ) {
    const user = await this.accounts.authenticate(req);
    return this.sessions.list(user, branchId);
  }

  @Get(':id')
  async getById(@Req() req: Request, @Param('id') id: string) {
    const user = await this.accounts.authenticate(req);
    return this.sessions.getById(user, id);
  }

  @Post()
  async createWalkIn(@Req() req: Request, @Body() dto: CreateSessionDto) {
    const user = await this.accounts.authenticate(req);
    return this.sessions.createWalkIn(user, dto);
  }

  @Post(':id/step')
  async advanceStep(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: AdvanceStepDto,
  ) {
    const user = await this.accounts.authenticate(req);
    return this.sessions.advanceStep(user, id, dto);
  }

  @Post(':id/decision/not-buy')
  async recordNotBuy(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: NotBuyDto,
  ) {
    const user = await this.accounts.authenticate(req);
    return this.sessions.recordNotBuy(user, id, dto);
  }

  @Put(':id/selection')
  async updateSelection(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: UpdateSelectionDto,
  ) {
    const user = await this.accounts.authenticate(req);
    return this.sessions.updateSelection(user, id, dto);
  }

  @Post(':id/confirm')
  async confirmPurchase(@Req() req: Request, @Param('id') id: string) {
    const user = await this.accounts.authenticate(req);
    return this.sessions.confirmPurchase(user, id);
  }

  @Post(':id/out-of-stock')
  async recordOutOfStock(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: OutOfStockDto,
  ) {
    const user = await this.accounts.authenticate(req);
    return this.sessions.recordOutOfStock(user, id, dto);
  }

  @Post(':id/cancel')
  async cancelSession(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: CancelSessionDto,
  ) {
    const user = await this.accounts.authenticate(req);
    return this.sessions.cancelSession(user, id, dto);
  }
}
