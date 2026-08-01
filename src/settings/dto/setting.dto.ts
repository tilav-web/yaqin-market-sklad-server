import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

export class SetSettingValueDto {
  @ApiProperty({ example: '12.00' })
  @IsString()
  @MaxLength(256)
  value!: string;

  /**
   * Komissiya break-even ostiga tushirilganda tizim rad etadi; admin
   * ogohlantirishni ko'rib ataylab davom etmoqchi bo'lsa true yuboradi.
   */
  @ApiPropertyOptional({ example: false })
  @IsOptional()
  @IsBoolean()
  force?: boolean;
}
