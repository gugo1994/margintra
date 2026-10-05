import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DataSource, EntityManager } from 'typeorm';
import { UsageIngestionInboxEntity } from '../../../database/entities';

@Injectable()
export class IngestionInboxRepository {
  constructor(private readonly dataSource: DataSource) {}
  transaction<T>(work: (manager: EntityManager) => Promise<T>) {
    return this.dataSource.transaction(work);
  }
  find(org: string, requestId: string, manager: EntityManager) {
    return manager.findOneBy(UsageIngestionInboxEntity, {
      organizationId: org,
      externalRequestId: requestId,
    });
  }
  create(values: Partial<UsageIngestionInboxEntity>, manager: EntityManager) {
    return manager.create(UsageIngestionInboxEntity, { id: randomUUID(), ...values });
  }
  save(row: UsageIngestionInboxEntity, manager: EntityManager) {
    return manager.save(row);
  }
}
