import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AiProvider } from '../../../common/enums/domain.enums';
import { PricingRefreshRequestEntity } from '../../../database/entities';
import { MetricsService } from '../../operations/metrics.service';

@Injectable()
export class PricingRefreshRequestService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly metrics: MetricsService,
  ) {}

  async request(provider: AiProvider, model: string): Promise<void> {
    const normalized = model.trim();
    const result: Array<{ coalesced: boolean }> = await this.dataSource.query(
      `INSERT INTO "pricing_refresh_requests"
         ("Provider","RequestedModels","RequestedAt","NextAttemptAt","ClaimedAt","AttemptCount",
          "LastAttemptAt","LastSuccessfulAt","LastErrorCategory","CreatedAt","UpdatedAt")
       VALUES ($1,ARRAY[$2]::text[],now(),now(),NULL,0,NULL,NULL,NULL,now(),now())
       ON CONFLICT ("Provider") DO UPDATE SET
         "RequestedModels"=ARRAY(SELECT DISTINCT unnest(
           "pricing_refresh_requests"."RequestedModels" || EXCLUDED."RequestedModels")),
         "RequestedAt"=now(),"NextAttemptAt"=LEAST("pricing_refresh_requests"."NextAttemptAt",now()),
         "UpdatedAt"=now()
       RETURNING (xmax <> 0) AS coalesced`,
      [provider, normalized],
    );
    if (result[0]?.coalesced) this.metrics.pricingRefresh('request_coalesced', provider);
  }

  async ensureProvider(provider: AiProvider): Promise<void> {
    await this.dataSource.query(
      `INSERT INTO "pricing_refresh_requests"
         ("Provider","RequestedModels","RequestedAt","NextAttemptAt","ClaimedAt","AttemptCount",
          "LastAttemptAt","LastSuccessfulAt","LastErrorCategory","CreatedAt","UpdatedAt")
       VALUES ($1,'{}',now(),now(),NULL,0,NULL,NULL,NULL,now(),now())
       ON CONFLICT ("Provider") DO NOTHING`,
      [provider],
    );
  }

  async claim(staleAfterMs: number): Promise<PricingRefreshRequestEntity | null> {
    return this.dataSource.transaction(async (manager) => {
      await manager.query(
        `UPDATE "pricing_refresh_requests" SET "ClaimedAt"=NULL,"UpdatedAt"=now()
         WHERE "ClaimedAt"<now()-($1::int * interval '1 millisecond')`,
        [staleAfterMs],
      );
      const rows = await manager.query<Array<{ Provider: AiProvider }>>(
        `SELECT "Provider" FROM "pricing_refresh_requests"
         WHERE "ClaimedAt" IS NULL AND "NextAttemptAt"<=now()
         ORDER BY "NextAttemptAt","Provider" FOR UPDATE SKIP LOCKED LIMIT 1`,
      );
      if (!rows[0]) return null;
      await manager.query(
        `UPDATE "pricing_refresh_requests" SET "ClaimedAt"=now(),"LastAttemptAt"=now(),
          "AttemptCount"="AttemptCount"+1,"UpdatedAt"=now() WHERE "Provider"=$1`,
        [rows[0].Provider],
      );
      return manager.findOneByOrFail(PricingRefreshRequestEntity, { provider: rows[0].Provider });
    });
  }

  async complete(provider: AiProvider, intervalMs: number, successful: boolean): Promise<void> {
    await this.dataSource.query(
      `UPDATE "pricing_refresh_requests" SET "RequestedModels"='{}',"ClaimedAt"=NULL,
       "AttemptCount"=0,"LastSuccessfulAt"=CASE WHEN $3 THEN now() ELSE "LastSuccessfulAt" END,
       "LastErrorCategory"=NULL,
       "NextAttemptAt"=now()+($2::int * interval '1 millisecond'),"UpdatedAt"=now()
       WHERE "Provider"=$1`,
      [provider, intervalMs, successful],
    );
  }

  async fail(provider: AiProvider, retryMs: number, category: string): Promise<void> {
    await this.dataSource.query(
      `UPDATE "pricing_refresh_requests" SET "ClaimedAt"=NULL,"LastErrorCategory"=$3,
       "NextAttemptAt"=now()+($2::int * interval '1 millisecond'),"UpdatedAt"=now()
       WHERE "Provider"=$1`,
      [provider, retryMs, category.slice(0, 80)],
    );
  }
}
