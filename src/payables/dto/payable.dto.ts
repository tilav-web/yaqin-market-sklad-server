import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';

import { PAYABLE_CATEGORIES } from '../entities/supplier-account.entity';
import type { PayableCategory } from '../entities/supplier-account.entity';

export class CreateAccountDto {
  @ApiProperty()
  @IsString()
  @MaxLength(128)
  name!: string;

  @ApiProperty({ enum: PAYABLE_CATEGORIES })
  @IsIn(PAYABLE_CATEGORIES)
  category!: PayableCategory;

  @ApiPropertyOptional({ example: '+998901234567' })
  @IsOptional()
  @IsString()
  @Matches(/^\+?\d{9,15}$/)
  phone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class UpdateAccountDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(128)
  name?: string;

  @ApiPropertyOptional({ enum: PAYABLE_CATEGORIES })
  @IsOptional()
  @IsIn(PAYABLE_CATEGORIES)
  category?: PayableCategory;

  @ApiPropertyOptional({ example: '+998901234567' })
  @IsOptional()
  @IsString()
  @Matches(/^\+?\d{9,15}$/)
  phone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isArchived?: boolean;
}

export class AddChargeDto {
  @ApiProperty()
  @IsUUID()
  accountId!: string;

  @ApiProperty({ example: 500000 })
  @IsInt()
  @Min(1)
  amount!: number;

  @ApiPropertyOptional({ example: 'Guruch 50kg' })
  @IsOptional()
  @IsString()
  @MaxLength(256)
  description?: string;

  @ApiPropertyOptional({ example: '2026-08-01' })
  @IsOptional()
  @IsDateString()
  dueDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class AddPaymentDto {
  @ApiProperty()
  @IsUUID()
  accountId!: string;

  @ApiProperty({ example: 200000 })
  @IsInt()
  @Min(1)
  amount!: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
