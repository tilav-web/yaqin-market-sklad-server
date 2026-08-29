import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { AdminUser } from '../../admin-users/entities/admin-user.entity';

export interface AdminJwtPayload {
  sub: string;
  username: string;
  role: string;
  tokenType: 'admin_access' | 'admin_refresh';
}

export const CurrentAdmin = createParamDecorator(
  (data: keyof AdminUser | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    const admin = request.user as AdminUser;
    return data ? admin?.[data] : admin;
  },
);
