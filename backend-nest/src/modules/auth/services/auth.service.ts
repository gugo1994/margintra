import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { ConflictError, UnauthorizedError } from '../../../common/errors/application.error';
import { AuthRepository } from '../repositories/auth.repository';
import { AuthResponseDto, LoginDto, RegisterDto } from '../dto/auth.dto';
@Injectable()
export class AuthService {
  constructor(
    private readonly repository: AuthRepository,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}
  async register(dto: RegisterDto) {
    const email = dto.email.trim().toLowerCase();
    if (await this.repository.findUserByEmail(email))
      throw new ConflictError('An account with this email already exists.');
    const passwordHash = await bcrypt.hash(dto.password, 12);
    const { user, organization } = await this.repository.register(
      email,
      passwordHash,
      dto.organizationName.trim(),
    );
    return this.issue(user.id, organization.id, email);
  }
  async login(dto: LoginDto) {
    const user = await this.repository.findUserByEmail(dto.email.trim().toLowerCase());
    if (!user || !(await bcrypt.compare(dto.password, user.passwordHash)))
      throw new UnauthorizedError('Email or password is incorrect.');
    const membership = await this.findMembership(user.id);
    return this.issue(user.id, membership.organizationId, user.email);
  }
  private async findMembership(userId: string) {
    const row = await this.repository.findFirstMembership(userId);
    if (!row) throw new UnauthorizedError('Email or password is incorrect.');
    return row;
  }
  private async issue(
    userId: string,
    organizationId: string,
    email: string,
  ): Promise<AuthResponseDto> {
    const seconds = this.config.getOrThrow<number>('auth.expiresInSeconds');
    const expiresAt = new Date(Date.now() + seconds * 1000);
    const accessToken = await this.jwt.signAsync({ sub: userId, email, org_id: organizationId });
    return { accessToken, expiresAt: expiresAt.toISOString(), userId, organizationId, email };
  }
}
