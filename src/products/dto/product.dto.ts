import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';

import type { UnitType } from '../entities/global-product.entity';

const UNIT_TYPES = ['piece', 'kg', 'liter', 'gram', 'pack'] as const;

/**
 * Clone a GlobalProduct into this shop — only commercial fields needed
 * since display data lives in the shared GlobalProduct.
 */
export class CloneFromCatalogDto {
  @ApiProperty({ description: 'GlobalProduct ID' })
  @IsUUID()
  globalProductId!: string;

  @ApiProperty({ example: 5000 })
  @IsInt()
  @Min(0)
  price!: number;

  @ApiProperty({ example: 10 })
  @IsInt()
  @Min(0)
  stock!: number;

  @ApiPropertyOptional({ example: 3500 })
  @IsOptional()
  @IsInt()
  @Min(0)
  costPrice?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  discountPrice?: number;

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
}

/** Create a new product not yet in the shared catalogue. */
export class CreateCustomProductDto {
  @ApiProperty()
  @IsString()
  @MaxLength(256)
  name!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  brand?: string;

  @ApiPropertyOptional({ enum: UNIT_TYPES })
  @IsOptional()
  @IsEnum(UNIT_TYPES)
  unitType?: UnitType;

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @IsNumber()
  @IsPositive()
  unitSize?: number;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5)
  @IsString({ each: true })
  photos?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(64)
  barcode?: string;

  @ApiProperty({ example: 5000 })
  @IsInt()
  @Min(0)
  price!: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  discountPrice?: number;

  @ApiProperty({ example: 10 })
  @IsInt()
  @Min(0)
  stock!: number;

  @ApiPropertyOptional({ example: 3500 })
  @IsOptional()
  @IsInt()
  @Min(0)
  costPrice?: number;

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
}

export class UpdateProductVariantDto {
  // Display fields — only editable for private (seller-owned) GlobalProducts
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(256)
  name?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5)
  @IsString({ each: true })
  photos?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  // Commercial fields — always editable
  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  price?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  discountPrice?: number | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  lowStockThreshold?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  criticalThreshold?: number | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class AdjustStockDto {
  @ApiProperty({ example: 10 })
  @IsInt()
  delta!: number;

  @ApiPropertyOptional({ example: 'New arrival' })
  @IsOptional()
  @IsString()
  reason?: string;
}

export class CountStockDto {
  @ApiProperty({ example: 12, description: 'Real sanab chiqilgan haqiqiy qoldiq' })
  @IsInt()
  @Min(0)
  actualQty!: number;
}

export class ReceiveStockDto {
  @ApiProperty({ example: 50, description: 'Kelgan miqdor' })
  @IsInt()
  @IsPositive()
  quantity!: number;

  @ApiProperty({ example: 3500, description: 'Dona uchun tannarx (kirim narxi)' })
  @IsInt()
  @Min(0)
  costPrice!: number;

  @ApiPropertyOptional({ example: '2027-01-01' })
  @IsOptional()
  @IsString()
  expiryDate?: string;

  @ApiPropertyOptional({ example: 'Optom baza' })
  @IsOptional()
  @IsString()
  @MaxLength(256)
  supplierName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(256)
  note?: string;
}
