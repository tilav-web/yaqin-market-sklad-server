import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateReleaseDto {
  @ApiProperty({ example: '1.0.3' })
  @IsString()
  @MinLength(1)
  @MaxLength(32)
  version!: string;

  @ApiPropertyOptional({ example: 'Xatoliklar tuzatildi, tezlik oshirildi' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}
