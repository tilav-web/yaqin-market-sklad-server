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

import type { UnitType } from '../entities/product-variant.entity';

export class CreateProductFamilyDto {
  @ApiProperty()
  @IsString()
  @MaxLength(256)
  name!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  brand?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;
}

export class CreateProductVariantDto {
  @ApiProperty()
  @IsUUID()
  productFamilyId!: string;

  @ApiProperty()
  @IsString()
  @MaxLength(256)
  name!: string;

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

  @ApiProperty({ enum: ['piece', 'kg', 'liter', 'gram', 'pack'] })
  @IsEnum(['piece', 'kg', 'liter', 'gram', 'pack'])
  unitType!: UnitType;

  @ApiProperty({ example: 1 })
  @IsNumber()
  @IsPositive()
  unitSize!: number;

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

  @ApiPropertyOptional({ example: 3500, description: 'Boshlang\'ich qoldiq tannarxi (dona uchun)' })
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
  @IsString()
  barcode?: string;

  @ApiPropertyOptional({ example: '2027-01-01' })
  @IsOptional()
  @IsString()
  expiryDate?: string;
}

export class UpdateProductVariantDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
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
