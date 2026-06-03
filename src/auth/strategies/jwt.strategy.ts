import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';

import type { EnvironmentVariables } from '../../config/configuration';
import { UsersService } from '../../users/users.service';
import type { JwtPayload } from '../decorators/current-user.decorator';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    config: ConfigService<EnvironmentVariables, true>,
    private readonly users: UsersService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get('JWT_SECRET', { infer: true }),
    });
  }

  async validate(payload: JwtPayload): Promise<JwtPayload> {
    const user = await this.users.findById(payload.sub);
    if (!user || user.status === 'blocked') {
      throw new UnauthorizedException('Foydalanuvchi topilmadi yoki bloklangan');
    }
    // Use the CURRENT roles from the DB (not the token) so a revoked admin /
    // staff loses access immediately rather than until the token expires.
    return { sub: user.id, phone: user.phone, roles: (user.roles ?? []) as JwtPayload['roles'] };
  }
}
