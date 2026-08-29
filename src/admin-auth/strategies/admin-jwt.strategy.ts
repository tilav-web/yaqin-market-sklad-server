import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';

import { AdminUsersService } from '../../admin-users/admin-users.service';
import { AdminUser } from '../../admin-users/entities/admin-user.entity';
import type { EnvironmentVariables } from '../../config/configuration';
import type { AdminJwtPayload } from '../decorators/current-admin.decorator';

@Injectable()
export class AdminJwtStrategy extends PassportStrategy(Strategy, 'admin-jwt') {
  constructor(
    config: ConfigService<EnvironmentVariables, true>,
    private readonly adminUsers: AdminUsersService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get('JWT_SECRET', { infer: true }),
    });
  }

  async validate(payload: AdminJwtPayload): Promise<AdminUser> {
    if (payload.tokenType !== 'admin_access') {
      throw new UnauthorizedException('Yaroqsiz admin token');
    }

    const admin = await this.adminUsers.findById(payload.sub).catch(() => null);
    if (!admin || !admin.isActive) {
      throw new UnauthorizedException('Xodim hisobi topilmadi yoki nofaol qilingan');
    }

    return admin;
  }
}
