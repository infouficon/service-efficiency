import {
  Controller,
  ForbiddenException,
  Get,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { OriginGuard } from '../accounts/accounts.controller';
import { AccountsService } from '../accounts/accounts.service';
import { ErpSyncService } from './erp-sync.service';

/** ADMIN-only control of the daily ERP import (D53/D54). Same Origin/CSRF guard as the account routes. */
@Controller('admin/erp-sync')
@UseGuards(OriginGuard)
export class ErpController {
  constructor(
    private readonly accounts: AccountsService,
    private readonly sync: ErpSyncService,
  ) {}

  private async admin(req: Request) {
    const user = await this.accounts.authenticate(req);
    if (!user.roles.includes('ADMIN'))
      throw new ForbiddenException('Access restricted to ADMIN');
    return user;
  }

  @Get('status')
  async status(@Req() req: Request) {
    await this.admin(req);
    return this.sync.status();
  }

  /**
   * Starts a run and returns it at once (poll `status`). `dryRun=true` shows what would change and writes nothing;
   * `force=true` lifts the mass-deactivation guard; `wait=true` holds the response until the run has finished.
   */
  @Post('run')
  async run(
    @Req() req: Request,
    @Query('dryRun') dryRun?: string,
    @Query('force') force?: string,
    @Query('wait') wait?: string,
  ) {
    const user = await this.admin(req);
    return this.sync.runManual(
      user.staffId,
      dryRun === 'true',
      force === 'true',
      wait === 'true',
    );
  }
}
