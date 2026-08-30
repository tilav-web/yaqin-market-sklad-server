import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Redis } from 'ioredis';

import { AppModule } from './app.module';
import { EnvironmentVariables } from './config/configuration';
import { RedisIoAdapter } from './realtime/redis-io.adapter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  const configService = app.get(ConfigService<EnvironmentVariables, true>);
  const isProd =
    configService.get('NODE_ENV', { infer: true }) === 'production';

  // Prod sits behind exactly one reverse-proxy hop (Nginx, per DEPLOY.md).
  // Without this, Express's req.ip is always Nginx's own address, so every
  // IP-keyed rate limit (global ThrottlerGuard, the contact-form limiter)
  // collapses into a single shared counter across every real visitor. Only
  // trust it in prod — locally there's no proxy, so trusting X-Forwarded-For
  // would let a direct client simply lie about its own IP.
  if (isProd) app.getHttpAdapter().getInstance().set('trust proxy', 1);

  // Socket.IO over Redis pub/sub, so realtime events (order/chat) reach
  // connected clients no matter which server process their socket landed on.
  const redisIoAdapter = new RedisIoAdapter(app);
  const pubClient = new Redis({
    host: configService.get('REDIS_HOST', { infer: true }),
    port: configService.get('REDIS_PORT', { infer: true }),
  });
  const subClient = pubClient.duplicate();
  // ioredis throws (crashing the process) on an unhandled 'error' event —
  // a Redis blip must not take the whole API down with it.
  for (const client of [pubClient, subClient]) {
    client.on('error', (err) => {
      console.error(`Redis (socket.io adapter) error: ${err.message}`);
    });
  }
  redisIoAdapter.connectToRedis(pubClient, subClient);
  app.useWebSocketAdapter(redisIoAdapter);

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

  console.log(`🚀 Yaqin Market API running on http://0.0.0.0:${port}`);
  if (!isProd) {
    console.log(`📖 Swagger docs at http://0.0.0.0:${port}/docs`);
  }
}
bootstrap();
