import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
} from 'class-validator';

export type FeedSort = 'relevance' | 'price_asc' | 'price_desc' | 'rating';

/** Query params for the customer Home/Search product feed. */
export class FeedQueryDto {
  @IsNumber()
  lat!: number;

  @IsNumber()
  lng!: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  limit?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  q?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  /** Comma-separated category ids (multi-select). Takes priority over categoryId. */
  @ApiPropertyOptional({ description: 'Comma-separated category ids' })
  @IsOptional()
  @IsString()
  categoryIds?: string;

  /**
   * Sort spec. Single token (`price_asc`) or a comma-separated ordered combo
   * (`price_asc,rating`) — the first token is primary, the rest tiebreakers.
   */
  @ApiPropertyOptional({
    description: 'e.g. "price_asc", "rating", "price_asc,rating"',
  })
  @IsOptional()
  @IsString()
  sort?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  onlyDiscounted?: boolean;

  /** Minimum effective price (so'm). */
  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  minPrice?: number;

  /** Maximum effective price (so'm). */
  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  maxPrice?: number;
}
