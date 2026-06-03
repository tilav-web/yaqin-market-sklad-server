import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class DebtLineInputDto {
  @ApiProperty()
  @IsUUID()
  variantId!: string;

  @ApiProperty({ example: 2 })
  @IsInt()
  @Min(1)
  quantity!: number;
}

export class CreateDebtDto {
  @ApiProperty()
  @IsString()
  @MaxLength(128)
  customerName!: string;

  @ApiProperty({ example: '+998901234567' })
  @IsString()
  @Matches(/^\+?\d{9,15}$/)
  customerPhone!: string;

  @ApiPropertyOptional({ type: [DebtLineInputDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => DebtLineInputDto)
  lines?: DebtLineInputDto[];

  @ApiPropertyOptional({ example: 3000, description: 'Tizimda yo\'q tovarlar uchun qo\'shimcha narx' })
  @IsOptional()
  @IsInt()
  @Min(0)
  extraCharge?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;

  @ApiProperty({ description: 'Qoldiqdan kamaytirilsinmi? (majburiy tanlov)' })
  @IsBoolean()
  decrementStock!: boolean;
}

export class AddPaymentDto {
  @ApiProperty({ example: '+998901234567' })
  @IsString()
  @Matches(/^\+?\d{9,15}$/)
  customerPhone!: string;

  @ApiProperty({ example: 5000 })
  @IsInt()
  @Min(1)
  amount!: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
