import { Controller, Get, Header, ServiceUnavailableException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Public } from '../../common/decorators/public.decorator';
import { MetricsService } from './metrics.service';
import { OperationalRedisService } from './operational-redis.service';

@Public()
@Controller()
export class OperationsController {
  constructor(
    private readonly dataSource: DataSource,
    private readonly redis: OperationalRedisService,
    private readonly metrics: MetricsService,
  ) {}
  @Get('health/live') live() {
    return { status: 'alive' };
  }
  @Get('health/ready') async ready() {
    try {
      if (!this.dataSource.isInitialized) throw new Error('database unavailable');
      await this.dataSource.query('SELECT 1');
      await this.redis.ping();
      return { status: 'ready', checks: { postgresql: 'up', redis: 'up' } };
    } catch {
      throw new ServiceUnavailableException('Service is not ready.');
    }
  }
  @Get('metrics')
  @Header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
  async operationalMetrics() {
    const rows = await this.dataSource.query<Array<{ status: string; count: string }>>(
      `SELECT CASE WHEN "Status"='pending' AND "AttemptCount">0 THEN 'retry_scheduled' ELSE "Status" END AS status,
       count(*)::text AS count FROM notification_deliveries
       WHERE "Status" IN ('pending','processing','failed') GROUP BY 1`,
    );
    const counts = { pending: 0, processing: 0, failed: 0, retry_scheduled: 0 };
    rows.forEach((row) => {
      if (row.status in counts) counts[row.status as keyof typeof counts] = Number(row.count);
    });
    const inboxRows = await this.dataSource.query<Array<{ status: string; count: string }>>(
      `SELECT "ProcessingStatus" AS status,count(*)::text AS count
       FROM usage_ingestion_inbox GROUP BY "ProcessingStatus"`,
    );
    const inboxCounts: Record<string, number> = {
      pending: 0,
      processing: 0,
      pending_pricing: 0,
      processed: 0,
      failed: 0,
    };
    inboxRows.forEach((row) => {
      inboxCounts[row.status] = Number(row.count);
    });
    return this.metrics.render(counts, inboxCounts);
  }
}
