import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EmailConfiguration } from '../../config/configuration';
import { DevelopmentEmailGateway } from './development-email.gateway';
import { EMAIL_GATEWAY } from './email.gateway';
import { NotificationController } from './notification.controller';
import { NotificationService } from './notification.service';
import { EmailGateway } from './email.gateway';
import { ResendEmailGateway } from './resend-email.gateway';

export const selectEmailGateway = (
  config: ConfigService,
  development: DevelopmentEmailGateway,
  resend: ResendEmailGateway,
): EmailGateway =>
  config.getOrThrow<EmailConfiguration>('email').provider === 'resend' ? resend : development;
@Module({
  controllers: [NotificationController],
  providers: [
    NotificationService,
    DevelopmentEmailGateway,
    ResendEmailGateway,
    {
      provide: EMAIL_GATEWAY,
      inject: [ConfigService, DevelopmentEmailGateway, ResendEmailGateway],
      useFactory: selectEmailGateway,
    },
  ],
  exports: [NotificationService, EMAIL_GATEWAY],
})
export class NotificationModule {}
