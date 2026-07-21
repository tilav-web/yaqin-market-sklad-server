import { ApiProperty } from '@nestjs/swagger';
import { IsString, Length } from 'class-validator';

export class VerifyCardDto {
  @ApiProperty({ example: '12345' })
  @IsString()
  @Length(4, 6)
  sms_code!: string;
}
