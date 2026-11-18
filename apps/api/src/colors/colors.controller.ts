import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { OriginGuard } from '../accounts/accounts.controller';
import { AccountsService } from '../accounts/accounts.service';
import { ColorsService } from './colors.service';
import { UpsertColorDto } from './dto';

/** D143: Product color palette management */
@Controller('colors')
@UseGuards(OriginGuard)
export class ColorsController {
  constructor(
    private readonly accounts: AccountsService,
    private readonly colors: ColorsService,
  ) {}

  private async admin(req: Request) {
    const user = await this.accounts.authenticate(req);
    if (!user.roles.includes('ADMIN')) {
      throw new ForbiddenException('Access restricted to ADMIN');
    }
    return user;
  }

  @Get()
  async list(@Req() req: Request) {
    await this.accounts.authenticate(req);
    return this.colors.list();
  }

  @Get('map')
  async map(@Req() req: Request) {
    await this.accounts.authenticate(req);
    return this.colors.getColorMap();
  }

  @Post()
  async upsert(@Req() req: Request, @Body() dto: UpsertColorDto) {
    await this.admin(req);
    return this.colors.upsert(dto.name, dto.hexCode);
  }

  @Delete(':id')
  async delete(@Req() req: Request, @Param('id') id: string) {
    await this.admin(req);
    return this.colors.delete(id);
  }
}
