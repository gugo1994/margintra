import { Inject, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { StripeConnectionStatus } from '../../../../common/enums/domain.enums';
import {
  ApplicationError,
  ConflictError,
  ValidationError,
} from '../../../../common/errors/application.error';
import { ConnectStripeDto } from '../dto/stripe.dto';
import { ENCRYPTION_SERVICE, IEncryptionService } from '../interfaces/encryption.interface';
import { IStripeGateway, STRIPE_GATEWAY } from '../interfaces/stripe-gateway.interface';
import { StripeRepository } from '../repositories/stripe.repository';
import { StripeOperationError } from '../gateways/stripe.gateway';
@Injectable()
export class StripeConnectionService {
  private readonly logger = new Logger(StripeConnectionService.name);
  constructor(
    private readonly repository: StripeRepository,
    @Inject(STRIPE_GATEWAY) private readonly gateway: IStripeGateway,
    @Inject(ENCRYPTION_SERVICE) private readonly encryption: IEncryptionService,
  ) {}
  async get(org: string) {
    return this.map(await this.repository.connection(org));
  }
  async connect(org: string, dto: ConnectStripeDto) {
    const key = dto.secretKey.trim();
    const verified = await this.verifyCredential(org, key);
    return this.repository.transaction(async (manager) => {
      await manager.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`B${org}`]);
      let connection = await this.repository.connection(org, manager);
      if (connection?.stripeAccountId && connection.stripeAccountId !== verified.accountId)
        throw new ConflictError(
          'This organization already contains revenue history from another Stripe account.',
        );
      const now = new Date();
      if (!connection)
        connection = this.repository.createConnection(
          { organizationId: org, publicIdentifier: randomUUID(), createdAt: now },
          manager,
        );
      Object.assign(connection, {
        stripeAccountId: verified.accountId,
        liveMode: verified.liveMode,
        encryptedSecretKey: await this.encryption.encrypt(key),
        encryptedWebhookSecret: dto.webhookSecret
          ? await this.encryption.encrypt(dto.webhookSecret.trim())
          : connection.encryptedWebhookSecret,
        status: StripeConnectionStatus.Connected,
        activeSyncAttemptToken: null,
        lastError: null,
        updatedAt: now,
      });
      await this.repository.save(connection, manager);
      this.logger.log({
        event: 'StripeConnected',
        organizationId: org,
        stripeAccountId: verified.accountId,
        liveMode: verified.liveMode,
      });
      return this.map(connection);
    });
  }
  async updateWebhookSecret(org: string, value: string) {
    if (!value.trim().startsWith('whsec_'))
      throw new ValidationError('A webhook signing secret beginning with whsec_ is required.');
    return this.repository.transaction(async (manager) => {
      await manager.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`B${org}`]);
      const connection = await this.repository.connection(org, manager);
      if (!connection?.encryptedSecretKey)
        throw new ConflictError('Connect Stripe before configuring its webhook signing secret.');
      connection.encryptedWebhookSecret = await this.encryption.encrypt(value.trim());
      connection.updatedAt = new Date();
      await this.repository.save(connection, manager);
      return this.map(connection);
    });
  }
  async disconnect(org: string) {
    await this.repository.transaction(async (manager) => {
      await manager.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`B${org}`]);
      const connection = await this.repository.connection(org, manager);
      if (!connection) return;
      Object.assign(connection, {
        encryptedSecretKey: null,
        encryptedWebhookSecret: null,
        status: StripeConnectionStatus.NotConnected,
        activeSyncAttemptToken: null,
        updatedAt: new Date(),
      });
      await this.repository.save(connection, manager);
      const customers = await this.repository.stripeCustomers(org, manager);
      for (const customer of customers) customer.revenueStale = true;
      await manager.save(customers);
    });
  }
  private async verifyCredential(org: string, key: string) {
    try {
      return await this.gateway.verify(key);
    } catch (error) {
      this.logger.warn({
        event: 'StripeCredentialRejected',
        organizationId: org,
        errorType: error instanceof Error ? error.name : 'unknown',
      });
      if (error instanceof StripeOperationError) {
        const missingPermission = this.missingPermission(error);
        if (missingPermission)
          throw new ApplicationError(
            400,
            'Validation failed',
            `This Stripe key is missing a required permission: ${missingPermission} Read.`,
            `STRIPE_PERMISSION_MISSING_${missingPermission.toUpperCase()}`,
          );
        throw new ValidationError(this.safeCredentialError(error));
      }
      throw new ValidationError('We could not verify the Stripe credential right now.');
    }
  }
  private missingPermission(error: StripeOperationError) {
    const code = error.stripeError.code?.toLowerCase() ?? '';
    const message = error.stripeError.message.toLowerCase();
    if (code !== 'permission_missing' && !message.includes('permission')) return null;
    const operationResources: Record<string, string> = {
      'retrieving account': 'Account',
      'listing customers': 'Customers',
      'listing subscriptions': 'Subscriptions',
      'listing prices': 'Prices',
      'listing products': 'Products',
    };
    return operationResources[error.operation] ?? null;
  }
  private safeCredentialError(error: StripeOperationError) {
    const stripeError = error.stripeError;
    const type = stripeError.type.toLowerCase();
    const code = stripeError.code?.toLowerCase() ?? '';
    const message = stripeError.message.toLowerCase();
    if (type === 'authentication_error' || /invalid api key|expired api key/.test(message))
      return 'Stripe could not authenticate this restricted key.';
    if (code === 'permission_missing' || message.includes('permission')) {
      return 'This Stripe key is missing required Read permissions. Check Customers, Subscriptions, Prices, and Products.';
    }
    if (type === 'api_connection_error' || type === 'rate_limit_error' || type === 'api_error')
      return 'Stripe is temporarily unavailable. Please try again.';
    return 'We could not verify the Stripe credential right now.';
  }
  private map(x: import('../../../../database/entities').StripeConnectionEntity | null) {
    return x
      ? {
          connected:
            x.encryptedSecretKey !== null && x.status !== StripeConnectionStatus.NotConnected,
          accountId: x.stripeAccountId,
          liveMode: x.liveMode,
          status:
            x.status === StripeConnectionStatus.NotConnected
              ? 'notConnected'
              : x.status === StripeConnectionStatus.Connected
                ? 'connected'
                : x.status === StripeConnectionStatus.Syncing
                  ? 'syncing'
                  : 'error',
          lastSyncAt: x.lastSyncAt?.toISOString() ?? null,
          lastSuccessfulSyncAt: x.lastSuccessfulSyncAt?.toISOString() ?? null,
          lastError: x.lastError,
          webhookConfigured: x.encryptedWebhookSecret !== null,
          webhookPath: x.encryptedWebhookSecret
            ? `/api/v1/webhooks/stripe/${x.publicIdentifier}`
            : null,
        }
      : {
          connected: false,
          accountId: null,
          liveMode: false,
          status: 'notConnected',
          lastSyncAt: null,
          lastSuccessfulSyncAt: null,
          lastError: null,
          webhookConfigured: false,
          webhookPath: null,
        };
  }
}
