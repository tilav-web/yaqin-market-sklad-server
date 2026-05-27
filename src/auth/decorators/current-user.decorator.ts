import { ExecutionContext, createParamDecorator } from '@nestjs/common';
import { Request } from 'express';

export interface JwtPayload {
  sub: string;
  phone: string;
}

export const CurrentUser = createParamDecorator(
  (data: keyof JwtPayload | undefined, ctx: ExecutionContext): JwtPayload | string | undefined => {
    const request = ctx.switchToHttp().getRequest<Request & { user?: JwtPayload }>();
    const user = request.user;
    if (!user) return undefined;
    return data ? user[data] : user;
  },
);
