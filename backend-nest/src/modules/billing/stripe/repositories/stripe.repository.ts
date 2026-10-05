import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import {
  BillingProvider,
  RevenueSource,
  WebhookProcessingStatus,
} from '../../../../common/enums/domain.enums';
import {
  BillingSubscriptionEntity,
  CustomerEntity,
  OrganizationEntity,
  StripeConnectionEntity,
  StripeWebhookEventEntity,
} from '../../../../database/entities';
@Injectable()
export class StripeRepository {
  constructor(private readonly dataSource: DataSource) {}
  transaction<T>(work: (manager: EntityManager) => Promise<T>) {
    return this.dataSource.transaction(work);
  }
  connection(org: string, manager = this.dataSource.manager) {
    return manager.findOneBy(StripeConnectionEntity, { organizationId: org });
  }
  connectionByPublicId(id: string, manager = this.dataSource.manager) {
    return manager.findOneBy(StripeConnectionEntity, { publicIdentifier: id });
  }
  organization(org: string, manager = this.dataSource.manager) {
    return manager.findOneByOrFail(OrganizationEntity, { id: org });
  }
  stripeCustomers(org: string, manager: EntityManager) {
    return manager.find(CustomerEntity, {
      where: { organizationId: org, revenueSource: RevenueSource.Stripe },
    });
  }
  subscriptions(org: string, manager: EntityManager) {
    return manager.find(BillingSubscriptionEntity, {
      where: { organizationId: org, provider: BillingProvider.Stripe },
    });
  }
  webhook(connectionId: string, eventId: string, manager: EntityManager) {
    return manager.findOne(StripeWebhookEventEntity, {
      where: { stripeConnectionId: connectionId, stripeEventId: eventId },
      lock: { mode: 'pessimistic_write' },
    });
  }
  save<T extends object>(entity: T, manager: EntityManager) {
    return manager.save(entity);
  }
  createConnection(values: Partial<StripeConnectionEntity>, manager: EntityManager) {
    return manager.create(StripeConnectionEntity, { id: randomUUID(), ...values });
  }
  createCustomer(values: Partial<CustomerEntity>, manager: EntityManager) {
    return manager.create(CustomerEntity, { id: randomUUID(), ...values });
  }
  createSubscription(values: Partial<BillingSubscriptionEntity>, manager: EntityManager) {
    return manager.create(BillingSubscriptionEntity, { id: randomUUID(), ...values });
  }
  createWebhook(values: Partial<StripeWebhookEventEntity>, manager: EntityManager) {
    return manager.create(StripeWebhookEventEntity, {
      id: randomUUID(),
      processingStatus: WebhookProcessingStatus.Processing,
      ...values,
    });
  }
}
