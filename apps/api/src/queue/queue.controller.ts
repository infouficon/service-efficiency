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
import { CustomerTypeCreateDto, CustomerTypeUpdateDto } from './dto';
import { QueueService } from './queue.service';

/** Customer types (D57): every signed-in user reads the active ones, only ADMIN manages them. */
@Controller('customer-types')
@UseGuards(OriginGuard)
export class QueueController {
  constructor(
    private readonly accounts: AccountsService,
    private readonly queue: QueueService,
  ) {}

  private async admin(req: Request) {
    const user = await this.accounts.authenticate(req);
    if (!user.roles.includes('ADMIN'))
      throw new ForbiddenException('Access restricted to ADMIN');
    return user;
  }

  /** `?all=true` (ADMIN only) also returns the inactive types. */
  @Get()
  async list(@Req() req: Request, @Query('all') all?: string) {
    const user = await this.accounts.authenticate(req);
    return this.queue.listTypes(all === 'true' && user.roles.includes('ADMIN'));
  }

  @Post()
  async create(@Req() req: Request, @Body() dto: CustomerTypeCreateDto) {
    await this.admin(req);
    return this.queue.createType(dto);
  }

  @Put(':id')
  async update(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: CustomerTypeUpdateDto,
  ) {
    await this.admin(req);
    return this.queue.updateType(id, dto);
  }
}
