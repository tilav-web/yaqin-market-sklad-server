import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsLatitude,
  IsLongitude,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';

import { LocationEvidenceDto } from '../../geo/location-evidence';

export class CreateAddressDto {
  @ApiProperty({ example: 'Uy' })
  @IsString()
  @MaxLength(64)
  label!: string;

  @ApiProperty({ example: 'Toshkent, Yunusobod 1' })
  @IsString()
  @MaxLength(512)
  address!: string;

  @ApiProperty()
  @IsLatitude()
  latitude!: number;

  @ApiProperty()
  @IsLongitude()
  longitude!: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(256)
  notes?: string;

  @ApiPropertyOptional({ example: '2' })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  entrance?: string;

  @ApiPropertyOptional({ example: '5' })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  floor?: string;

  @ApiPropertyOptional({ example: '45' })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  apartment?: string;

  @ApiPropertyOptional({ example: '1234' })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  intercom?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;

  /** Best-effort device fix at the moment this pin was set (anti-fraud). */
  @ApiPropertyOptional({ type: LocationEvidenceDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => LocationEvidenceDto)
  evidence?: LocationEvidenceDto;
}

export class UpdateAddressDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(64)
  label?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(512)
  address?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsLatitude()
  latitude?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsLongitude()
  longitude?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(256)
  notes?: string;

  @ApiPropertyOptional({ example: '2' })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  entrance?: string;

  @ApiPropertyOptional({ example: '5' })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  floor?: string;

  @ApiPropertyOptional({ example: '45' })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  apartment?: string;

  @ApiPropertyOptional({ example: '1234' })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  intercom?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;

  /** Best-effort device fix at the moment this pin was set (anti-fraud). */
  @ApiPropertyOptional({ type: LocationEvidenceDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => LocationEvidenceDto)
  evidence?: LocationEvidenceDto;
}
