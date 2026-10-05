import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { IngestionApiKeyStatus } from '../../../common/enums/domain.enums';
import { CodedApplicationError } from '../../../common/errors/application.error';
import { INGESTION_ERRORS } from '../constants/ingestion.constants';
import { parseKeyId, verifyApiKey } from './api-key.crypto';
import { ApiKeyRepository } from './api-key.repository';

@Injectable()
export class IngestionApiKeyGuard implements CanActivate {
  constructor(private readonly repository: ApiKeyRepository) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<{ headers: Record<string, string | string[] | undefined>; ingestion?: object }>();
    const raw = request.headers['x-margintra-key'];
    const secret = typeof raw === 'string' ? raw : '';
    const keyId = parseKeyId(secret);
    const key = keyId ? await this.repository.findByKeyId(keyId) : null;
    if (!key || !(await verifyApiKey(secret, key.secretHash)))
      throw new CodedApplicationError(
        401,
        INGESTION_ERRORS.invalidKey,
        'The ingestion API key is invalid.',
      );
    if (key.status === IngestionApiKeyStatus.Revoked)
      throw new CodedApplicationError(
        401,
        INGESTION_ERRORS.revokedKey,
        'The ingestion API key has been revoked.',
      );
    request.ingestion = { organizationId: key.organizationId, apiKeyId: key.id };
    if (!key.lastUsedAt || Date.now() - key.lastUsedAt.getTime() >= 60_000)
      await this.repository.touch(key.id, new Date());
    return true;
  }
}
