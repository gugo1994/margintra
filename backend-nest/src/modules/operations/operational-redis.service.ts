import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, RedisClientType } from 'redis';

@Injectable()
export class OperationalRedisService implements OnModuleDestroy {
  private readonly client: RedisClientType;
  constructor(config: ConfigService) {
    this.client = createClient({ url: config.getOrThrow<string>('redis.url') });
    this.client.on('error', () => undefined);
  }
  private async connected(): Promise<RedisClientType> {
    if (!this.client.isOpen) await this.client.connect();
    return this.client;
  }
  async ping(): Promise<void> {
    await (await this.connected()).ping();
  }
  async incrementWithExpiry(key: string, seconds: number): Promise<number> {
    const client = await this.connected();
    // Keep the increment and first expiry assignment atomic. A replica dying
    // between separate INCR/EXPIRE commands must not leave a permanent limiter.
    const result = await client.eval(
      `local count = redis.call('INCR', KEYS[1])
       if count == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
       return count`,
      { keys: [key], arguments: [String(seconds)] },
    );
    return Number(result);
  }
  async onModuleDestroy(): Promise<void> {
    if (this.client.isOpen) await this.client.quit();
  }
}
