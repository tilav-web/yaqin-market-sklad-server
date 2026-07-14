import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class CreateReleaseDto {
  @ApiProperty({ example: '1.0.3' })
  @IsString()
  @MinLength(1)
  @MaxLength(32)
  @Matches(/^\d+\.\d+\.\d+$/, { message: "Versiya X.Y.Z formatida bo'lishi kerak (masalan 1.2.3)" })
  version!: string;

  @ApiPropertyOptional({ example: 'Xatoliklar tuzatildi, tezlik oshirildi' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}
