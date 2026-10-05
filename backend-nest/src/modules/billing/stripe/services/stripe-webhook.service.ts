import { Inject, Injectable, Logger } from '@nestjs/common';
import { WebhookProcessingStatus } from '../../../../common/enums/domain.enums';
import { ApplicationError } from '../../../../common/errors/application.error';
import { STRIPE_SYNC_EVENTS } from '../constants/stripe.constants';
import { ENCRYPTION_SERVICE, IEncryptionService } from '../interfaces/encryption.interface';
import {
  IStripeGateway,
  STRIPE_GATEWAY,
  VerifiedStripeEvent,
} from '../interfaces/stripe-gateway.interface';
import { StripeRepository } from '../repositories/stripe.repository';
import { StripeSyncService } from './stripe-sync.service';
import { StripeSyncInProgressError } from './stripe-sync.service';
import { StripeWebhookRetryService } from './stripe-webhook-retry.service';
@Injectable()
export class StripeWebhookService {
  private readonly logger = new Logger(StripeWebhookService.name);
  constructor(
    private readonly repository: StripeRepository,
    private readonly sync: StripeSyncService,
    @Inject(STRIPE_GATEWAY) private readonly gateway: IStripeGateway,
    @Inject(ENCRYPTION_SERVICE) private readonly encryption: IEncryptionService,
    private readonly retries: StripeWebhookRetryService,
  ) {}
  async handle(connectionIdentifier: string, payload: Buffer, signature: string) {
    const connection = await this.repository.connectionByPublicId(connectionIdentifier);
    if (!connection?.encryptedWebhookSecret)
      throw new ApplicationError(
        400,
        'Invalid Stripe webhook',
        'The webhook endpoint is not configured.',
      );
    let event: VerifiedStripeEvent;
    try {
      event = this.gateway.verifyWebhook(
        payload,
        signature,
        await this.encryption.decrypt(connection.encryptedWebhookSecret),
      );
    } catch {
      this.logger.warn({ event: 'StripeWebhookRejected', connectionId: connection.id });
      throw new ApplicationError(
        400,
        'Invalid Stripe webhook',
        'Stripe signature verification failed.',
      );
    }
    const reservation = await this.reserve(connection.id, connection.organizationId, event);
    if (reservation.duplicate) return { duplicate: true, status: 'duplicate' };
    if (!STRIPE_SYNC_EVENTS.has(event.type)) {
      await this.complete(reservation.id, connection.organizationId);
      return { duplicate: false, status: 'ignored' };
    }
    try {
      await this.sync.sync(connection.organizationId, reservation.id);
      return { duplicate: false, status: 'processed' };
    } catch (error) {
      if (error instanceof StripeSyncInProgressError) {
        await this.retries.schedule(reservation.id, connection.organizationId);
        return { duplicate: false, status: 'retry_scheduled' };
      }
      await this.retries.failPermanently(reservation.id, connection.organizationId);
      throw error;
    }
  }
  private reserve(connectionId: string, org: string, event: VerifiedStripeEvent) {
    return this.repository.transaction(async (manager) => {
      await manager.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
        `W${connectionId}${event.id}`,
      ]);
      let row = await this.repository.webhook(connectionId, event.id, manager);
      if (
        row &&
        (row.processingStatus === WebhookProcessingStatus.Processed ||
          (row.processingStatus === WebhookProcessingStatus.Processing &&
            row.receivedAt > new Date(Date.now() - 300_000)))
      )
        return { id: row.id, duplicate: true };
      if (!row)
        row = this.repository.createWebhook(
          {
            organizationId: org,
            stripeConnectionId: connectionId,
            stripeEventId: event.id,
            eventType: event.type,
            receivedAt: new Date(),
            processedAt: null,
            error: null,
            retryable: false,
            attemptCount: 0,
            nextAttemptAt: null,
            claimedAt: new Date(),
          },
          manager,
        );
      else
        Object.assign(row, {
          processingStatus: WebhookProcessingStatus.Processing,
          receivedAt: new Date(),
          error: null,
          claimedAt: new Date(),
        });
      await manager.save(row);
      return { id: row.id, duplicate: false };
    });
  }
  private async complete(id: string, org: string) {
    await this.repository.transaction(async (manager) => {
      const connection = await this.repository.connection(org, manager);
      if (!connection) return;
      const row = await manager.findOneByOrFail(
        (await import('../../../../database/entities')).StripeWebhookEventEntity,
        { id, organizationId: org },
      );
      Object.assign(row, {
        processingStatus: WebhookProcessingStatus.Processed,
        processedAt: new Date(),
        error: null,
        retryable: false,
        nextAttemptAt: null,
        claimedAt: null,
      });
      await manager.save(row);
    });
  }
}
