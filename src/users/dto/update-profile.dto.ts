import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateProfileDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(128)
  name?: string;

  /**
   * Avatar identifier (e.g. "boy-1"). The client maps it to a bundled emoji
   * avatar, so the backend only stores a short key — not an uploaded image.
   */
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(64)
  avatarUrl?: string;
}
