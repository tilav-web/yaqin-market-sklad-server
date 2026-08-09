import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';

import { RiskFlagStatus, RiskRule, RiskSeverity, RiskSubjectType } from '../entities/risk-flag.entity';

export class AdminListRiskFlagsQuery {
  @ApiPropertyOptional({ enum: RiskFlagStatus })
  @IsOptional()
  @IsEnum(RiskFlagStatus)
  status?: RiskFlagStatus;

  @ApiPropertyOptional({ enum: RiskSeverity })
  @IsOptional()
  @IsEnum(RiskSeverity)
  severity?: RiskSeverity;

  @ApiPropertyOptional({ enum: RiskRule })
  @IsOptional()
  @IsEnum(RiskRule)
  rule?: RiskRule;

  @ApiPropertyOptional({ enum: RiskSubjectType })
  @IsOptional()
  @IsEnum(RiskSubjectType)
  subjectType?: RiskSubjectType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(64)
  subjectId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  orderId?: string;

  @ApiPropertyOptional({ default: 30 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;
}

export class ReviewRiskFlagDto {
  @ApiPropertyOptional({ enum: ['confirmed', 'dismissed'] })
  @IsIn(['confirmed', 'dismissed'])
  status!: 'confirmed' | 'dismissed';

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
