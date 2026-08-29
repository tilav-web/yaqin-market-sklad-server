import { IsNotEmpty, IsString, MinLength } from 'class-validator';

export class AdminLoginDto {
  @IsString()
  @IsNotEmpty({ message: 'Username kiritilishi shart' })
  username!: string;

  @IsString()
  @IsNotEmpty({ message: 'Parol kiritilishi shart' })
  @MinLength(6, { message: 'Parol kamida 6 ta belgidan iborat bo\'lishi kerak' })
  password!: string;
}

export class AdminRefreshTokenDto {
  @IsString()
  @IsNotEmpty()
  refreshToken!: string;
}
