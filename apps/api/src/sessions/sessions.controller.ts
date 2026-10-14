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
import {
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

  /** F13: the cashier sends the order back to stock (the wrong item was picked). */
  @Post(':id/cashier/reject')
  async cashierReject(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: CashierRejectDto,
  ) {
    const user = await this.accounts.authenticate(req);
    return this.sessions.cashierReject(user, id, dto);
  }

  /** D75: cashier removes damaged items and proceeds with the rest of the order. */
  @Post(':id/cashier/remove-damaged')
  async cashierRemoveDamaged(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: CashierRemoveDamagedDto,
  ) {
    const user = await this.accounts.authenticate(req);
    return this.sessions.cashierRemoveDamaged(user, id, dto);
  }

  /** F12: stock confirms it has seen a cancel (and brought the goods back). */
  @Post(':id/stock/acknowledge-cancel')
  async acknowledgeStockCancel(@Req() req: Request, @Param('id') id: string) {
    const user = await this.accounts.authenticate(req);
    return this.sessions.acknowledgeStockCancel(user, id);
  }

  /** F11: buy again after a "change" cancel: a new session with the old data and the old queue number. */
  @Post(':id/rebuy')
  async rebuy(@Req() req: Request, @Param('id') id: string) {
    const user = await this.accounts.authenticate(req);
    return this.sessions.rebuy(user, id);
  }

  @Post(':id/stock/report-missing')
  async reportStockMissing(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: ReportStockMissingDto,
  ) {
    const user = await this.accounts.authenticate(req);
    return this.sessions.reportStockMissing(user, id, dto);
  }

  @Post(':id/staff/resolve-stock-review')
  async resolveStockReview(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: ResolveStockReviewDto,
  ) {
    const user = await this.accounts.authenticate(req);
    return this.sessions.resolveStockReview(user, id, dto);
  }

  @Post(':id/manager/acknowledge-alert')
  async acknowledgeAlert(@Req() req: Request, @Param('id') id: string) {
    const user = await this.accounts.authenticate(req);
    return this.sessions.acknowledgeAlert(user, id);
  }

  @Post(':id/change-item')
  async changeItem(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: ChangeSessionItemDto,
  ) {
    const user = await this.accounts.authenticate(req);
    return this.sessions.changeItem(user, id, dto);
  }
}

