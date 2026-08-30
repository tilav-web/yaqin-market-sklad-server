import { ExecutionContext, createParamDecorator } from '@nestjs/common';
import { Request } from 'express';

/**
 * Reads the client-generated install identifier from `X-Device-Id`. A header,
 * not a DTO field, because it applies to every mutation and the global
 * `ValidationPipe` (forbidNonWhitelisted: true) would 400 on an unlisted body
 * field per-DTO. Never validated against a format — it's a correlation id,
 * not a secret, and older app builds may not send it at all.
 */
export const DeviceId = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string | null => {
    const request = ctx.switchToHttp().getRequest<Request>();
    const header = request.headers['x-device-id'];
    const value = Array.isArray(header) ? header[0] : header;
    return typeof value === 'string' && value.length > 0 ? value : null;
  },
);
