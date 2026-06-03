import { plainToInstance } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  validateSync,
  Min,
} from 'class-validator';

export enum Environment {
  Development = 'development',
  Production = 'production',
  Test = 'test',
}

export class EnvironmentVariables {
  @IsEnum(Environment)
  NODE_ENV: Environment = Environment.Development;

  @IsInt()
  @Min(1)
  PORT = 3000;

  // Postgres
  @IsString()
  POSTGRES_HOST!: string;

  @IsInt()
  POSTGRES_PORT!: number;

  @IsString()
  POSTGRES_USER!: string;

  @IsString()
  POSTGRES_PASSWORD!: string;

  @IsString()
  POSTGRES_DB!: string;

  // Redis
  @IsString()
  REDIS_HOST!: string;

  @IsInt()
  REDIS_PORT!: number;

  // JWT
  @IsString()
  JWT_SECRET!: string;

  @IsString()
  JWT_REFRESH_SECRET!: string;

  @IsString()
  @IsOptional()
  JWT_ACCESS_TTL = '15m';

  @IsString()
  @IsOptional()
  JWT_REFRESH_TTL = '30d';

  // Comma-separated allowed CORS origins (production only).
  @IsString()
  @IsOptional()
  CORS_ORIGINS = '';

  // MinIO / S3
  @IsString()
  MINIO_ENDPOINT = 'localhost';

  @IsInt()
  MINIO_PORT = 9100;

  @IsBoolean()
  @IsOptional()
  MINIO_USE_SSL = false;

  @IsString()
  MINIO_ACCESS_KEY!: string;

  @IsString()
  MINIO_SECRET_KEY!: string;

  @IsString()
  MINIO_BUCKET = 'yaqin-uploads';

  // SMS (Eskiz.uz)
  @IsString()
  @IsOptional()
  ESKIZ_EMAIL = '';

  @IsString()
  @IsOptional()
  ESKIZ_PASSWORD = '';

  @IsString()
  @IsOptional()
  ESKIZ_FROM = '4546';

  // Dev helpers
  @IsString()
  @IsOptional()
  FIXED_OTP_CODE = '';
}

export function validateEnv(config: Record<string, unknown>): EnvironmentVariables {
  const coerced = {
    ...config,
    PORT: Number(config.PORT ?? 3000),
    POSTGRES_PORT: Number(config.POSTGRES_PORT),
    REDIS_PORT: Number(config.REDIS_PORT),
    MINIO_PORT: Number(config.MINIO_PORT ?? 9100),
    MINIO_USE_SSL: config.MINIO_USE_SSL === 'true',
  };

  const validated = plainToInstance(EnvironmentVariables, coerced, {
    enableImplicitConversion: false,
  });
  const errors = validateSync(validated, { skipMissingProperties: false });
  if (errors.length > 0) {
    throw new Error(
      `Environment variable validation failed:\n${errors
        .map((e) => `  - ${e.property}: ${Object.values(e.constraints ?? {}).join(', ')}`)
        .join('\n')}`,
    );
  }
  return validated;
}
