import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class AdminListUsersQuery {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(64)
  search?: string;

  @ApiPropertyOptional({ default: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;
}

export class AdminSetStatusDto {
  @ApiProperty({ description: 'true = bloklash, false = blokdan chiqarish' })
  @IsBoolean()
  blocked!: boolean;
}

export class AdminSetAdminDto {
  @ApiProperty()
  @IsBoolean()
  isAdmin!: boolean;
}
