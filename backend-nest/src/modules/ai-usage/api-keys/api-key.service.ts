import { Injectable, Logger } from '@nestjs/common';
import { IngestionApiKeyStatus } from '../../../common/enums/domain.enums';
import { ConflictError, NotFoundError } from '../../../common/errors/application.error';
import { ApiKeyRepository } from './api-key.repository';
import { createApiKey, hashApiKey } from './api-key.crypto';

@Injectable()
export class ApiKeyService {
  private readonly logger = new Logger(ApiKeyService.name);
  constructor(private readonly repository: ApiKeyRepository) {}
  async create(org: string, name: string) {
    const generated = createApiKey();
    const createdAt = new Date();
    const key = this.repository.create({
      organizationId: org,
      name: name.trim(),
      keyId: generated.keyId,
      keyPrefix: generated.secret.slice(0, 28),
      secretHash: await hashApiKey(generated.secret),
      status: IngestionApiKeyStatus.Active,
      createdAt,
      revokedAt: null,
      lastUsedAt: null,
    });
    await this.repository.save(key);
    this.logger.log({ event: 'ApiKeyCreated', organizationId: org, apiKeyId: key.id });
    return { ...this.response(key), secret: generated.secret };
  }
  async list(org: string) {
    return (await this.repository.list(org)).map((key) => this.response(key));
  }
  async revoke(org: string, id: string) {
    const key = await this.repository.find(org, id);
    if (!key) throw new NotFoundError();
    if (key.status !== IngestionApiKeyStatus.Revoked) {
      key.status = IngestionApiKeyStatus.Revoked;
      key.revokedAt = new Date();
      await this.repository.save(key);
      this.logger.log({ event: 'ApiKeyRevoked', organizationId: org, apiKeyId: key.id });
    }
    return this.response(key);
  }
  async rotate(org: string, id: string) {
    const generated = createApiKey();
    const secretHash = await hashApiKey(generated.secret);
    const result = await this.repository.transaction(async (manager) => {
      const oldKey = await this.repository.findForUpdate(org, id, manager);
      if (!oldKey) throw new NotFoundError();
      if (oldKey.status === IngestionApiKeyStatus.Revoked)
        throw new ConflictError('Only an active ingestion API key can be rotated.');
      const now = new Date();
      oldKey.status = IngestionApiKeyStatus.Revoked;
      oldKey.revokedAt = now;
      await this.repository.save(oldKey, manager);
      const newKey = this.repository.create(
        {
          organizationId: org,
          name: oldKey.name,
          keyId: generated.keyId,
          keyPrefix: generated.secret.slice(0, 28),
          secretHash,
          status: IngestionApiKeyStatus.Active,
          createdAt: now,
          revokedAt: null,
          lastUsedAt: null,
        },
        manager,
      );
      await this.repository.save(newKey, manager);
      return { oldKey, newKey };
    });
    this.logger.log({
      event: 'ApiKeyRotated',
      organizationId: org,
      revokedApiKeyId: result.oldKey.id,
      apiKeyId: result.newKey.id,
    });
    return { ...this.response(result.newKey), secret: generated.secret };
  }
  private response(key: import('../../../database/entities').IngestionApiKeyEntity) {
    return {
      id: key.id,
      name: key.name,
      keyPrefix: key.keyPrefix,
      status: key.status,
      createdAt: key.createdAt.toISOString(),
      revokedAt: key.revokedAt?.toISOString() ?? null,
      lastUsedAt: key.lastUsedAt?.toISOString() ?? null,
    };
  }
}
