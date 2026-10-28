import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
  Query,
  Req,
  Res,
  UseGuards,
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import { AccountsService } from './accounts.service';
import { OtpService } from './otp.service';
import { SESSION_MS } from './password';
import {
  BranchDto,
  BranchRegistrationDto,
  ChangePasswordDto,
  LoginDto,
  OtpRequestDto,
  OtpVerifyDto,
  SmsTestDto,
  ResetPasswordDto,
  StaffCreateDto,
  StaffUpdateDto,
} from './dto';
const cookieName = 'se_session';
function token(request: Request): string | undefined {
  return request.headers.cookie
    ?.split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${cookieName}=`))
    ?.slice(cookieName.length + 1);
}
@Injectable()
export class OriginGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}
  canActivate(context: ExecutionContext): boolean {
    context
      .switchToHttp()
      .getResponse<Response>()
      .setHeader('Cache-Control', 'no-store');
    const req = context.switchToHttp().getRequest<Request>();
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return true;
    const origin = req.headers.origin;
    if (
      !origin ||
      !this.config.getOrThrow<string[]>('CORS_ORIGINS').includes(origin) ||
      req.headers['x-requested-with'] !== 'ServiceEfficiency'
    )
      throw new ForbiddenException('Invalid request origin');
    return true;
  }
}
@Controller()
@UseGuards(OriginGuard)
export class AccountsController {
  constructor(
    private readonly accounts: AccountsService,
    private readonly otp: OtpService,
    private readonly config: ConfigService,
  ) {}
  private async admin(request: Request) {
    const user = await this.accounts.authenticate(request);
    if (!user.roles.includes('ADMIN')) throw new ForbiddenException('Access restricted to ADMIN');
    return user;
  }
  private cookie(response: Response, value: string, clear = false) {
    response.cookie(cookieName, value, {
      httpOnly: true,
      secure: this.config.get('NODE_ENV') === 'production',
      sameSite: 'lax',
      path: '/',
      // D85: the cookie lives as long as the session (12 h), so closing the browser does not log the shift out
      maxAge: clear ? 0 : SESSION_MS,
    });
    response.setHeader('Cache-Control', 'no-store');
  }
  @Post('auth/login')
  async login(
    @Body() body: LoginDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.accounts.login(body.staffId, body.password);
    this.cookie(response, result.token);
    return result.user;
  }
  /** Which sign-in the login page offers: SMS OTP once ThaiBulkSMS is configured (D85), else the password. Public. */
  @Get('auth/config')
  authConfig(@Res({ passthrough: true }) response: Response) {
    response.setHeader('Cache-Control', 'no-store');
    return { otp: this.accounts.otpEnabled() };
  }

  /** Sends a login code to the phone on the account. Always answers `{ ok: true }` (nothing tells whether the account exists). */
  @Post('auth/otp/request')
  requestOtp(@Body() body: OtpRequestDto) {
    return this.otp.request(body.staffId);
  }

  @Post('auth/otp/verify')
  async verifyOtp(
    @Body() body: OtpVerifyDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.otp.verify(body.staffId, body.code);
    this.cookie(response, result.token);
    return result.user;
  }

  /** ADMIN: how the SMS side is set up and the latest login codes with their delivery status. */
  @Get('admin/otp')
  async otpStatus(@Req() request: Request) {
    await this.admin(request);
    return this.otp.status();
  }

  /** ADMIN: one test SMS (costs a credit). */
  @Post('admin/otp/test-sms')
  async testSms(@Req() request: Request, @Body() body: SmsTestDto) {
    await this.admin(request);
    return this.otp.sendTest(body.phone);
  }

  @Get('auth/me')
  me(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    response.setHeader('Cache-Control', 'no-store');
    return this.accounts.me(token(request));
  }
  @Post('auth/logout')
  async logout(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.accounts.logout(token(request));
    this.cookie(response, '', true);
    return result;
  }
  @Post('auth/password')
  async password(
    @Req() request: Request,
    @Body() body: ChangePasswordDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.accounts.changePassword(
      token(request),
      body.currentPassword,
      body.newPassword,
    );
    this.cookie(response, '', true);
    return result;
  }
  @Get('staff') listStaff(@Req() request: Request) {
    return this.accounts.listStaff(token(request));
  }
  @Post('staff') createStaff(
    @Req() request: Request,
    @Body() body: StaffCreateDto,
  ) {
    return this.accounts.createStaff(token(request), body);
  }
  @Put('staff/:staffId') updateStaff(
    @Req() request: Request,
    @Param('staffId') staffId: string,
    @Body() body: StaffUpdateDto,
  ) {
    return this.accounts.updateStaff(token(request), staffId, body);
  }
  @Post('staff/:staffId/reset-password') reset(
    @Req() request: Request,
    @Param('staffId') staffId: string,
    @Body() body: ResetPasswordDto,
  ) {
    return this.accounts.resetPassword(token(request), staffId, body.password);
  }
  @Get('branches') branches(@Req() request: Request) {
    return this.accounts.listBranches(token(request));
  }
  @Post('branches') createBranch(
    @Req() request: Request,
    @Body() body: BranchDto,
  ) {
    return this.accounts.saveBranch(token(request), body);
  }
  @Put('branches/:id') updateBranch(
    @Req() request: Request,
    @Param('id') id: string,
    @Body() body: BranchDto,
  ) {
    return this.accounts.saveBranch(token(request), body, id);
  }
  /** F10: set or clear a branch's registration URL (ADMIN). Unlike `PUT /branches/:id` it also works for ERP-managed branches. */
  @Put('branches/:id/registration-url') setRegistrationUrl(
    @Req() request: Request,
    @Param('id') id: string,
    @Body() body: BranchRegistrationDto,
  ) {
    return this.accounts.setBranchRegistrationUrl(token(request), id, body.url);
  }
  @Get('admin/audit-logs')
  async getAuditLogs(
    @Req() request: Request,
    @Query('limit') limit?: string,
  ) {
    const user = await this.accounts.authenticate(request);
    if (!user.roles.includes('ADMIN')) {
      throw new ForbiddenException('Access restricted to ADMIN');
    }
    return this.accounts.getAuditLogs(limit ? parseInt(limit, 10) : 200);
  }
}
