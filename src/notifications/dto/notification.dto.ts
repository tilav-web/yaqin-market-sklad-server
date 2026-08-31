import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  MaxLength,
} from 'class-validator';

export class BroadcastDto {
  @ApiProperty()
  @IsString()
  @MaxLength(128)
  title!: string;

  @ApiProperty()
  @IsString()
  @MaxLength(512)
  body!: string;

  @ApiProperty({ enum: ['all', 'sellers', 'customers', 'specific'] })
  @IsEnum(['all', 'sellers', 'customers', 'specific'])
  audience!: 'all' | 'sellers' | 'customers' | 'specific';

  @ApiPropertyOptional({
    type: [String],
    description: 'UUIDs (audience=specific)',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5000)
  @IsUUID('4', { each: true })
  userIds?: string[];

  @ApiPropertyOptional({
    type: [String],
    description: 'Telefon raqamlar (audience=specific)',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5000)
  @IsString({ each: true })
  phones?: string[];

  @ApiPropertyOptional({
    description: "Rasm URL (notification ichida ko'rsatiladi)",
  })
  @IsOptional()
  @IsUrl()
  @MaxLength(512)
  imageUrl?: string;

  @ApiPropertyOptional({
    description: 'Bosish uchun sahifa (masalan: /orders, /notifications)',
  })
  @IsOptional()
  @IsString()
  @MaxLength(256)
  deepLink?: string;

  @ApiPropertyOptional({
    description:
      "HTML ko'rinishidagi to'liq matn (in-app detail sahifasi uchun)",
  })
  @IsOptional()
  @IsString()
  richBody?: string;
}

import type { LocalizedInput } from '../../common/types/localized-text.type';

export class TemplateDto {
  @ApiProperty()
  @IsString()
  @MaxLength(128)
  name!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(128)
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
  @MaxLength(512)
  body?: string;

  @ApiPropertyOptional()
  @IsOptional()
  bodyI18n?: LocalizedInput;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  bodyUzLatn?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  bodyUzCyrl?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  bodyRu?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  richBody?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(512)
  imageUrl?: string;
}

export class UpdateTemplateDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(128)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(128)
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
  @MaxLength(512)
  body?: string;

  @ApiPropertyOptional()
  @IsOptional()
  bodyI18n?: LocalizedInput;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  bodyUzLatn?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  bodyUzCyrl?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  bodyRu?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  richBody?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(512)
  imageUrl?: string;
}
