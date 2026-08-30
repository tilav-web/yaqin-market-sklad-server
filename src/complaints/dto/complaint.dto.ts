import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

import { ComplaintStatus } from '../entities/order-complaint.entity';

export class CreateComplaintDto {
  @ApiProperty({ example: 'Mahsulot yetkazilmadi' })
  @IsString()
  @MaxLength(256)
  reason!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;
}

export class ResolveComplaintDto {
  @ApiProperty({ example: "Xaridorga to'liq qaytarish amalga oshirildi" })
  @IsString()
  @MaxLength(2000)
  resolution!: string;
}

export class AdminListComplaintsQuery {
  @ApiPropertyOptional({ enum: ComplaintStatus })
  @IsOptional()
  @IsEnum(ComplaintStatus)
  status?: ComplaintStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  shopId?: string;

  @ApiPropertyOptional({ default: 50 })
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
