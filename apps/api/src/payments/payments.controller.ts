import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { OriginGuard } from '../accounts/accounts.controller';
import { AccountsService } from '../accounts/accounts.service';
import {
  PaymentMethodCreateDto,
  PaymentMethodFmpTypeDto,
  PaymentMethodMoveDto,
  PaymentMethodReorderDto,
  PaymentMethodUpdateDto,
} from './dto';
import { PaymentsService } from './payments.service';

/** Payment methods (F6): every signed-in user reads the active ones, only ADMIN keeps the list. */
@Controller('payment-methods')
@UseGuards(OriginGuard)
export class PaymentsController {
  constructor(
    private readonly accounts: AccountsService,
    private readonly payments: PaymentsService,
  ) {}

  private async admin(req: Request) {
    const user = await this.accounts.authenticate(req);
    if (!user.roles.includes('ADMIN'))
      throw new ForbiddenException('Access restricted to ADMIN');
    return user;
  }

  /** `?all=true` (ADMIN only) also returns the switched-off methods. */
  @Get()
  async list(@Req() req: Request, @Query('all') all?: string) {
    const user = await this.accounts.authenticate(req);
    return this.payments.list(all === 'true' && user.roles.includes('ADMIN'));
  }

  @Post()
  async create(@Req() req: Request, @Body() dto: PaymentMethodCreateDto) {
    await this.admin(req);
    return this.payments.create(dto.name, dto.fmpType ?? null);
  }

  @Put('reorder')
  async reorder(@Req() req: Request, @Body() dto: PaymentMethodReorderDto) {
    await this.admin(req);
    return this.payments.reorder(dto.ids);
  }

  /** D89: files a method under an FMP payment type (`{ "fmpType": null }` clears it). */
  @Put(':id/fmp-type')
  async setFmpType(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: PaymentMethodFmpTypeDto,
  ) {
    await this.admin(req);
    return this.payments.setFmpType(id, dto.fmpType ?? null);
  }

  @Put(':id')
  async update(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: PaymentMethodUpdateDto,
  ) {
    await this.admin(req);
    return this.payments.setActive(id, dto.active);
  }

  @Post(':id/move')
  async move(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: PaymentMethodMoveDto,
  ) {
    await this.admin(req);
    return this.payments.move(id, dto.direction);
  }
}
