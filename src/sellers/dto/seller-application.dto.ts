import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateSellerApplicationDto {
  @ApiProperty()
  @IsString()
  @MaxLength(64)
  firstName!: string;

  @ApiProperty()
  @IsString()
  @MaxLength(64)
  lastName!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(32)
  contactPhone?: string;

  @ApiPropertyOptional({
    description: 'STIR (soliq raqami) — chek chiqarish uchun kerak',
  })
  @IsOptional()
  @IsString()
  @MaxLength(16)
  stir?: string;

  @ApiPropertyOptional({ description: 'YaTT, MChJ, AJ...' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  entityType?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}

export class SetKomissionerStatusDto {
  @ApiProperty({
    description:
      "true = soliq kabinetida tasdiqlangan, false = qaytadan 'pending'",
  })
  @IsBoolean()
  confirmed!: boolean;
}

export class RejectApplicationDto {
  @ApiProperty()
  @IsString()
  @MaxLength(512)
  reason!: string;
}

export class ApproveApplicationDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(128)
  fullName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(64)
  passportOrPinfl?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(16)
  stir?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(64)
  entityType?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(32)
  bankCardNumber?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(128)
  bankCardHolderName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(64)
  contractNumber?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  contractDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  adminNotes?: string;
}

export class UpsertSellerProfileDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(128)
  fullName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(64)
  passportOrPinfl?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(16)
  stir?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(64)
  entityType?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(32)
  bankCardNumber?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(128)
  bankCardHolderName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(64)
  contractNumber?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  contractDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  adminNotes?: string;

  @ApiPropertyOptional({
    description: "QQS to'lovchimi — cheklar QQS bilan chiqadi",
  })
  @IsOptional()
  @IsBoolean()
  vatPayer?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  verify?: boolean;
}
