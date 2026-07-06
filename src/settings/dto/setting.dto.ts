import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength } from 'class-validator';

export class SetSettingValueDto {
  @ApiProperty({ example: '12.00' })
  @IsString()
  @MaxLength(256)
  value!: string;
}
