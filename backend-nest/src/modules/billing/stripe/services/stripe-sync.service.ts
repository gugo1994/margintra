import { Inject, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import Decimal from 'decimal.js';
import {
  BillingProvider,
  RevenueSource,
  StripeConnectionStatus,
  StripeCustomerStatus,
  WebhookProcessingStatus,
} from '../../../../common/enums/domain.enums';
import { ApplicationError, ConflictError } from '../../../../common/errors/application.error';
import { decimalString } from '../../../../common/helpers/decimal-response.helper';
import { CustomerEntity, StripeWebhookEventEntity } from '../../../../database/entities';
import { MarginService } from '../../../margin/services/margin.service';
import { ENCRYPTION_SERVICE, IEncryptionService } from '../interfaces/encryption.interface';
import {
  IStripeGateway,
  STRIPE_GATEWAY,
  StripeAccountState,
} from '../interfaces/stripe-gateway.interface';
import { StripeRepository } from '../repositories/stripe.repository';
import { StripeOperationError } from '../gateways/stripe.gateway';
import { RevenueHistoryService } from '../../../revenue-history/revenue-history.service';
import { GuardrailHistoryService } from '../../../guardrail-history/guardrail-history.service';

export class StripeSyncInProgressError extends ConflictError {
  constructor() {
    super('Wait for the active synchronization to finish.');
  }
}
@Injectable()
export class StripeSyncService {
  private readonly logger = new Logger(StripeSyncService.name);
  constructor(
    private readonly repository: StripeRepository,
    private readonly margins: MarginService,
    @Inject(STRIPE_GATEWAY) private readonly gateway: IStripeGateway,
    @Inject(ENCRYPTION_SERVICE) private readonly encryption: IEncryptionService,
    private readonly revenueHistory: RevenueHistoryService,
    private readonly guardrailHistory: GuardrailHistoryService,
  ) {}
  async sync(org: string, webhookEventId?: string) {
    const claim = await this.claim(org);
    let state: StripeAccountState;
    try {
      state = await this.gateway.fetch(claim.secretKey, claim.reportingCurrency);
    } catch (error) {
      await this.failed(org, claim.attemptToken, this.safeError(error));
      this.logFailure(org, error);
      throw new ApplicationError(502, 'Stripe synchronization failed', this.safeError(error));
    }
    return this.apply(org, claim.connectionId, claim.attemptToken, state, webhookEventId);
  }
  private async claim(org: string) {
    return this.repository.transaction(async (manager) => {
      await manager.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`B${org}`]);
      const connection = await this.repository.connection(org, manager);
      if (
        !connection?.encryptedSecretKey ||
        connection.status === StripeConnectionStatus.NotConnected
      )
        throw new ConflictError('Connect Stripe before synchronizing.');
      if (
        connection.status === StripeConnectionStatus.Syncing &&
        connection.lastSyncAt &&
        connection.lastSyncAt > new Date(Date.now() - 300_000)
      )
        throw new StripeSyncInProgressError();
      const organization = await this.repository.organization(org, manager);
      const attemptToken = randomUUID();
      connection.status = StripeConnectionStatus.Syncing;
      connection.activeSyncAttemptToken = attemptToken;
      connection.lastSyncAt = new Date();
      connection.lastError = null;
      connection.updatedAt = new Date();
      await this.repository.save(connection, manager);
      return {
        connectionId: connection.id,
        attemptToken,
        secretKey: await this.encryption.decrypt(connection.encryptedSecretKey),
        reportingCurrency: organization.reportingCurrency,
      };
    });
  }
  private async apply(
    org: string,
    connectionId: string,
    attemptToken: string,
    state: StripeAccountState,
    webhookEventId?: string,
  ) {
    return this.repository.transaction(async (manager) => {
      await manager.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`B${org}`]);
      const connection = await this.repository.connection(org, manager);
      if (
        !connection ||
        connection.id !== connectionId ||
        connection.activeSyncAttemptToken !== attemptToken
      )
        throw new ConflictError('This Stripe synchronization attempt was replaced.');
      if (connection.stripeAccountId !== state.account.accountId)
        throw new ConflictError('The Stripe credential belongs to a different account.');
      const reportingCurrency = (await this.repository.organization(org, manager))
        .reportingCurrency;
      const existing = await this.repository.stripeCustomers(org, manager);
      const byStripe = new Map(
        existing.filter((x) => x.stripeCustomerId).map((x) => [x.stripeCustomerId!, x]),
      );
      const incomingIds = new Set(state.customers.filter((x) => !x.deleted).map((x) => x.id));
      const touched = new Map<string, CustomerEntity>();
      const now = new Date();
      for (const remote of state.customers.filter((x) => !x.deleted)) {
        let customer = byStripe.get(remote.id);
        if (!customer) {
          customer = this.repository.createCustomer(
            {
              organizationId: org,
              externalCustomerId: `stripe:${remote.id}`,
              stripeCustomerId: remote.id,
              monthlyRevenue: '0',
              manualMonthlyRevenue: '0',
              revenueSource: RevenueSource.Stripe,
              currency: 'USD',
              targetGrossMarginOverride: null,
              budgetWarningThresholdOverride: null,
              budgetCriticalThresholdOverride: null,
              createdAt: now,
            },
            manager,
          );
          byStripe.set(remote.id, customer);
        }
        Object.assign(customer, {
          name: this.safeName(remote),
          email: this.safeEmail(remote.email),
          stripeCustomerStatus: StripeCustomerStatus.Active,
          revenueStale: false,
          revenueUpdatedAt: now,
          updatedAt: now,
        });
        touched.set(remote.id, customer);
      }
      for (const customer of existing) {
        if (!customer.stripeCustomerId) continue;
        if (!incomingIds.has(customer.stripeCustomerId))
          customer.stripeCustomerStatus = StripeCustomerStatus.Deleted;
        touched.set(customer.stripeCustomerId, customer);
      }
      await manager.save([...touched.values()]);
      for (const customer of touched.values())
        await this.guardrailHistory.recordCustomer(customer, customer.createdAt, manager);
      const customerIds = [...touched.values()].map((customer) => customer.id).sort();
      if (customerIds.length > 0)
        await manager.query(
          `SELECT pg_advisory_xact_lock(hashtextextended('C'||$1||id::text,0))
           FROM unnest($2::uuid[]) AS id ORDER BY id`,
          [org, customerIds],
        );
      const subscriptions = await this.repository.subscriptions(org, manager);
      const bySubscription = new Map(subscriptions.map((x) => [x.externalSubscriptionId, x]));
      const incomingSubscriptions = new Set(state.subscriptions.map((x) => x.id));
      for (const remote of state.subscriptions) {
        const customer = touched.get(remote.customerId);
        if (!customer) continue;
        let subscription = bySubscription.get(remote.id);
        if (!subscription) {
          subscription = this.repository.createSubscription(
            {
              organizationId: org,
              customerId: customer.id,
              provider: BillingProvider.Stripe,
              externalSubscriptionId: remote.id,
              externalCustomerId: remote.customerId,
              createdAt: now,
            },
            manager,
          );
          bySubscription.set(remote.id, subscription);
        }
        Object.assign(subscription, {
          customerId: customer.id,
          name: remote.name.slice(0, 200),
          status: remote.status.slice(0, 40),
          currency: remote.currency.toUpperCase(),
          currentPeriodStart: remote.currentPeriodStart,
          currentPeriodEnd: remote.currentPeriodEnd,
          cancelAtPeriodEnd: remote.cancelAtPeriodEnd,
          monthlyRecurringRevenue: remote.monthlyRecurringRevenue,
          warning: remote.warning?.slice(0, 1000) ?? null,
          updatedAt: now,
        });
      }
      for (const subscription of bySubscription.values()) {
        const customer = touched.get(subscription.externalCustomerId);
        if (
          !incomingSubscriptions.has(subscription.externalSubscriptionId) ||
          customer?.stripeCustomerStatus === StripeCustomerStatus.Deleted
        ) {
          subscription.status =
            customer?.stripeCustomerStatus === StripeCustomerStatus.Deleted
              ? 'canceled'
              : 'missing';
          subscription.monthlyRecurringRevenue = '0';
          subscription.warning =
            customer?.stripeCustomerStatus === StripeCustomerStatus.Deleted
              ? 'Stripe customer was deleted; historical subscription data was preserved.'
              : 'Subscription was not returned by the latest Stripe full sync.';
          subscription.updatedAt = now;
        }
      }
      await manager.save([...bySubscription.values()]);
      const revenueByCustomer = new Map<string, Decimal>();
      for (const subscription of bySubscription.values())
        revenueByCustomer.set(
          subscription.customerId,
          (revenueByCustomer.get(subscription.customerId) ?? new Decimal(0)).plus(
            subscription.monthlyRecurringRevenue,
          ),
        );
      for (const [stripeId, customer] of touched) {
        const revenue = revenueByCustomer.get(customer.id) ?? new Decimal(0);
        Object.assign(customer, {
          monthlyRevenue: decimalString(revenue, 2),
          revenueSource: RevenueSource.Stripe,
          currency: reportingCurrency,
          revenueStale: false,
          revenueUpdatedAt: now,
          updatedAt: now,
        });
        if (!incomingIds.has(stripeId))
          customer.stripeCustomerStatus = StripeCustomerStatus.Deleted;
        await manager.save(customer);
        await this.revenueHistory.recordIfChanged(
          org,
          customer.id,
          customer.monthlyRevenue,
          customer.currency,
          now,
          manager,
        );
        await this.margins.recalculate(org, customer.id, manager);
      }
      connection.status = StripeConnectionStatus.Connected;
      connection.activeSyncAttemptToken = null;
      connection.lastSuccessfulSyncAt = now;
      connection.lastError = null;
      connection.updatedAt = now;
      await manager.save(connection);
      if (webhookEventId) {
        const webhook = await manager.findOneByOrFail(StripeWebhookEventEntity, {
          id: webhookEventId,
          organizationId: org,
        });
        webhook.processingStatus = WebhookProcessingStatus.Processed;
        webhook.processedAt = now;
        webhook.error = null;
        webhook.retryable = false;
        webhook.nextAttemptAt = null;
        webhook.claimedAt = null;
        await manager.save(webhook);
      }
      return {
        customers: touched.size,
        subscriptions: state.subscriptions.length,
        warnings: state.subscriptions.filter((x) => x.warning).length,
        completedAt: now.toISOString(),
      };
    });
  }
  async completeWebhook(org: string, eventId: string) {
    await this.repository.transaction(async (manager) => {
      const event = await manager.findOneByOrFail(StripeWebhookEventEntity, {
        id: eventId,
        organizationId: org,
      });
      event.processingStatus = WebhookProcessingStatus.Processed;
      event.processedAt = new Date();
      event.error = null;
      event.retryable = false;
      event.nextAttemptAt = null;
      event.claimedAt = null;
      await manager.save(event);
    });
  }
  private async failed(org: string, attemptToken: string, message: string) {
    await this.repository.transaction(async (manager) => {
      await manager.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`B${org}`]);
      const connection = await this.repository.connection(org, manager);
      if (connection?.activeSyncAttemptToken === attemptToken) {
        connection.status = StripeConnectionStatus.Error;
        connection.activeSyncAttemptToken = null;
        connection.lastError = message.slice(0, 500);
        connection.updatedAt = new Date();
        await manager.save(connection);
      }
    });
  }
  private safeName(x: { id: string; name: string | null; email: string | null }) {
    return (x.name?.trim() || x.email?.trim() || x.id).slice(0, 200);
  }
  private safeEmail(email: string | null) {
    return email && email.length <= 320 && email.includes('@') ? email.trim() : null;
  }
  private safeError(error: unknown) {
    return error instanceof StripeOperationError
      ? `Stripe sync failed: ${error.stripeError.code ?? error.stripeError.type} while ${error.operation}. Existing revenue was preserved.`
      : 'Stripe could not be reached or rejected the stored credential. Existing revenue was preserved.';
  }
  private logFailure(org: string, error: unknown) {
    if (error instanceof StripeOperationError)
      this.logger.error({
        event: 'StripeApiFailure',
        organizationId: org,
        operation: error.operation,
        httpStatus: error.stripeError.statusCode,
        errorType: error.stripeError.type,
        errorCode: error.stripeError.code,
        errorMessage: error.stripeError.message,
        requestId: error.stripeError.requestId,
      });
    else
      this.logger.error({
        event: 'StripeSyncFailed',
        organizationId: org,
        errorType: error instanceof Error ? error.name : 'unknown',
      });
  }
}
