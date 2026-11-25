import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  SurveyQuestion,
  SurveyResponse,
  SurveyTarget,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { PublicAccount } from '../accounts/accounts.service';
import {
  CreateSurveyQuestionDto,
  SubmitSurveyResponseDto,
  UpdateSurveyQuestionDto,
} from './dto';

@Injectable()
export class SurveysService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * List survey questions.
   * `all=false` returns only active questions for staff taking the survey.
   * `all=true` (Admin) returns all questions including disabled ones.
   */
  async listQuestions(
    target?: SurveyTarget,
    all = false,
  ): Promise<SurveyQuestion[]> {
    return this.prisma.surveyQuestion.findMany({
      where: {
        ...(target ? { target } : {}),
        ...(all ? {} : { active: true }),
      },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
  }

  async createQuestion(dto: CreateSurveyQuestionDto): Promise<SurveyQuestion> {
    const maxOrder = await this.prisma.surveyQuestion.aggregate({
      where: { target: dto.target },
      _max: { sortOrder: true },
    });
    const nextOrder = (maxOrder._max.sortOrder ?? 0) + 1;

    return this.prisma.surveyQuestion.create({
      data: {
        target: dto.target,
        title: dto.title.trim(),
        description: dto.description?.trim() || null,
        questionType: dto.questionType,
        options: dto.options
          ? (dto.options
              .map((o) => o.trim())
              .filter(Boolean) as unknown as Prisma.InputJsonValue)
          : Prisma.JsonNull,
        allowOther: dto.allowOther ?? false,
        required: dto.requiredNow ? true : (dto.required ?? true),
        requiredNow: dto.requiredNow ?? false,
        active: dto.active ?? true,
        sortOrder: dto.sortOrder ?? nextOrder,
      },
    });
  }

  async updateQuestion(
    id: string,
    dto: UpdateSurveyQuestionDto,
  ): Promise<SurveyQuestion> {
    const existing = await this.prisma.surveyQuestion.findUnique({
      where: { id },
    });
    if (!existing) {
      throw new NotFoundException(`Survey question with ID ${id} not found`);
    }

    return this.prisma.surveyQuestion.update({
      where: { id },
      data: {
        ...(dto.title !== undefined ? { title: dto.title.trim() } : {}),
        ...(dto.description !== undefined
          ? { description: dto.description?.trim() || null }
          : {}),
        ...(dto.questionType !== undefined
          ? { questionType: dto.questionType }
          : {}),
        ...(dto.options !== undefined
          ? {
              options: dto.options
                ? (dto.options
                    .map((o) => o.trim())
                    .filter(Boolean) as unknown as Prisma.InputJsonValue)
                : Prisma.JsonNull,
            }
          : {}),
        ...(dto.allowOther !== undefined ? { allowOther: dto.allowOther } : {}),
        ...(dto.required !== undefined ? { required: dto.required } : {}),
        ...(dto.requiredNow !== undefined
          ? {
              requiredNow: dto.requiredNow,
              ...(dto.requiredNow ? { required: true } : {}),
            }
          : {}),
        ...(dto.active !== undefined ? { active: dto.active } : {}),
        ...(dto.sortOrder !== undefined ? { sortOrder: dto.sortOrder } : {}),
      },
    });
  }

  async deleteQuestion(id: string): Promise<SurveyQuestion> {
    const existing = await this.prisma.surveyQuestion.findUnique({
      where: { id },
    });
    if (!existing) {
      throw new NotFoundException(`Survey question with ID ${id} not found`);
    }
    return this.prisma.surveyQuestion.delete({ where: { id } });
  }

  async moveQuestion(
    id: string,
    direction: 'UP' | 'DOWN',
  ): Promise<SurveyQuestion[]> {
    const current = await this.prisma.surveyQuestion.findUnique({
      where: { id },
    });
    if (!current) {
      throw new NotFoundException(`Survey question with ID ${id} not found`);
    }

    const siblings = await this.prisma.surveyQuestion.findMany({
      where: { target: current.target },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });

    const index = siblings.findIndex((q) => q.id === id);
    if (index === -1) return siblings;

    const targetIndex = direction === 'UP' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= siblings.length) return siblings;

    const other = siblings[targetIndex];
    if (!other) return siblings;

    await this.prisma.$transaction([
      this.prisma.surveyQuestion.update({
        where: { id: current.id },
        data: { sortOrder: other.sortOrder },
      }),
      this.prisma.surveyQuestion.update({
        where: { id: other.id },
        data: { sortOrder: current.sortOrder },
      }),
    ]);

    return this.listQuestions(current.target, true);
  }

  async reorderQuestions(
    target: SurveyTarget,
    orderedIds: string[],
  ): Promise<SurveyQuestion[]> {
    await this.prisma.$transaction(
      orderedIds.map((id, index) =>
        this.prisma.surveyQuestion.updateMany({
          where: { id, target },
          data: { sortOrder: index + 1 },
        }),
      ),
    );
    return this.listQuestions(target, true);
  }

  /**
   * Submit survey response for a customer session.
   */
  async submitResponse(user: PublicAccount, dto: SubmitSurveyResponseDto) {
    const session = await this.prisma.customerSession.findUnique({
      where: { id: dto.sessionId },
    });
    if (!session) {
      throw new NotFoundException(`Session ${dto.sessionId} not found`);
    }

    const now = new Date();

    return this.prisma.$transaction(async (tx) => {
      // D144: Check if an existing response already exists for this session & target (e.g. from a partial save)
      const existing = await tx.surveyResponse.findFirst({
        where: { sessionId: session.id, target: dto.target },
      });

      let response: SurveyResponse;
      if (existing) {
        response = await tx.surveyResponse.update({
          where: { id: existing.id },
          data: {
            actorStaffId: user.staffId,
            completed: dto.completed ?? true,
            answers: dto.answers as unknown as Prisma.InputJsonValue,
            ...(dto.unboughtProducts !== undefined
              ? {
                  unboughtProducts: dto.unboughtProducts as unknown as Prisma.InputJsonValue,
                }
              : {}),
            updatedAt: now,
          },
        });
      } else {
        response = await tx.surveyResponse.create({
          data: {
            sessionId: session.id,
            target: dto.target,
            actorStaffId: user.staffId,
            completed: dto.completed ?? true,
            answers: dto.answers as unknown as Prisma.InputJsonValue,
            ...(dto.unboughtProducts !== undefined
              ? {
                  unboughtProducts: dto.unboughtProducts as unknown as Prisma.InputJsonValue,
                }
              : {}),
            createdAt: now,
            updatedAt: now,
          },
        });
      }

      await tx.sessionEvent.create({
        data: {
          sessionId: session.id,
          eventType: 'SURVEY_SUBMITTED',
          actorStaffId: user.staffId,
          createdAt: now,
          metadata: {
            target: dto.target,
            surveyResponseId: response.id,
            completed: response.completed,
            answersCount: dto.answers.length,
            unboughtProducts: dto.unboughtProducts,
          },
        },
      });

      return response;
    });
  }

  async listResponses(query: {
    target?: SurveyTarget;
    sessionId?: string;
    limit?: number;
  }) {
    return this.prisma.surveyResponse.findMany({
      where: {
        ...(query.target ? { target: query.target } : {}),
        ...(query.sessionId ? { sessionId: query.sessionId } : {}),
      },
      include: {
        session: {
          select: {
            id: true,
            reference: true,
            phone: true,
            branch: { select: { code: true, name: true } },
            staff: {
              select: { staffId: true, firstName: true, lastName: true },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: query.limit ?? 200,
    });
  }

  /**
   * Export all survey responses as CSV formatted text.
   */
  async exportResponsesCsv(target?: SurveyTarget): Promise<string> {
    const responses = await this.prisma.surveyResponse.findMany({
      where: target ? { target } : undefined,
      include: {
        session: {
          select: {
            reference: true,
            phone: true,
            branch: { select: { name: true } },
            staff: { select: { firstName: true, lastName: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 2000,
    });

    const headers = [
      'ID',
      'Session Reference',
      'Branch',
      'Staff',
      'Target',
      'Unbought Products',
      'Question',
      'Type',
      'Answer',
      'Submitted At',
    ];

    const escapeCsv = (str: string) => `"${str.replaceAll('"', '""')}"`;

    const rows: string[] = [];
    rows.push(headers.join(','));

    for (const r of responses) {
      const answers = Array.isArray(r.answers)
        ? (r.answers as Array<{
            questionTitle?: string;
            questionType?: string;
            answer?: unknown;
          }>)
        : [];

      const unboughtText = Array.isArray(r.unboughtProducts)
        ? (r.unboughtProducts as string[]).join(', ')
        : '';

      for (const a of answers) {
        const answerText = Array.isArray(a.answer)
          ? a.answer.join(', ')
          : String(a.answer ?? '');

        rows.push(
          [
            escapeCsv(r.id),
            escapeCsv(r.session?.reference ?? ''),
            escapeCsv(r.session?.branch?.name ?? ''),
            escapeCsv(
              `${r.session?.staff?.firstName ?? ''} ${r.session?.staff?.lastName ?? ''}`.trim(),
            ),
            escapeCsv(r.target),
            escapeCsv(unboughtText),
            escapeCsv(a.questionTitle ?? ''),
            escapeCsv(a.questionType ?? ''),
            escapeCsv(answerText),
            escapeCsv(r.createdAt.toISOString()),
          ].join(','),
        );
      }
    }

    return rows.join('\r\n');
  }
}
