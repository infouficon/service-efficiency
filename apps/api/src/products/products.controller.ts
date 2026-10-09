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
} from '@nestjs/common';
import type { Request } from 'express';
import { AccountsService } from '../accounts/accounts.service';
import {
  BranchActiveToggleDto,
  BranchStockUpdateDto,
  ModelCreateDto,
  ModelUpdateDto,
  ProductCreateDto,
  ProductUpdateDto,
  SkuCreateDto,
  SkuUpdateDto,
} from './dto';
import { ProductsService } from './products.service';

@Controller('products')
export class ProductsController {
  constructor(
    private readonly products: ProductsService,
    private readonly accounts: AccountsService,
  ) {}

  private assertAdmin(user: { roles: string[] }) {
    if (!user.roles.includes('ADMIN')) {
      throw new ForbiddenException('เฉพาะ ADMIN เท่านั้นที่มีสิทธิ์ดำเนินการนี้');
    }
  }

  private assertManagerOrAdmin(user: { roles: string[]; branchId?: string | null }, targetBranchId?: string) {
    if (user.roles.includes('ADMIN')) return;
    if (user.roles.includes('MANAGER')) {
      if (targetBranchId && user.branchId !== targetBranchId) {
        throw new ForbiddenException('จัดการได้เฉพาะ Branch ของตนเอง');
      }
      return;
    }
    throw new ForbiddenException('เฉพาะ ADMIN หรือ MANAGER เท่านั้นที่มีสิทธิ์ดำเนินการนี้');
  }

  @Get()
  async list(
    @Req() req: Request,
    @Query('admin') adminQuery?: string,
    @Query('branchId') branchIdQuery?: string,
  ) {
    const user = await this.accounts.authenticate(req);
    const isAdmin = user.roles.includes('ADMIN');
    const isManager = user.roles.includes('MANAGER');

    if (adminQuery === 'true' && (isAdmin || isManager)) {
      const targetBranch = isAdmin ? branchIdQuery : (user.branchId ?? undefined);
      return this.products.findAllAdmin(targetBranch);
    }

    if (isAdmin) {
      if (branchIdQuery) {
        return this.products.findByBranch(branchIdQuery);
      }
      return this.products.findAll();
    }

    if (user.branchId) {
      return this.products.findByBranch(user.branchId);
    }

    return this.products.findAll();
  }

  @Get('inventory')
  async listInventory(
    @Req() req: Request,
    @Query('branchId') branchIdQuery?: string,
  ) {
    const user = await this.accounts.authenticate(req);
    const isAdmin = user.roles.includes('ADMIN');
    const isManager = user.roles.includes('MANAGER');

    if (!isAdmin && !isManager) {
      throw new ForbiddenException('ไม่มีสิทธิ์เข้าถึงข้อมูลสต็อกสินค้า');
    }

    const targetBranch = isAdmin ? branchIdQuery : (user.branchId ?? undefined);
    return this.products.getBranchInventory(targetBranch);
  }

  @Put('branches/:branchId/skus/:skuId/stock')
  async updateBranchStock(
    @Req() req: Request,
    @Param('branchId') branchId: string,
    @Param('skuId') skuId: string,
    @Body() dto: BranchStockUpdateDto,
  ) {
    const user = await this.accounts.authenticate(req);
    this.assertAdmin(user);
    return this.products.updateBranchStock(branchId, skuId, dto.stock);
  }

  @Put('branches/:branchId/skus/:skuId/active')
  async toggleBranchActive(
    @Req() req: Request,
    @Param('branchId') branchId: string,
    @Param('skuId') skuId: string,
    @Body() dto: BranchActiveToggleDto,
  ) {
    const user = await this.accounts.authenticate(req);
    this.assertManagerOrAdmin(user, branchId);
    return this.products.toggleBranchActive(branchId, skuId, dto.active);
  }

  @Post()
  async createProduct(@Req() req: Request, @Body() dto: ProductCreateDto) {
    const user = await this.accounts.authenticate(req);
    this.assertAdmin(user);
    return this.products.createProduct(dto);
  }

  @Put(':id')
  async updateProduct(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: ProductUpdateDto,
  ) {
    const user = await this.accounts.authenticate(req);
    this.assertAdmin(user);
    return this.products.updateProduct(id, dto);
  }

  @Post(':id/models')
  async createModel(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: ModelCreateDto,
  ) {
    const user = await this.accounts.authenticate(req);
    this.assertAdmin(user);
    return this.products.createModel(id, dto);
  }

  @Put('models/:modelId')
  async updateModel(
    @Req() req: Request,
    @Param('modelId') modelId: string,
    @Body() dto: ModelUpdateDto,
  ) {
    const user = await this.accounts.authenticate(req);
    this.assertAdmin(user);
    return this.products.updateModel(modelId, dto);
  }

  @Post('models/:modelId/skus')
  async createSku(
    @Req() req: Request,
    @Param('modelId') modelId: string,
    @Body() dto: SkuCreateDto,
  ) {
    const user = await this.accounts.authenticate(req);
    this.assertAdmin(user);
    return this.products.createSku(modelId, dto);
  }

  @Put('skus/:skuId')
  async updateSku(
    @Req() req: Request,
    @Param('skuId') skuId: string,
    @Body() dto: SkuUpdateDto,
  ) {
    const user = await this.accounts.authenticate(req);
    this.assertAdmin(user);
    return this.products.updateSku(skuId, dto);
  }
}

