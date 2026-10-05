import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { UsageProcessingStatus } from '../../common/enums/domain.enums';

@Entity('usage_event_processing')
@Index(['organizationId', 'usageEventId'], { unique: true })
@Index('IDX_usage_processing_retry_due', ['nextRetryAt', 'createdAt'], {
  where: '"Retryable"=true AND "Status" IN (\'pending\',\'failed\')',
})
@Index('IDX_usage_processing_stale_claim', ['claimedAt'], { where: '"Status"=\'processing\'' })
export class UsageEventProcessingEntity {
  @PrimaryGeneratedColumn('uuid', { name: 'Id' }) id!: string;
  @Column({ name: 'OrganizationId', type: 'uuid' }) organizationId!: string;
  @Column({ name: 'UsageEventId', type: 'uuid' }) usageEventId!: string;
  @Column({ name: 'Status', length: 20 }) status!: UsageProcessingStatus;
  @Column({ name: 'ProcessedAt', type: 'timestamptz', nullable: true }) processedAt!: Date | null;
  @Column({ name: 'FailureCount', type: 'integer', default: 0 }) failureCount!: number;
  @Column({ name: 'LastFailureCategory', type: 'varchar', length: 80, nullable: true })
  lastFailureCategory!: string | null;
  @Column({ name: 'LastAttemptAt', type: 'timestamptz', nullable: true })
  lastAttemptAt!: Date | null;
  @Column({ name: 'NextRetryAt', type: 'timestamptz', nullable: true }) nextRetryAt!: Date | null;
  @Column({ name: 'ClaimedAt', type: 'timestamptz', nullable: true }) claimedAt!: Date | null;
  @Column({ name: 'Retryable', type: 'boolean', default: true }) retryable!: boolean;
  @Column({ name: 'CreatedAt', type: 'timestamptz' }) createdAt!: Date;
  @Column({ name: 'UpdatedAt', type: 'timestamptz' }) updatedAt!: Date;
}
