import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

export class PayWithCardDto {
  @ApiProperty()
  @IsUUID()
  cardId!: string;
}
