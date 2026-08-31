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

  @ApiPropertyOptional({ description: 'Tashkilot nomi' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  companyName?: string;

  @ApiPropertyOptional({ description: 'YaTT, MChJ, AJ...' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  entityType?: string;

  @ApiPropertyOptional({ description: 'Yuridik manzil' })
  @IsOptional()
  @IsString()
  @MaxLength(512)
  legalAddress?: string;

  @ApiPropertyOptional({ description: '16 xonali Uzcard / Humo karta raqami' })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  bankCardNumber?: string;

  @ApiPropertyOptional({ description: 'Karta egasining F.I.SH.' })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  bankCardHolderName?: string;

  @ApiPropertyOptional({ description: '20 xonali bank hisob raqami' })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  bankAccountNumber?: string;

  @ApiPropertyOptional({ description: '5 xonali bank MFO kodi' })
  @IsOptional()
  @IsString()
  @MaxLength(16)
  bankMfo?: string;

  @ApiPropertyOptional({ description: 'Bank nomi' })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  bankName?: string;

  @ApiPropertyOptional({ description: 'Hisob egasi yoki tashkilot nomi' })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  bankAccountHolderName?: string;

  @ApiPropertyOptional({ description: 'my.soliq.uz da biriktirilgani' })
  @IsOptional()
  @IsBoolean()
  soliqConfirmed?: boolean;

  @ApiPropertyOptional({ description: 'Ommaviy ofertaga rozilik' })
  @IsOptional()
  @IsBoolean()
  ofertaAccepted?: boolean;

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

export class CreateSellerBankAccountDto {
  @ApiProperty({ description: '20-digit bank account number' })
  @IsString()
  @MaxLength(32)
  accountNumber!: string;

  @ApiProperty({ description: '5-digit bank MFO code' })
  @IsString()
  @MaxLength(16)
  mfo!: string;

  @ApiProperty({ description: 'Bank branch name' })
  @IsString()
  @MaxLength(128)
  bankName!: string;

  @ApiProperty({ description: 'Account holder / company name' })
  @IsString()
  @MaxLength(128)
  accountHolderName!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}
