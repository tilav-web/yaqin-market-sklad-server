import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class SendConversationMessageDto {
  @ApiProperty({ example: 'Salom, bu mahsulot bormi?' })
  @IsString()
  @MaxLength(2000)
  text!: string;

  @ApiPropertyOptional({ description: 'Referenced product variant ID' })
  @IsOptional()
  @IsUUID()
  attachedProductId?: string;

  @ApiPropertyOptional({ description: 'Referenced order number' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  attachedOrderNumber?: string;

  @ApiPropertyOptional({ description: 'Optional image attachment URL' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  photoUrl?: string;
}
