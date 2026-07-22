import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString, Length, Matches, MaxLength } from 'class-validator';

export class AddCardDto {
  @ApiProperty({ example: '8600123412341234', description: 'Karta raqami, bo\'shliqsiz' })
  @IsString()
  @Length(16, 19)
  @Matches(/^\d+$/, { message: 'card_number faqat raqamlardan iborat bo\'lishi kerak' })
  card_number!: string;

  @ApiProperty({ example: '1229', description: 'Amal qilish muddati MMYY formatida' })
  @IsString()
  @Length(4, 4)
  @Matches(/^\d{4}$/, { message: 'expire_date MMYY formatida bo\'lishi kerak' })
  expire_date!: string;

  @ApiPropertyOptional({ example: 'Ish kartam', description: 'Karta uchun ixtiyoriy nom' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  label?: string;
}
