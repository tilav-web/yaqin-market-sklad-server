import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

import { AppModule } from './app.module';
import { EnvironmentVariables } from './config/configuration';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  const configService = app.get(ConfigService<EnvironmentVariables, true>);
  const isProd = configService.get('NODE_ENV', { infer: true }) === 'production';

  // CORS: in production restrict to the configured origins; in dev reflect any
  // (Expo dev client / localhost). Comma-separated CORS_ORIGINS env var.
  const corsOrigins = (configService.get('CORS_ORIGINS', { infer: true }) ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  let corsOrigin: boolean | string[] = true;
  if (isProd) corsOrigin = corsOrigins.length > 0 ? corsOrigins : false;
  app.enableCors({ origin: corsOrigin, credentials: true });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  app.setGlobalPrefix('api', { exclude: ['health'] });

  // Swagger only outside production — never expose the API schema publicly.
  if (!isProd) {
    const config = new DocumentBuilder()
      .setTitle('Yaqin Market API')
      .setDescription('Marketplace + sklad backend')
      .setVersion('0.1.0')
      .addBearerAuth()
      .build();
    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('docs', app, document, {
      swaggerOptions: { persistAuthorization: true },
    });
  }

  const port = configService.get('PORT', { infer: true });
  await app.listen(port, '0.0.0.0');

  // eslint-disable-next-line no-console
  console.log(`🚀 Yaqin Market API running on http://0.0.0.0:${port}`);
  if (!isProd) {
    // eslint-disable-next-line no-console
    console.log(`📖 Swagger docs at http://0.0.0.0:${port}/docs`);
  }
}
bootstrap();
