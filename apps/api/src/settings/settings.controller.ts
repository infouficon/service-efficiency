import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { OriginGuard } from '../accounts/accounts.controller';
import { AccountsService } from '../accounts/accounts.service';
import { SettingsUpdateDto } from './dto';
import { SettingsService } from './settings.service';

/** Global switches (D59): everybody reads them (the staff screen needs "stock unlimited"), only ADMIN changes them. */
@Controller('settings')
@UseGuards(OriginGuard)
export class SettingsController {
  constructor(
    private readonly accounts: AccountsService,
    private readonly settings: SettingsService,
  ) {}

  /** Who changed a switch, and when, is for ADMIN only. */
  @Get()
  async read(@Req() req: Request) {
    const user = await this.accounts.authenticate(req);
    const { stockUnlimited, updatedAt, updatedBy } = await this.settings.read();
    return user.roles.includes('ADMIN')
      ? { stockUnlimited, updatedAt, updatedBy }
      : { stockUnlimited };
  }

  @Put()
  async update(@Req() req: Request, @Body() dto: SettingsUpdateDto) {
    const user = await this.accounts.authenticate(req);
    if (!user.roles.includes('ADMIN'))
      throw new ForbiddenException('Access restricted to ADMIN');
    return this.settings.setStockUnlimited(dto.stockUnlimited, user.staffId);
  }
}
