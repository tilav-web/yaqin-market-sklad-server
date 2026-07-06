import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsInt,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class RequestWithdrawalDto {
  @ApiProperty({ example: 500000, description: 'Yechib olinadigan miqdor (so\'m)' })
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  amount!: number;

  @ApiProperty({ example: '8600123456781234' })
  @IsString()
  @Matches(/^\d{12,19}$/, { message: 'Karta raqami 12-19 ta raqamdan iborat bo\'lishi kerak' })
  bankCardNumber!: string;

  @ApiProperty({ example: 'MUHAMMAD MUHAMMADOV' })
  @IsString()
  @MaxLength(128)
  bankCardHolderName!: string;
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
  @ApiProperty({ example: -20000, description: 'Musbat — qo\'shish, manfiy — ayirish' })
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
