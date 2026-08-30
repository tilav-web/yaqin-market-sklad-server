import { IsNotEmpty, IsString, Length, MinLength } from 'class-validator';

export class AdminForgotPasswordRequestDto {
  /** Username yoki biriktirilgan telefon raqami */
  @IsString()
  @IsNotEmpty({ message: 'Username yoki telefon raqamingizni kiriting' })
  identifier!: string;
}

export class AdminForgotPasswordResetDto {
  @IsString()
  @IsNotEmpty()
  identifier!: string;

  @IsString()
  @Length(6, 6, {
    message: "Tasdiqlash kodi 6 ta raqamdan iborat bo'lishi kerak",
  })
  code!: string;

  @IsString()
  @MinLength(6, {
    message: "Yangi parol kamida 6 ta belgidan iborat bo'lishi kerak",
  })
  newPassword!: string;
}
