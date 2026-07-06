import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsInt,
  IsNumberString,
  IsOptional,
  IsString,
  Max,
  Min,
  MaxLength,
} from 'class-validator';

export class CreatePrimePlanDto {
  @ApiProperty()
  @IsString()
  @MaxLength(64)
  name!: string;

  @ApiProperty({ example: '99000' })
  @IsNumberString()
  monthlyPrice!: string;

  @ApiPropertyOptional({ example: '990000' })
  @IsOptional()
  @IsNumberString()
  yearlyPrice?: string;

  @ApiProperty({ example: '8.00' })
  @IsNumberString()
  commissionRate!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;
}

export class ExtendPrimeSubDto {
  @ApiProperty({ example: 30 })
  @IsInt()
  @Min(1)
  @Max(365)
  days!: number;
}

export class UpdatePrimePlanDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(64)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumberString()
  monthlyPrice?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumberString()
  yearlyPrice?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumberString()
  commissionRate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;
}
