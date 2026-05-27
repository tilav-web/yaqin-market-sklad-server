import { SetMetadata } from '@nestjs/common';

import { Role } from '../role.enum';

export const ROLES_KEY = 'roles';
/**
 * Restricts a controller/handler to users that hold AT LEAST ONE of the listed roles.
 *
 * Use together with {@link RolesGuard}. If the decorator is absent the route is open
 * to any authenticated user (still passes through {@link JwtAuthGuard}).
 *
 * @example
 *   `@Roles(Role.Admin)`           — admin-only
 *   `@Roles(Role.Seller, Role.Staff)` — either seller or staff
 */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);
