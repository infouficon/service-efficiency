import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { OriginGuard } from '../accounts/accounts.controller';
import { AccountsService } from '../accounts/accounts.service';
import { ColorsService } from './colors.service';
import { BindSkuDto, MigrateSkusDto, UpsertColorDto } from './dto';

/** D143, D196: Product color palette and manual SKU-color binding management */
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

  @Get('search-skus')
  async searchSkus(@Req() req: Request, @Query('q') query = '') {
    await this.admin(req);
    return this.colors.searchSkus(query);
  }

  @Post()
  async upsert(@Req() req: Request, @Body() dto: UpsertColorDto) {
    await this.admin(req);
    return this.colors.upsert(dto.name, dto.hexCode);
  }

  @Post('bind-sku')
  async bindSku(@Req() req: Request, @Body() dto: BindSkuDto) {
    await this.admin(req);
    return this.colors.bindSku(dto.sku, dto.colorName ?? null);
  }

  @Post('migrate-skus')
  async migrateSkus(@Req() req: Request, @Body() dto: MigrateSkusDto) {
    await this.admin(req);
    return this.colors.migrateSkus(dto.fromColor, dto.toColor ?? null);
  }

  @Delete(':id')
  async delete(
    @Req() req: Request,
    @Param('id') id: string,
    @Query('migrateToColor') migrateToColor?: string,
  ) {
    await this.admin(req);
    return this.colors.delete(id, migrateToColor);
  }
}
