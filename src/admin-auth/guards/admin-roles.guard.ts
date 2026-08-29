import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AdminRole, AdminUser } from '../../admin-users/entities/admin-user.entity';
import { ADMIN_ROLES_KEY } from '../decorators/admin-roles.decorator';

@Injectable()
export class AdminRolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<AdminRole[]>(ADMIN_ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const admin = request.user as AdminUser | undefined;

    if (!admin || !admin.role) {
      return false;
    }

    // SuperAdmin has full access everywhere
    if (admin.role === AdminRole.SuperAdmin) {
      return true;
    }

    return requiredRoles.includes(admin.role);
  }
}
