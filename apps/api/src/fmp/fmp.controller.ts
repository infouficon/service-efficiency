import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { IsString, MaxLength, MinLength } from 'class-validator';
import type { Request } from 'express';
import { OriginGuard } from '../accounts/accounts.controller';
import { AccountsService } from '../accounts/accounts.service';
import { FmpService } from './fmp.service';

export class FmpResendDto {
  @IsString() @MinLength(1) @MaxLength(32) reference!: string;
}

/** ADMIN view of the orders SES sends to FileMaker (D88): status, the latest messages, retry and resend. */
@Controller('admin/fmp')
@UseGuards(OriginGuard)
export class FmpController {
  constructor(
    private readonly accounts: AccountsService,
    private readonly fmp: FmpService,
  ) {}

  private async admin(req: Request) {
    const user = await this.accounts.authenticate(req);
    if (!user.roles.includes('ADMIN')) throw new ForbiddenException('Access restricted to ADMIN');
    return user;
  }

  @Get()
  async status(@Req() req: Request) {
    await this.admin(req);
    return this.fmp.status();
  }

  /** A failed message goes again at once (and gets a fresh set of attempts). */
  @Post('outbox/:id/retry')
  async retry(@Req() req: Request, @Param('id') id: string) {
    await this.admin(req);
    const done = await this.fmp.retry(id);
    if (!done) throw new NotFoundException('ไม่พบรายการที่ส่งซ้ำได้');
    return done;
  }

  /** Sends an existing order again (event RESEND), queued like any other message. */
  @Post('resend')
  async resend(@Req() req: Request, @Body() dto: FmpResendDto) {
    await this.admin(req);
    const out = await this.fmp.resend(dto.reference.trim());
    if ('error' in out) {
      if (out.error === 'not-configured') throw new BadRequestException('ยังไม่ได้ตั้งค่าการส่งไป FileMaker (FMP_*)');
      throw new NotFoundException('ไม่พบออเดอร์นี้');
    }
    return out;
  }
}
