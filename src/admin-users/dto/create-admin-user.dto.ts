import {
  IsArray,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsPhoneNumber,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { AdminRole } from '../entities/admin-user.entity';

export class CreateAdminUserDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(3)
  @MaxLength(32)
  @Matches(/^[a-zA-Z0-9._-]+$/, {
    message:
      "Username faqat lotin harflari, raqamlar va . _ - belgilaridan iborat bo'lishi kerak",
  })
  username!: string;

  @IsString()
  @IsNotEmpty()
  @MinLength(6)
  password!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  firstName!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  lastName!: string;

  @IsString()
  @IsOptional()
  phone?: string;

  @IsString()
  @IsOptional()
  email?: string;

  @IsEnum(AdminRole)
  role!: AdminRole;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  permissions?: string[];
}
