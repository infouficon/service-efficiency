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
import { SerialCheckService } from './serial-check.service';

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

  /**
   * D92: what warroom holds per serial number for one branch (`branch` = branch code) and one part number (`part`), at most
   * `take` (default 10, max 20) rows. A read-only look for the team to compare with FileMaker; nothing in SES uses it.
   * Example: `/api/admin/warroom-sync/serials?branch=IS-TM&part=MK2H4ZP/A`. `?list=branches` shows the branch codes warroom holds
   * and `?list=parts&branch=<code>` the part numbers of one branch (counts from both views), to see which code or part is spelled
   * differently.
   */
  @Get('serials')
  async serials(
    @Req() req: Request,
    @Query('branch') branch?: string,
    @Query('part') part?: string,
    @Query('take') take?: string,
    @Query('list') list?: string,
  ) {
    await this.admin(req);
    // `list=branches` / `list=parts&branch=<code>`: what codes and part numbers warroom really holds (counts only)
    if (list !== undefined) {
      if (list !== 'branches' && list !== 'parts') throw new BadRequestException('list ต้องเป็น branches หรือ parts');
      if (branch && branch.length > 64) throw new BadRequestException('branch ยาวเกินไป');
      return this.sync.listWarroom(list, branch?.trim() || undefined);
    }
    if (!branch?.trim() || !part?.trim()) throw new BadRequestException('ต้องระบุ branch (รหัสสาขา) และ part (part number)');
    if (branch.length > 64 || part.length > 64) throw new BadRequestException('branch หรือ part ยาวเกินไป');
    return this.sync.serialLookup(branch.trim(), part.trim(), take ? Number(take) : 10);
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

/**
 * D104: one scanned serial against the stock data (warroom by default, FileMaker live once it has an index on product_sn; see
 * SerialCheckService). `GET /api/stock/serial-check?sn=…[&part=…][&branch=<code>, ADMIN]`. Answers 200 with `status: off |
 * unavailable` when it cannot check; it never blocks a step.
 */
@Controller('stock')
export class StockSerialController {
  constructor(
    private readonly accounts: AccountsService,
    private readonly serials: SerialCheckService,
  ) {}

  @Get('serial-check')
  async serialCheck(@Req() req: Request, @Query('sn') sn?: string, @Query('part') part?: string, @Query('branch') branch?: string) {
    const user = await this.accounts.authenticate(req);
    if (!sn) throw new BadRequestException('ต้องระบุ sn');
    return this.serials.check(user, sn, part, branch);
  }
}

