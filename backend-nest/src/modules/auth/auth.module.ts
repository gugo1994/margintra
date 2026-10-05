import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OrganizationEntity, OrganizationMemberEntity, UserEntity } from '../../database/entities';
import { AuthController } from './controllers/auth.controller';
import { AuthRepository } from './repositories/auth.repository';
import { AuthService } from './services/auth.service';
import { JwtStrategy } from './strategies/jwt.strategy';
import { GuardrailHistoryModule } from '../guardrail-history/guardrail-history.module';
@Module({
  imports: [
    TypeOrmModule.forFeature([UserEntity, OrganizationEntity, OrganizationMemberEntity]),
    GuardrailHistoryModule,
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('auth.secret'),
        signOptions: {
          issuer: config.getOrThrow<string>('auth.issuer'),
          audience: config.getOrThrow<string>('auth.audience'),
          expiresIn: config.getOrThrow<number>('auth.expiresInSeconds'),
        },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthRepository, AuthService, JwtStrategy],
  exports: [AuthRepository],
})
export class AuthModule {}
