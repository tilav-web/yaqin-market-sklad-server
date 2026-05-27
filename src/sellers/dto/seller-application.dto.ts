import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsLatitude,
  IsLongitude,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
} from 'class-validator';

export class CreateSellerApplicationDto {
  @ApiProperty()
  @IsString()
  @MaxLength(128)
  shopName!: string;

  @ApiProperty()
  @IsString()
  @MaxLength(512)
  shopAddress!: string;

  @ApiProperty()
  @IsLatitude()
  shopLatitude!: number;

  @ApiProperty()
  @IsLongitude()
  shopLongitude!: number;

  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(5)
  @IsUrl({}, { each: true })
  shopPhotos!: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(64)
  stir?: string;
}

export class RejectApplicationDto {
  @ApiProperty()
  @IsString()
  @MaxLength(512)
  reason!: string;
}
