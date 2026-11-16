import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  Post,
  Put,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { SurveyTarget } from '@prisma/client';
import { OriginGuard } from '../accounts/accounts.controller';
import { AccountsService } from '../accounts/accounts.service';
import { SurveysService } from './surveys.service';
import {
  CreateSurveyQuestionDto,
  MoveSurveyQuestionDto,
  ReorderSurveyQuestionsDto,
  SubmitSurveyResponseDto,
  UpdateSurveyQuestionDto,
} from './dto';

@Controller('surveys')
@UseGuards(OriginGuard)
export class SurveysController {
  constructor(
    private readonly accounts: AccountsService,
    private readonly surveys: SurveysService,
  ) {}

  private async admin(req: Request) {
    const user = await this.accounts.authenticate(req);
    if (!user.roles.includes('ADMIN')) {
      throw new ForbiddenException('Access restricted to ADMIN');
    }
    return user;
  }

  private async managerOrAdmin(req: Request) {
    const user = await this.accounts.authenticate(req);
    if (!user.roles.includes('ADMIN') && !user.roles.includes('MANAGER')) {
      throw new ForbiddenException('Access restricted to ADMIN or MANAGER');
    }
    return user;
  }

  /**
   * List survey questions.
   * Authenticated staff read active questions (`all=false`).
   * ADMIN can pass `all=true` to manage both active and inactive questions.
   */
  @Get('questions')
  async listQuestions(
    @Req() req: Request,
    @Query('target') target?: SurveyTarget,
    @Query('all') all?: string,
  ) {
    const user = await this.accounts.authenticate(req);
    const showAll = all === 'true' && user.roles.includes('ADMIN');
    return this.surveys.listQuestions(target, showAll);
  }

  @Post('questions')
  async createQuestion(
    @Req() req: Request,
    @Body() dto: CreateSurveyQuestionDto,
  ) {
    await this.admin(req);
    return this.surveys.createQuestion(dto);
  }

  @Put('questions/:id')
  async updateQuestion(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: UpdateSurveyQuestionDto,
  ) {
    await this.admin(req);
    return this.surveys.updateQuestion(id, dto);
  }

  @Delete('questions/:id')
  async deleteQuestion(@Req() req: Request, @Param('id') id: string) {
    await this.admin(req);
    return this.surveys.deleteQuestion(id);
  }

  @Post('questions/reorder')
  async reorderQuestions(
    @Req() req: Request,
    @Body() dto: ReorderSurveyQuestionsDto,
  ) {
    await this.admin(req);
    return this.surveys.reorderQuestions(dto.target, dto.orderedIds);
  }

  @Post('questions/:id/move')
  async moveQuestion(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: MoveSurveyQuestionDto,
  ) {
    await this.admin(req);
    return this.surveys.moveQuestion(id, dto.direction);
  }

  /**
   * Submit survey response for a customer session.
   * Can be submitted by STAFF or ADMIN.
   */
  @Post('responses')
  async submitResponse(
    @Req() req: Request,
    @Body() dto: SubmitSurveyResponseDto,
  ) {
    const user = await this.accounts.authenticate(req);
    return this.surveys.submitResponse(user, dto);
  }

  /**
   * List responses. Accessible by ADMIN and MANAGER.
   */
  @Get('responses')
  async listResponses(
    @Req() req: Request,
    @Query('target') target?: SurveyTarget,
    @Query('sessionId') sessionId?: string,
    @Query('limit') limit?: string,
  ) {
    await this.managerOrAdmin(req);
    const parsedLimit = limit ? Number.parseInt(limit, 10) : undefined;
    return this.surveys.listResponses({
      target,
      sessionId,
      limit: Number.isNaN(parsedLimit) ? undefined : parsedLimit,
    });
  }

  /**
   * Export survey responses to CSV file. Accessible by ADMIN and MANAGER.
   */
  @Get('export')
  async exportCsv(
    @Req() req: Request,
    @Res() res: Response,
    @Query('target') target?: SurveyTarget,
  ) {
    await this.managerOrAdmin(req);
    const csv = await this.surveys.exportResponsesCsv(target);
    const filename = `surveys-${target || 'all'}-${new Date().toISOString().slice(0, 10)}.csv`;

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send('\uFEFF' + csv);
  }
}
