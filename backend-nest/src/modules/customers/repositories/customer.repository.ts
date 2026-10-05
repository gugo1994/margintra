import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { StripeConnectionStatus } from '../../../common/enums/domain.enums';
import { CustomerEntity, StripeConnectionEntity } from '../../../database/entities';
@Injectable()
export class CustomerRepository {
  constructor(private readonly dataSource: DataSource) {}
  list(org: string) {
    return this.dataSource.manager.find(CustomerEntity, {
      where: { organizationId: org },
      order: { name: 'ASC' },
    });
  }
  find(org: string, id: string, manager = this.dataSource.manager) {
    return manager.findOneBy(CustomerEntity, { organizationId: org, id });
  }
  findByExternalId(org: string, externalCustomerId: string, manager = this.dataSource.manager) {
    return manager.findOneBy(CustomerEntity, { organizationId: org, externalCustomerId });
  }
  async resolveIngestionCustomer(
    org: string,
    externalCustomerId: string,
    manager = this.dataSource.manager,
  ) {
    if (externalCustomerId.startsWith('stripe:'))
      return this.findByExternalId(org, externalCustomerId, manager);
    if (externalCustomerId.startsWith('cus_')) {
      const stripe = await manager.findOneBy(StripeConnectionEntity, { organizationId: org });
      if (stripe?.encryptedSecretKey && stripe.status !== StripeConnectionStatus.NotConnected)
        return this.findByExternalId(org, `stripe:${externalCustomerId}`, manager);
    }
    return this.findByExternalId(org, externalCustomerId, manager);
  }
  save(customer: CustomerEntity, manager = this.dataSource.manager) {
    return manager.save(customer);
  }
  create(values: Partial<CustomerEntity>, manager = this.dataSource.manager) {
    return manager.create(CustomerEntity, { id: randomUUID(), ...values });
  }
  transaction<T>(work: (manager: EntityManager) => Promise<T>) {
    return this.dataSource.transaction(work);
  }
}
