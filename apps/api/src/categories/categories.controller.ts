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
import { CategoriesService } from './categories.service';
import { CategoryCreateDto, CategoryMoveDto, CategoryUpdateDto } from './dto';

/** Product categories (D72): every signed-in user reads the active ones, only ADMIN keeps the list. */
@Controller('categories')
@UseGuards(OriginGuard)
export class CategoriesController {
  constructor(
    private readonly accounts: AccountsService,
    private readonly categories: CategoriesService,
  ) {}

  private async admin(req: Request) {
    const user = await this.accounts.authenticate(req);
    if (!user.roles.includes('ADMIN'))
      throw new ForbiddenException('Access restricted to ADMIN');
    return user;
  }

  /** `?all=true` (ADMIN only) also returns the switched-off categories, with their product counts. */
  @Get()
  async list(@Req() req: Request, @Query('all') all?: string) {
    const user = await this.accounts.authenticate(req);
    return this.categories.list(all === 'true' && user.roles.includes('ADMIN'));
  }

  @Post()
  async create(@Req() req: Request, @Body() dto: CategoryCreateDto) {
    await this.admin(req);
    return this.categories.create(dto.name, dto.isAccessory);
  }

  @Put(':id')
  async update(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: CategoryUpdateDto,
  ) {
    await this.admin(req);
    return this.categories.update(id, dto);
  }

  @Post(':id/move')
  async move(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: CategoryMoveDto,
  ) {
    await this.admin(req);
    return this.categories.move(id, dto.direction);
  }
}
