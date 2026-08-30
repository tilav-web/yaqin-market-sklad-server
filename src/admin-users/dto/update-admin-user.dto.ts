import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { AdminRole } from '../entities/admin-user.entity';

export class UpdateAdminUserDto {
  @IsString()
  @IsOptional()
  @MinLength(3, {
    message: "Username kamida 3 ta belgidan iborat bo'lishi kerak",
  })
  @MaxLength(64)
  username?: string;

  @IsString()
  @IsOptional()
  @MaxLength(64)
  firstName?: string;

  @IsString()
  @IsOptional()
  @MaxLength(64)
  lastName?: string;

  @IsString()
  @IsOptional()
  phone?: string;

  @IsString()
  @IsOptional()
  email?: string;

  @IsEnum(AdminRole)
  @IsOptional()
  role?: AdminRole;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  permissions?: string[];

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}

export class ResetAdminPasswordDto {
  @IsString()
  @MinLength(6)
  newPassword!: string;
}
