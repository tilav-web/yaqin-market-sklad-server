import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';

export class AdminCatalogImportRowDto {
  @ApiProperty()
  @IsInt()
  rowNumber!: number;

  @ApiProperty()
  @IsString()
  @MaxLength(256)
  name!: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  barcode?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  brand?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  categoryId?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  unitType?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsNumber()
  unitSize?: number;

  @ApiProperty({ required: false, default: true })
  @IsOptional()
  @IsBoolean()
  isVerified?: boolean;
}

export class ConfirmAdminCatalogImportDto {
  @ApiProperty({ type: [AdminCatalogImportRowDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => AdminCatalogImportRowDto)
  rows!: AdminCatalogImportRowDto[];
}

export class AdminCatalogImportRowResult extends AdminCatalogImportRowDto {
  @ApiProperty()
  @IsArray()
  @IsString({ each: true })
  warnings!: string[];
}

export class AdminCatalogImportPreviewResult {
  willCreate!: number;
  errors!: { row: number; message: string }[];
  rows!: AdminCatalogImportRowResult[];
}

export class AdminCatalogImportConfirmResult {
  created!: number;
  skipped!: number;
  failed!: { row: number; message: string }[];
}
