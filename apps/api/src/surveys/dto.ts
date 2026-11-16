import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { SurveyTarget, SurveyQuestionType } from '@prisma/client';

export class CreateSurveyQuestionDto {
  @IsEnum(SurveyTarget)
  target!: SurveyTarget;

  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  title!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsEnum(SurveyQuestionType)
  questionType!: SurveyQuestionType;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(20)
  options?: string[];

  @IsOptional()
  @IsBoolean()
  allowOther?: boolean;

  @IsOptional()
  @IsBoolean()
  required?: boolean;

  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @IsOptional()
  @IsInt()
  sortOrder?: number;
}

export class UpdateSurveyQuestionDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  title?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsEnum(SurveyQuestionType)
  questionType?: SurveyQuestionType;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(20)
  options?: string[];

  @IsOptional()
  @IsBoolean()
  allowOther?: boolean;

  @IsOptional()
  @IsBoolean()
  required?: boolean;

  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @IsOptional()
  @IsInt()
  sortOrder?: number;
}

export class MoveSurveyQuestionDto {
  @IsIn(['UP', 'DOWN'])
  direction!: 'UP' | 'DOWN';
}

export class ReorderSurveyQuestionsDto {
  @IsEnum(SurveyTarget)
  target!: SurveyTarget;

  @IsArray()
  @IsString({ each: true })
  orderedIds!: string[];
}

export class SurveyAnswerDto {
  @IsString()
  @IsNotEmpty()
  questionId!: string;

  @IsString()
  @IsNotEmpty()
  questionTitle!: string;

  @IsString()
  @IsNotEmpty()
  questionType!: string;

  // Single choice or text answer is string, multiple choice is string[]
  @IsNotEmpty()
  answer!: string | string[];
}

export class SubmitSurveyResponseDto {
  @IsString()
  @IsNotEmpty()
  sessionId!: string;

  @IsEnum(SurveyTarget)
  target!: SurveyTarget;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SurveyAnswerDto)
  answers!: SurveyAnswerDto[];
}
