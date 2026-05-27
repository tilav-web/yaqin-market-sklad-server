import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsLatitude,
  IsLongitude,
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

import type { DeliveryPricingType, Holiday, WorkingHourSlot } from '../entities/shop.entity';

export class WorkingHourSlotDto implements WorkingHourSlot {
  @ApiProperty({ minimum: 0, maximum: 6 })
  @IsInt()
  @Min(0)
  @Max(6)
  dayOfWeek!: 0 | 1 | 2 | 3 | 4 | 5 | 6;

  @ApiProperty({ example: '08:00' })
  @IsString()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/)
  openTime!: string;

  @ApiProperty({ example: '22:00' })
  @IsString()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/)
  closeTime!: string;

  @ApiProperty()
  @IsBoolean()
  isOpen!: boolean;
}

export class HolidayDto implements Holiday {
  @ApiProperty({ example: '2026-01-01' })
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  date!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  reason?: string;
}

export class DeliveryZoneDto {
  @ApiProperty({ example: 4 })
  @IsNumber()
  @Min(0.1)
  maxKm!: number;

  @ApiProperty({ example: 2 })
  @IsNumber()
  @Min(0)
  freeKm!: number;

  @ApiProperty({ enum: ['flat', 'per_km', 'per_500m'] })
  @IsEnum(['flat', 'per_km', 'per_500m'])
  pricingType!: DeliveryPricingType;

  @ApiProperty({ example: 5000 })
  @IsInt()
  @Min(0)
  pricePerStep!: number;
}

export class UpdateShopDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(128)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5)
  @IsUrl({}, { each: true })
  photos?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  address?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsLatitude()
  latitude?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsLongitude()
  longitude?: number;

  @ApiPropertyOptional({ type: [WorkingHourSlotDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => WorkingHourSlotDto)
  workingHours?: WorkingHourSlotDto[];

  @ApiPropertyOptional({ type: [HolidayDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => HolidayDto)
  holidays?: HolidayDto[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isOpenManual?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  minOrderPrice?: number;

  @ApiPropertyOptional({ type: DeliveryZoneDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => DeliveryZoneDto)
  deliveryZone?: DeliveryZoneDto;
}
