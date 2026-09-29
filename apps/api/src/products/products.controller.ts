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

  private assertManager(user: { roles: string[] }) {
    if (!user.roles.includes('ADMIN') && !user.roles.includes('MANAGER')) {
      throw new ForbiddenException('Only ADMIN and MANAGER can manage products');
    }
  }

  @Get()
  async list(@Req() req: Request, @Query('admin') adminQuery?: string) {
    const user = await this.accounts.authenticate(req);
    if (adminQuery === 'true' && (user.roles.includes('ADMIN') || user.roles.includes('MANAGER'))) {
      return this.products.findAllAdmin();
    }
    return this.products.findAll();
  }

  @Post()
  async createProduct(@Req() req: Request, @Body() dto: ProductCreateDto) {
    const user = await this.accounts.authenticate(req);
    this.assertManager(user);
    return this.products.createProduct(dto);
  }

  @Put(':id')
  async updateProduct(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: ProductUpdateDto,
  ) {
    const user = await this.accounts.authenticate(req);
    this.assertManager(user);
    return this.products.updateProduct(id, dto);
  }

  @Post(':id/models')
  async createModel(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: ModelCreateDto,
  ) {
    const user = await this.accounts.authenticate(req);
    this.assertManager(user);
    return this.products.createModel(id, dto);
  }

  @Put('models/:modelId')
  async updateModel(
    @Req() req: Request,
    @Param('modelId') modelId: string,
    @Body() dto: ModelUpdateDto,
  ) {
    const user = await this.accounts.authenticate(req);
    this.assertManager(user);
    return this.products.updateModel(modelId, dto);
  }

  @Post('models/:modelId/skus')
  async createSku(
    @Req() req: Request,
    @Param('modelId') modelId: string,
    @Body() dto: SkuCreateDto,
  ) {
    const user = await this.accounts.authenticate(req);
    this.assertManager(user);
    return this.products.createSku(modelId, dto);
  }

  @Put('skus/:skuId')
  async updateSku(
    @Req() req: Request,
    @Param('skuId') skuId: string,
    @Body() dto: SkuUpdateDto,
  ) {
    const user = await this.accounts.authenticate(req);
    this.assertManager(user);
    return this.products.updateSku(skuId, dto);
  }
}
