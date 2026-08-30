import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

export class CreateContactDto {
  @ApiProperty({ example: 'Akmal' })
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  name!: string;

  @ApiProperty({ example: '+998901234567' })
  @IsString()
  @MinLength(7)
  @MaxLength(32)
  phone!: string;

  @ApiProperty({ example: "Do'kon ochmoqchiman, qanday qilsam bo'ladi?" })
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  message!: string;
}
