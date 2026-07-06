import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsDateString,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

import type { UnitType } from '../../entities/global-product.entity';

const UNIT_TYPES = ['piece', 'kg', 'liter', 'gram', 'pack'] as const;

export class InventoryExportQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @ApiPropertyOptional({ enum: ['low', 'ok', 'zero'] })
  @IsOptional()
  @IsIn(['low', 'ok', 'zero'])
  stockStatus?: 'low' | 'ok' | 'zero';
}

/** Inclusive date range for the orders / inventory-movement exports. */
export class DateRangeQueryDto {
  @ApiProperty({ example: '2026-06-01' })
  @IsDateString()
  from!: string;

  @ApiProperty({ example: '2026-06-30' })
  @IsDateString()
  to!: string;
}

/**
 * One validated+normalized row, as returned by the preview endpoint and sent
 * back (verbatim, or after the seller edits/removes rows) to the confirm
 * endpoint. Keeping this stateless (no server-side cached upload) avoids
 * needing a staging store between the two calls.
 */
export class ImportRowDto {
  @ApiProperty({ description: 'Excel row number, for error reporting' })
  @IsInt()
  @Min(1)
  rowNumber!: number;

  @ApiProperty()
  @IsString()
  @MaxLength(256)
  name!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(64)
  barcode?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @ApiProperty()
  @IsNumber()
  @Min(0)
  price!: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  discountPrice?: number;

  @ApiProperty()
  @IsInt()
  @Min(0)
  stock!: number;

  @ApiPropertyOptional({ enum: UNIT_TYPES })
  @IsOptional()
  @IsIn(UNIT_TYPES)
  unitType?: UnitType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @IsPositive()
  unitSize?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  lowStockThreshold?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  criticalThreshold?: number;

  @ApiPropertyOptional({ example: '2027-01-01' })
  @IsOptional()
  @IsString()
  expiryDate?: string;

  /** Set by preview when `barcode` matched an existing GlobalProduct. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  globalProductId?: string;
}

export class ConfirmImportDto {
  @ApiProperty({ type: [ImportRowDto] })
  @IsArray()
  @ArrayMaxSize(1000)
  @ValidateNested({ each: true })
  @Type(() => ImportRowDto)
  rows!: ImportRowDto[];
}
