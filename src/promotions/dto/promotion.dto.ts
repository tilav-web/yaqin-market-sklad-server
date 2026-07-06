import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  MaxLength,
  ValidateIf,
} from 'class-validator';

const PROMOTION_TYPES = ['product_discount', 'category_discount', 'free_delivery'] as const;
const DISCOUNT_TYPES = ['percent', 'fixed'] as const;

export class CreatePromotionDto {
  @ApiProperty()
  @IsString()
  @MaxLength(128)
  name!: string;

  @ApiProperty({ enum: PROMOTION_TYPES })
  @IsIn(PROMOTION_TYPES)
  type!: (typeof PROMOTION_TYPES)[number];

  @ApiPropertyOptional({ enum: DISCOUNT_TYPES })
  @ValidateIf((o: CreatePromotionDto) => o.type !== 'free_delivery')
  @IsIn(DISCOUNT_TYPES)
  discountType?: (typeof DISCOUNT_TYPES)[number];

  @ApiPropertyOptional({ example: 15 })
  @ValidateIf((o: CreatePromotionDto) => o.type !== 'free_delivery')
  @IsInt()
  @IsPositive()
  discountValue?: number;

  @ApiPropertyOptional()
  @ValidateIf((o: CreatePromotionDto) => o.type === 'product_discount')
  @IsUUID()
  targetProductId?: string;

  @ApiPropertyOptional()
  @ValidateIf((o: CreatePromotionDto) => o.type === 'category_discount')
  @IsUUID()
  targetCategoryId?: string;

  @ApiPropertyOptional({ example: 50000 })
  @IsOptional()
  @IsInt()
  @IsPositive()
  freeDeliveryMinAmount?: number;

  @ApiProperty({ example: '2026-08-01T00:00:00.000Z' })
  @IsISO8601()
  startAt!: string;

  @ApiPropertyOptional({ example: '2026-08-31T23:59:59.000Z' })
  @IsOptional()
  @IsISO8601()
  endAt?: string;
}
