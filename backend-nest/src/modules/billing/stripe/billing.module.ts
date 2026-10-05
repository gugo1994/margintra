import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  BillingSubscriptionEntity,
  CustomerEntity,
  OrganizationEntity,
  StripeConnectionEntity,
  StripeWebhookEventEntity,
} from '../../../database/entities';
import { MarginModule } from '../../margin/margin.module';
import { StripeController } from './controllers/stripe.controller';
import { StripeWebhookController } from './controllers/stripe-webhook.controller';
import { OfficialStripeGateway } from './gateways/stripe.gateway';
import { ENCRYPTION_SERVICE } from './interfaces/encryption.interface';
import { STRIPE_GATEWAY } from './interfaces/stripe-gateway.interface';
import { StripeRepository } from './repositories/stripe.repository';
import { AesGcmEncryptionService } from './services/aes-gcm-encryption.service';
import { StripeConnectionService } from './services/stripe-connection.service';
import { StripeSyncService } from './services/stripe-sync.service';
import { StripeWebhookService } from './services/stripe-webhook.service';
import { StripeWebhookRetryService } from './services/stripe-webhook-retry.service';
import { RevenueHistoryModule } from '../../revenue-history/revenue-history.module';
import { GuardrailHistoryModule } from '../../guardrail-history/guardrail-history.module';
@Module({
  imports: [
    TypeOrmModule.forFeature([
      BillingSubscriptionEntity,
      CustomerEntity,
      OrganizationEntity,
      StripeConnectionEntity,
      StripeWebhookEventEntity,
    ]),
    MarginModule,
    RevenueHistoryModule,
    GuardrailHistoryModule,
  ],
  controllers: [StripeController, StripeWebhookController],
  providers: [
    StripeRepository,
    StripeConnectionService,
    StripeSyncService,
    StripeWebhookService,
    StripeWebhookRetryService,
    { provide: STRIPE_GATEWAY, useClass: OfficialStripeGateway },
    { provide: ENCRYPTION_SERVICE, useClass: AesGcmEncryptionService },
  ],
  exports: [StripeSyncService, StripeWebhookRetryService],
})
export class BillingModule {}
