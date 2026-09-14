import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
} from 'class-validator';

import type { LocalizedInput } from '../../common/types/localized-text.type';

export class CreateTaxCategoryDto {
  @ApiPropertyOptional({ example: 'Gazlangan ichimliklar (PET)' })
  @IsOptional()
  @IsString()
  @MaxLength(256)
  title?: string;

  @ApiPropertyOptional()
  @IsOptional()
  titleI18n?: LocalizedInput;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  titleUzLatn?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  titleUzCyrl?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  titleRu?: string;

  @ApiProperty({
    example: '02202001001000000',
    description: '17 xonali MXIK/IKPU (tasnif.soliq.uz)',
  })
  @IsString()
  @Matches(/^\d{17}$/, { message: "MXIK kodi 17 xonali raqam bo'lishi kerak" })
  mxikCode!: string;

  @ApiPropertyOptional({ description: 'Tasnifdagi qadoq kodi' })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  packageCode?: string;

  @ApiPropertyOptional({ description: "O'lchov birligi kodi" })
  @IsOptional()
  @IsString()
  @MaxLength(16)
  unitCode?: string;

  @ApiPropertyOptional({
    description: 'Asl belgisi majburiy markirovka ostidami',
  })
  @IsOptional()
  @IsBoolean()
  markingRequired?: boolean;
}

export class UpdateTaxCategoryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(256)
  title?: string;

  @ApiPropertyOptional()
  @IsOptional()
  titleI18n?: LocalizedInput;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  titleUzLatn?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  titleUzCyrl?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  titleRu?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Matches(/^\d{17}$/, { message: "MXIK kodi 17 xonali raqam bo'lishi kerak" })
  mxikCode?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(32)
  packageCode?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(16)
  unitCode?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  markingRequired?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class AssignTaxCategoryDto {
  @ApiPropertyOptional({
    description: 'null — biriktirilgan toifani olib tashlash',
    nullable: true,
  })
  @IsOptional()
  @IsUUID()
  taxCategoryId?: string | null;
}

export class ApplyTasnifDto {
  @ApiProperty({ description: 'Tasnif taklifidan kelgan 17 xonali MXIK' })
  @IsString()
  @Matches(/^\d{17}$/, { message: "MXIK kodi 17 xonali raqam bo'lishi kerak" })
  mxikCode!: string;

  @ApiProperty({ description: 'Toifa nomi (tasnifdagi mxikName)' })
  @IsString()
  @MaxLength(512)
  name!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(16)
  unitCode?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  markingRequired?: boolean;
}

export class SubmitTaxReportDto {
  @ApiProperty({
    example: 'salary_ndfl',
    enum: ['salary_ndfl', 'vat', 'profit_tax'],
  })
  @IsString()
  reportType!: string;

  @ApiProperty({ example: '2026-08' })
  @IsString()
  period!: string;

  @ApiProperty({ example: '2026-09-15' })
  @IsString()
  dueDate!: string;

  @ApiProperty({
    description: "Hisobot parametrlari va hisoblangan ma'lumotlar",
  })
  @IsOptional()
  data?: Record<string, unknown>;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiPropertyOptional({ example: 'my.soliq.uz orqali qabul qilindi' })
  @IsOptional()
  @IsString()
  submissionConfirmation?: string;
}

export class CalculateSalaryTaxDto {
  @ApiPropertyOptional({ example: 1155000, description: 'MHTEKM (baza) oylik' })
  @IsOptional()
  baseSalary?: number;

  @ApiPropertyOptional({
    example: 0.25,
    description: 'Stavka (0.25, 0.5, 1.0)',
  })
  @IsOptional()
  rate?: number;
}

export class CalculateProfitVatDto {
  @ApiPropertyOptional({ example: '2026-08' })
  @IsOptional()
  @IsString()
  period?: string;

  @ApiPropertyOptional({
    example: 1000000,
    description: "Qo'shimcha xarajatlar (hosting, aloqa va h.k.)",
  })
  @IsOptional()
  additionalExpenses?: number;

  @ApiPropertyOptional({
    description:
      "Qo'lda kiritilgan tushum (agar tizimdan tashqari tushum bo'lsa)",
  })
  @IsOptional()
  manualRevenue?: number;
}
