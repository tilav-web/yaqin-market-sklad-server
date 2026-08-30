import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsOptional,
  IsUUID,
  ValidateNested,
} from 'class-validator';

import { AnalyticsEventType } from '../entities/analytics-event.entity';

export class AnalyticsEventItemDto {
  @ApiProperty({ enum: AnalyticsEventType })
  @IsEnum(AnalyticsEventType)
  type!: AnalyticsEventType;

  @ApiProperty()
  @IsUUID()
  shopId!: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsUUID()
  productVariantId?: string;
}

/** Batched so the mobile client can debounce taps rather than firing one HTTP call each. */
export class LogAnalyticsEventsDto {
  @ApiProperty({ type: [AnalyticsEventItemDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => AnalyticsEventItemDto)
  events!: AnalyticsEventItemDto[];
}
