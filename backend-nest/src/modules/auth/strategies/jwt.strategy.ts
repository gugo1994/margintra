import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { UnauthorizedError } from '../../../common/errors/application.error';
import { TenantContext } from '../../../common/interfaces/tenant-context.interface';
import { AuthRepository } from '../repositories/auth.repository';
interface JwtPayload {
  sub: string;
  email: string;
  org_id: string;
}
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService,
    private readonly repository: AuthRepository,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: config.getOrThrow<string>('auth.secret'),
      issuer: config.getOrThrow<string>('auth.issuer'),
      audience: config.getOrThrow<string>('auth.audience'),
    });
  }
  async validate(payload: JwtPayload): Promise<TenantContext> {
    if (!(await this.repository.membershipExists(payload.sub, payload.org_id)))
      throw new UnauthorizedError('The organization membership is no longer valid.');
    return { userId: payload.sub, organizationId: payload.org_id, email: payload.email };
  }
}
