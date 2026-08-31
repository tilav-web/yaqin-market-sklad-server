import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

import { WithdrawalStatus } from '../entities/withdrawal-request.entity';

export class RequestWithdrawalDto {
  @ApiProperty({
    example: 500000,
    description: "Yechib olinadigan miqdor (so'm)",
  })
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  amount!: number;

  @ApiPropertyOptional({
    description: 'Shop ID if withdrawing for a specific shop',
  })
  @IsOptional()
  @IsUUID()
  shopId?: string;

  @ApiPropertyOptional({ example: '20208000123456789001' })
  @IsOptional()
  @IsString()
  bankAccountNumber?: string;

  @ApiPropertyOptional({ example: '00444' })
  @IsOptional()
  @IsString()
  bankMfo?: string;

  @ApiPropertyOptional({ example: 'AT Xalq Banki' })
  @IsOptional()
  @IsString()
  bankName?: string;

  @ApiPropertyOptional({ example: '"TILAV" MCHJ' })
  @IsOptional()
  @IsString()
  recipientName?: string;

  @ApiPropertyOptional({ example: '8600123456781234' })
  @IsOptional()
  @IsString()
  bankCardNumber?: string;

  @ApiPropertyOptional({ example: 'MUHAMMAD MUHAMMADOV' })
  @IsOptional()
  @IsString()
  bankCardHolderName?: string;
}

export class ProcessWithdrawalDto {
  @ApiProperty()
  @IsBoolean()
  approve!: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class AdjustBalanceDto {
  @ApiProperty({
    example: -20000,
    description: "Musbat — qo'shish, manfiy — ayirish",
  })
  @IsNumber({ maxDecimalPlaces: 2 })
  amount!: number;

  @ApiProperty()
  @IsString()
  @MaxLength(500)
  description!: string;
}

export class ForgiveDebtDto {
  @ApiProperty()
  @IsString()
  @MaxLength(500)
  reason!: string;
}

export class ExtendDebtDto {
  @ApiProperty({ example: 7 })
  @IsInt()
  @Min(1)
  @Max(365)
  days!: number;
}

export class AdminListWithdrawalsQuery {
  @ApiPropertyOptional({ enum: WithdrawalStatus })
  @IsOptional()
  @IsEnum(WithdrawalStatus)
  status?: WithdrawalStatus;

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
