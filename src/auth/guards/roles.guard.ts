import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';

import { ADMIN_ROLES_KEY } from '../../admin-auth/decorators/admin-roles.decorator';
import { AdminRole, AdminUser } from '../../admin-users/entities/admin-user.entity';
import type { JwtPayload } from '../decorators/current-user.decorator';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { Role } from '../role.enum';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    const requiredAdminRoles = this.reflector.getAllAndOverride<AdminRole[] | undefined>(ADMIN_ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (
      (!requiredRoles || requiredRoles.length === 0) &&
      (!requiredAdminRoles || requiredAdminRoles.length === 0)
    ) {
      return true;
    }

    const req = context.switchToHttp().getRequest<Request & { user?: JwtPayload | AdminUser }>();
    const user = req.user;

    if (!user) return false;

    // Check if authenticated actor is an AdminUser
    const maybeAdmin = user as unknown as AdminUser;
    if (user instanceof AdminUser || ('role' in user && Object.values(AdminRole).includes(maybeAdmin.role))) {
      const adminRole = maybeAdmin.role;

      // SuperAdmin has full access to all admin routes
      if (adminRole === AdminRole.SuperAdmin) {
        return true;
      }

      // If route requires specific AdminRole(s)
      if (requiredAdminRoles && requiredAdminRoles.length > 0) {
        if (!requiredAdminRoles.includes(adminRole)) {
          throw new ForbiddenException(`Ushbu amal uchun ruxsat berilmagan. Kerakli rol: ${requiredAdminRoles.join(', ')}`);
        }
        return true;
      }

      // If route required generic Role.Admin, any authenticated active AdminUser passes
      if (requiredRoles && requiredRoles.includes(Role.Admin)) {
        return true;
      }

      return false;
    }

    // Otherwise, user is a normal customer/seller/courier
    if (requiredAdminRoles && requiredAdminRoles.length > 0) {
      throw new ForbiddenException('Bu amal faqat platforma xodimlari uchun');
    }

    const userRoles = ((user as JwtPayload).roles ?? []) as Role[];
    if (requiredRoles && requiredRoles.length > 0) {
      if (!userRoles.some((r) => requiredRoles.includes(r))) {
        throw new ForbiddenException(`Bu amal uchun rollar kerak: ${requiredRoles.join(', ')}`);
      }
    }

    return true;
  }
}
