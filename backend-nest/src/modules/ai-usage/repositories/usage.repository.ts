import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { AiUsageEventEntity, UsageEventProcessingEntity } from '../../../database/entities';
@Injectable()
export class UsageRepository {
  constructor(private readonly dataSource: DataSource) {}
  transaction<T>(work: (manager: EntityManager) => Promise<T>) {
    return this.dataSource.transaction(work);
  }
  find(org: string, requestId: string, manager: EntityManager) {
    return manager.findOneBy(AiUsageEventEntity, {
      organizationId: org,
      externalRequestId: requestId,
    });
  }
  save(event: AiUsageEventEntity, manager: EntityManager) {
    return manager.save(event);
  }
  create(values: Partial<AiUsageEventEntity>, manager: EntityManager) {
    return manager.create(AiUsageEventEntity, { id: randomUUID(), ...values });
  }
  createProcessing(values: Partial<UsageEventProcessingEntity>, manager: EntityManager) {
    return manager.create(UsageEventProcessingEntity, { id: randomUUID(), ...values });
  }
  saveProcessing(state: UsageEventProcessingEntity, manager: EntityManager) {
    return manager.save(state);
  }
  processing(org: string, usageEventId: string, manager: EntityManager) {
    return manager.findOneBy(UsageEventProcessingEntity, { organizationId: org, usageEventId });
  }
}
