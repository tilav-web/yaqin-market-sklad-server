import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

export class UpsertChatTemplateDto {
  @ApiProperty()
  @IsString()
  @MaxLength(500)
  text!: string;
}

export class ReorderChatTemplatesDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @IsUUID(undefined, { each: true })
  ids!: string[];
}
