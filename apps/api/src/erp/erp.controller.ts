import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { OriginGuard } from '../accounts/accounts.controller';
import { AccountsService } from '../accounts/accounts.service';
import { ErpExtraDto } from './dto';
import { ErpSyncService } from './erp-sync.service';
import { FmpUnitsService } from './fmp-units.service';

/** ADMIN-only control of the daily ERP import (D53/D54). Same Origin/CSRF guard as the account routes. */
/** A flag must be exactly true/false: anything else (1, TRUE, repeated) must not silently turn a dry run into a real run. */
function flag(name: string, value: unknown): boolean {
  if (value === undefined || value === 'false') return false;
  if (value === 'true') return true;
  throw new BadRequestException(`${name} ต้องเป็น true หรือ false`);
}

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
      flag('dryRun', dryRun),
      flag('force', force),
      flag('wait', wait),
    );
  }

  /** D87: people picked by hand for the import (outside its usual scope), with the account each has so far. */
  @Get('extras')
  async extras(@Req() req: Request) {
    await this.admin(req);
    return this.sync.listExtras();
  }

  @Put('extras')
  async addExtra(@Req() req: Request, @Body() dto: ErpExtraDto) {
    const user = await this.admin(req);
    return this.sync.addExtra(user.staffId, dto);
  }

  @Delete('extras/:erpStaffId')
  async removeExtra(@Req() req: Request, @Param('erpStaffId', ParseIntPipe) erpStaffId: number) {
    const user = await this.admin(req);
    return this.sync.removeExtra(user.staffId, erpStaffId);
  }

  /** D87: look people up in the ERP by name or staff_id (min 2 characters) to pick them. */
  @Get('staff-search')
  async search(@Req() req: Request, @Query('q') q?: string) {
    await this.admin(req);
    return this.sync.searchErpStaff(q ?? '');
  }
}

/**
 * D104: what FileMaker holds as `ready` for one model, live over the ERP's OData (see FmpUnitsService for the load guards).
 * `GET /api/stock/fmp-units?part=MK2L4ZP/A[&sn=<serial>][&branch=<code>, ADMIN]` → the units ready in the user's branch, counts
 * elsewhere, and a verdict on `sn`. Answers 200 with `status: off | unavailable` when it cannot check; it never blocks anything.
 */
@Controller('stock')
export class StockFmpController {
  constructor(
    private readonly accounts: AccountsService,
    private readonly units: FmpUnitsService,
  ) {}

  @Get('fmp-units')
  async fmpUnits(@Req() req: Request, @Query('part') part?: string, @Query('sn') sn?: string, @Query('branch') branch?: string) {
    const user = await this.accounts.authenticate(req);
    if (!part) throw new BadRequestException('ต้องระบุ part');
    return this.units.check(user, part, sn, branch);
  }
}

