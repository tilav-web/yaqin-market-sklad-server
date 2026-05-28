import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsIn,
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

  @ApiPropertyOptional({ enum: ['relevance', 'price_asc', 'price_desc', 'rating'] })
  @IsOptional()
  @IsIn(['relevance', 'price_asc', 'price_desc', 'rating'])
  sort?: FeedSort;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  onlyDiscounted?: boolean;
}
