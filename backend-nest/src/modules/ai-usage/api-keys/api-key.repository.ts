import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { IngestionApiKeyEntity } from '../../../database/entities';

@Injectable()
export class ApiKeyRepository {
  constructor(private readonly dataSource: DataSource) {}
  create(values: Partial<IngestionApiKeyEntity>, manager = this.dataSource.manager) {
    return manager.create(IngestionApiKeyEntity, { id: randomUUID(), ...values });
  }
  save(key: IngestionApiKeyEntity, manager = this.dataSource.manager) {
    return manager.save(key);
  }
  list(org: string) {
    return this.dataSource.manager.find(IngestionApiKeyEntity, {
      where: { organizationId: org },
      order: { createdAt: 'DESC' },
    });
  }
  find(org: string, id: string) {
    return this.dataSource.manager.findOneBy(IngestionApiKeyEntity, { organizationId: org, id });
  }
  findForUpdate(org: string, id: string, manager: EntityManager) {
    return manager.findOne(IngestionApiKeyEntity, {
      where: { organizationId: org, id },
      lock: { mode: 'pessimistic_write' },
    });
  }
  findByKeyId(keyId: string) {
    return this.dataSource.manager.findOneBy(IngestionApiKeyEntity, { keyId });
  }
  async touch(id: string, lastUsedAt: Date) {
    await this.dataSource.manager.update(IngestionApiKeyEntity, { id }, { lastUsedAt });
  }
  transaction<T>(work: (manager: EntityManager) => Promise<T>) {
    return this.dataSource.transaction(work);
  }
}
