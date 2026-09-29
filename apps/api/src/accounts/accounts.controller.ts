import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
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
import {
  BranchDto,
  ChangePasswordDto,
  LoginDto,
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
class OriginGuard implements CanActivate {
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
    private readonly config: ConfigService,
  ) {}
  private cookie(response: Response, value: string, clear = false) {
    response.cookie(cookieName, value, {
      httpOnly: true,
      secure: this.config.get('NODE_ENV') === 'production',
      sameSite: 'lax',
      path: '/',
      ...(clear ? { maxAge: 0 } : {}),
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
}
