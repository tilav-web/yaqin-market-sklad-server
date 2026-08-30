import { IsNotEmpty, IsString, MinLength } from 'class-validator';

export class AdminChangePasswordDto {
  @IsString()
  @IsNotEmpty({ message: 'Eski parol kiritilishi shart' })
  oldPassword!: string;

  @IsString()
  @IsNotEmpty({ message: 'Yangi parol kiritilishi shart' })
  @MinLength(6, {
    message: "Yangi parol kamida 6 ta belgidan iborat bo'lishi kerak",
  })
  newPassword!: string;
}
