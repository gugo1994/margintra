import { MigrationInterface, QueryRunner } from 'typeorm';

export class BackfillUsageInbox1787738700000 implements MigrationInterface {
  name = 'BackfillUsageInbox1787738700000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT INTO usage_ingestion_inbox
        ("OrganizationId","ExternalRequestId","CustomerExternalId","Provider","Model","Feature",
         "InputTokens","OutputTokens","OccurredAt","Metadata","ExplicitCost","ExplicitCostCurrency",
         "ProcessingStatus","AttemptCount","NextAttemptAt","ClaimedAt","LastErrorCode",
         "LastErrorMessage","ProcessedAt","UsageEventId","CreatedAt","UpdatedAt")
      SELECT u."OrganizationId",u."ExternalRequestId",c."ExternalCustomerId",u."Provider",u."Model",
        u."Feature",u."InputTokens",u."OutputTokens",u."OccurredAt",u."Metadata",
        CASE WHEN u."CostSource"='explicit' THEN u."Cost" ELSE NULL END,
        CASE WHEN u."CostSource"='explicit' THEN u."Currency" ELSE NULL END,
        'processed',0,NULL,NULL,NULL,NULL,u."CreatedAt",u."Id",u."CreatedAt",u."CreatedAt"
      FROM ai_usage_events u
      JOIN customers c ON c."Id"=u."CustomerId" AND c."OrganizationId"=u."OrganizationId"
      ON CONFLICT ("OrganizationId","ExternalRequestId") DO NOTHING;
    `);
  }

  async down(): Promise<void> {
    // Historical accepted events are intentionally retained in the durable inbox.
  }
}
