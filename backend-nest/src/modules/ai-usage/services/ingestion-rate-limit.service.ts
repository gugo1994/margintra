import { Injectable } from '@nestjs/common';
import { CodedApplicationError } from '../../../common/errors/application.error';
import { INGESTION_ERRORS, INGESTION_LIMITS } from '../constants/ingestion.constants';
import { OperationalRedisService } from '../../operations/operational-redis.service';

@Injectable()
export class IngestionRateLimitService {
  constructor(private readonly redis: OperationalRedisService) {}
  async check(apiKeyId: string): Promise<void> {
    const minute = Math.floor(Date.now() / 60_000);
    const key = `margintra:ingestion-rate:${apiKeyId}:${String(minute)}`;
    const count = await this.redis.incrementWithExpiry(key, 120);
    if (count > INGESTION_LIMITS.requestsPerMinute)
      throw new CodedApplicationError(
        429,
        INGESTION_ERRORS.rateLimited,
        'The ingestion rate limit was exceeded.',
      );
  }
}
