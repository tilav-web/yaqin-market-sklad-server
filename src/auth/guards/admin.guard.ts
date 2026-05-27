import { CanActivate, ExecutionContext, ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { Request } from 'express';

import { UsersService } from '../../users/users.service';
import type { JwtPayload } from '../decorators/current-user.decorator';

@Injectable()
export class AdminGuard implements CanActivate {
  constructor(@Inject(UsersService) private readonly users: UsersService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request & { user?: JwtPayload }>();
    if (!req.user) throw new ForbiddenException();
    const u = await this.users.findById(req.user.sub);
    if (!u || !u.isAdmin) throw new ForbiddenException('Admin huquqi kerak');
    return true;
  }
}
