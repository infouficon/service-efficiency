import {
  BadRequestException,
  Body,
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
import { WarroomSyncService } from './warroom-sync.service';

/** A flag must be exactly true/false: anything else must not silently turn a dry run into a real run. */
function flag(name: string, value: unknown): boolean {
  if (value === undefined || value === 'false') return false;
  if (value === 'true') return true;
  throw new BadRequestException(`${name} ต้องเป็น true หรือ false`);
}

/** ADMIN-only control of the products/stock sync from the warroom database (D52). */
@Controller('admin/warroom-sync')
@UseGuards(OriginGuard)
export class WarroomController {
  constructor(
    private readonly accounts: AccountsService,
    private readonly sync: WarroomSyncService,
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

  /** Starts a run and returns at once (poll `status`); `wait=true` holds the response until it finished. */
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
      flag('dryRun', dryRun),
      flag('force', force),
      flag('wait', wait),
    );
  }

  /** D72: counts (`dryRun=true`) or clears the old catalog and queue history; a real run needs `{ confirm }`. */
  @Post('reset-catalog')
  async resetCatalog(
    @Req() req: Request,
    @Query('dryRun') dryRun?: string,
    @Query('scope') scope?: string,
    @Body() body?: { confirm?: string },
  ) {
    const user = await this.admin(req);
    if (scope !== undefined && scope !== 'all' && scope !== 'non-erp')
      throw new BadRequestException('scope ต้องเป็น all หรือ non-erp');
    return this.sync.resetCatalog(
      user.staffId,
      flag('dryRun', dryRun),
      typeof body?.confirm === 'string' ? body.confirm : undefined,
      scope === 'non-erp' ? 'non-erp' : 'all',
    );
  }
}
