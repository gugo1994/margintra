import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { AiProvider, InboxProcessingStatus } from '../../common/enums/domain.enums';

@Entity('usage_ingestion_inbox')
@Index(['organizationId', 'externalRequestId'], { unique: true })
@Index('IDX_usage_inbox_due', ['nextAttemptAt', 'createdAt'], {
  where: "\"ProcessingStatus\" IN ('pending','failed')",
})
@Index('IDX_usage_inbox_pending_pricing', ['provider', 'model', 'occurredAt'], {
  where: '"ProcessingStatus"=\'pending_pricing\'',
})
export class UsageIngestionInboxEntity {
  @PrimaryGeneratedColumn('uuid', { name: 'Id' }) id!: string;
  @Column({ name: 'OrganizationId', type: 'uuid' }) organizationId!: string;
  @Column({ name: 'ExternalRequestId', length: 300 }) externalRequestId!: string;
  @Column({ name: 'CustomerExternalId', length: 200 }) customerExternalId!: string;
  @Column({ name: 'Provider', length: 100 }) provider!: AiProvider;
  @Column({ name: 'Model', length: 200 }) model!: string;
  @Column({ name: 'Feature', length: 200 }) feature!: string;
  @Column({ name: 'InputTokens', type: 'bigint' }) inputTokens!: string;
  @Column({ name: 'OutputTokens', type: 'bigint' }) outputTokens!: string;
  @Column({ name: 'OccurredAt', type: 'timestamptz' }) occurredAt!: Date;
  @Column({ name: 'Metadata', type: 'jsonb', default: () => "'{}'::jsonb" })
  metadata!: Record<string, unknown>;
  @Column({ name: 'ExplicitCost', type: 'numeric', precision: 18, scale: 6, nullable: true })
  explicitCost!: string | null;
  @Column({ name: 'ExplicitCostCurrency', type: 'varchar', length: 3, nullable: true })
  explicitCostCurrency!: string | null;
  @Column({ name: 'ProcessingStatus', length: 30 }) processingStatus!: InboxProcessingStatus;
  @Column({ name: 'AttemptCount', default: 0 }) attemptCount!: number;
  @Column({ name: 'NextAttemptAt', type: 'timestamptz', nullable: true })
  nextAttemptAt!: Date | null;
  @Column({ name: 'ClaimedAt', type: 'timestamptz', nullable: true }) claimedAt!: Date | null;
  @Column({ name: 'LastErrorCode', type: 'varchar', length: 80, nullable: true }) lastErrorCode!:
    string | null;
  @Column({ name: 'LastErrorMessage', type: 'varchar', length: 300, nullable: true })
  lastErrorMessage!: string | null;
  @Column({ name: 'ProcessedAt', type: 'timestamptz', nullable: true }) processedAt!: Date | null;
  @Column({ name: 'UsageEventId', type: 'uuid', nullable: true }) usageEventId!: string | null;
  @Column({ name: 'CreatedAt', type: 'timestamptz' }) createdAt!: Date;
  @Column({ name: 'UpdatedAt', type: 'timestamptz' }) updatedAt!: Date;
}
