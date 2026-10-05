import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { WebhookProcessingStatus } from '../../common/enums/domain.enums';
@Entity('stripe_webhook_events')
@Index(['stripeConnectionId', 'stripeEventId'], { unique: true })
export class StripeWebhookEventEntity {
  @PrimaryGeneratedColumn('uuid', { name: 'Id' }) id!: string;
  @Column({ name: 'OrganizationId', type: 'uuid' }) organizationId!: string;
  @Column({ name: 'StripeConnectionId', type: 'uuid' }) stripeConnectionId!: string;
  @Column({ name: 'StripeEventId', length: 100 }) stripeEventId!: string;
  @Column({ name: 'EventType', length: 200 }) eventType!: string;
  @Column({ name: 'ProcessingStatus', length: 30 }) processingStatus!: WebhookProcessingStatus;
  @Column({ name: 'ReceivedAt', type: 'timestamptz' }) receivedAt!: Date;
  @Column({ name: 'ProcessedAt', type: 'timestamptz', nullable: true }) processedAt!: Date | null;
  @Column({ name: 'Error', type: 'varchar', length: 500, nullable: true }) error!: string | null;
  @Column({ name: 'Retryable', type: 'boolean', default: false }) retryable!: boolean;
  @Column({ name: 'AttemptCount', type: 'integer', default: 0 }) attemptCount!: number;
  @Column({ name: 'NextAttemptAt', type: 'timestamptz', nullable: true })
  nextAttemptAt!: Date | null;
  @Column({ name: 'ClaimedAt', type: 'timestamptz', nullable: true }) claimedAt!: Date | null;
}
