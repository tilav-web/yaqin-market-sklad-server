import { ExecutionContext, createParamDecorator } from '@nestjs/common';
import { Request } from 'express';

import { Role } from '../role.enum';

export interface JwtPayload {
  sub: string;
  phone: string;
  roles: Role[];
}

export const CurrentUser = createParamDecorator(
  (
    data: keyof JwtPayload | undefined,
    ctx: ExecutionContext,
  ): JwtPayload | JwtPayload[keyof JwtPayload] | undefined => {
    const request = ctx.switchToHttp().getRequest<Request & { user?: JwtPayload }>();
    const user = request.user;
    if (!user) return undefined;
    return data ? user[data] : user;
  },
);
