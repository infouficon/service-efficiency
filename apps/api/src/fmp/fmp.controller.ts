import {
  BadRequestException,
  Body,
  CanActivate,
  Controller,
  ExecutionContext,
  ForbiddenException,
  Get,
  HttpCode,
  Injectable,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { createHash, timingSafeEqual } from 'node:crypto';
import { ApiBearerAuth, ApiBody, ApiOkResponse, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';
import type { Request, Response } from 'express';
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

  /**
   * D90: the log of everything between SES and FileMaker, newest first, no bodies. `reference` (part of it) narrows to one
   * order, `direction` is OUT (SES calls FileMaker) / IN (FileMaker calls back) / SES (SES's own steps), `problems=true`
   * keeps only what went wrong, `after` is the `next` of the previous page.
   */
  @Get('logs')
  async logs(
    @Req() req: Request,
    @Query('reference') reference?: string,
    @Query('direction') direction?: string,
    @Query('problems') problems?: string,
    @Query('take') take?: string,
    @Query('after') after?: string,
  ) {
    await this.admin(req);
    if (direction && !['OUT', 'IN', 'SES'].includes(direction)) throw new BadRequestException('direction ต้องเป็น OUT, IN หรือ SES');
    return this.fmp.logs({
      reference: reference?.trim() || undefined,
      direction: direction || undefined,
      problems: problems === 'true',
      take: take ? Number(take) || undefined : undefined,
      after: after || undefined,
    });
  }

  /** D90: one log row with what was sent and what came back (phones and the session token masked). */
  @Get('logs/:id')
  async logDetail(@Req() req: Request, @Param('id') id: string) {
    await this.admin(req);
    const row = await this.fmp.logDetail(id);
    if (!row) throw new NotFoundException('ไม่พบรายการ log');
    return row;
  }

  /** A failed message goes again at once (and gets a fresh set of attempts). */
  @Post('outbox/:id/retry')
  async retry(@Req() req: Request, @Param('id') id: string) {
    const user = await this.admin(req);
    const done = await this.fmp.retry(id, `ADMIN ${user.staffId}`);
    if (!done) throw new NotFoundException('ไม่พบรายการที่ส่งซ้ำได้');
    return done;
  }

  /** Sends an existing order again (event RESEND), queued like any other message. */
  @Post('resend')
  async resend(@Req() req: Request, @Body() dto: FmpResendDto) {
    const user = await this.admin(req);
    const out = await this.fmp.resend(dto.reference.trim(), `ADMIN ${user.staffId}`);
    if ('error' in out) {
      if (out.error === 'not-configured') throw new BadRequestException('ยังไม่ได้ตั้งค่าการส่งไป FileMaker (FMP_*)');
      throw new NotFoundException('ไม่พบออเดอร์นี้');
    }
    return out;
  }
}

/**
 * The key FileMaker sends as `Authorization: Bearer <key>` (D90), set in the API's environment as `FMP_CALLBACK_KEY` (32
 * characters at least). Without a key the door does not exist: 404 with the reason. Compared in constant time.
 */
@Injectable()
export class FmpCallbackGuard implements CanActivate {
  constructor(private readonly fmp: FmpService) {}
  canActivate(context: ExecutionContext): boolean {
    const http = context.switchToHttp();
    http.getResponse<Response>().setHeader('Cache-Control', 'no-store');
    const key = this.fmp.callbackKey();
    if (!key) throw new NotFoundException('FileMaker callback is off: FMP_CALLBACK_KEY is not set (or is shorter than 32 characters) on the SES server');
    const header = http.getRequest<Request>().headers.authorization ?? '';
    const given = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    const digest = (value: string) => createHash('sha256').update(value).digest();
    if (!timingSafeEqual(digest(given), digest(key))) throw new UnauthorizedException();
    return true;
  }
}

/**
 * Server-to-server door for FileMaker (D90): it reports what it did with a message SES sent (done, failed, and when). No
 * cookie and no CSRF guard: the bearer key is the only credential. The body is read loosely, see `FmpService.receiveCallback`.
 */
@ApiTags('integrations/fmp')
@ApiBearerAuth('fmp-key')
@ApiResponse({ status: 401, description: 'wrong or missing bearer key' })
@ApiResponse({ status: 404, description: 'FMP_CALLBACK_KEY is not set on the SES server (door off), or the outboxId / reference is unknown' })
@Controller('integrations/fmp')
@UseGuards(FmpCallbackGuard)
export class FmpCallbackController {
  constructor(private readonly fmp: FmpService) {}

  @ApiOperation({
    summary: 'FileMaker reports what it did with a message',
    description:
      'Send `outboxId` (the one in the record SES created; unique per message) or `reference`. `status`: "success" or "error" (anything else is kept as "reported"). Optional `message` and `time` (ISO 8601, e.g. 2026-10-30T17:31:31+07:00; without an offset it is read as Bangkok time). Other fields are kept in the log, personal data masked. The report only records: it does not change the order. May arrive before SES has marked the message sent. Repeating a report is fine: the latest one is shown, every one is logged.',
  })
  @ApiBody({
    schema: {
      example: { outboxId: '7c9e6679-7425-40de-944b-e07fc1f90ae7', status: 'success', message: 'บันทึกบิลแล้ว', time: '2026-10-30T17:31:31+07:00' },
    },
  })
  @ApiOkResponse({
    schema: { example: { ok: true, outboxId: '7c9e6679-7425-40de-944b-e07fc1f90ae7', reference: 'SES-20261030-000042', status: 'success', time: '2026-10-30T10:31:31.000Z', timeReceived: true } },
  })
  @ApiResponse({ status: 400, description: 'neither outboxId nor reference, or they belong to different messages' })
  @Post('callback')
  @HttpCode(200)
  callback(@Body() body: Record<string, unknown> | undefined) {
    return this.fmp.receiveCallback(body && typeof body === 'object' && !Array.isArray(body) ? body : {});
  }
}
