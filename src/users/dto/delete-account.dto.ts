import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class DeleteAccountDto {
  @ApiPropertyOptional({
    description: 'Pre-defined reason key chosen by user',
    example: 'bad_experience',
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  reasonKey?: string;

  @ApiPropertyOptional({
    description: 'Additional feedback or reason text entered by user',
    example: 'Yetkazib berish xizmati qoniqtirmadi',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reasonDetails?: string;
}
