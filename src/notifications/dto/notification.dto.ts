import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateIf,
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

  @ApiPropertyOptional({ type: [String], description: 'UUIDs (audience=specific)' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5000)
  @IsUUID('4', { each: true })
  userIds?: string[];

  @ApiPropertyOptional({ type: [String], description: 'Telefon raqamlar (audience=specific)' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5000)
  @IsString({ each: true })
  phones?: string[];
}

export class TemplateDto {
  @ApiProperty()
  @IsString()
  @MaxLength(128)
  name!: string;

  @ApiProperty()
  @IsString()
  @MaxLength(128)
  title!: string;

  @ApiProperty()
  @IsString()
  @MaxLength(512)
  body!: string;
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
  @IsString()
  @MaxLength(512)
  body?: string;
}
