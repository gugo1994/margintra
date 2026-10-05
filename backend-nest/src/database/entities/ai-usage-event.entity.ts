import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { AiCostSource, AiProvider } from '../../common/enums/domain.enums';
@Entity('ai_usage_events')
@Index(['organizationId', 'externalRequestId'], { unique: true })
@Index(['organizationId', 'customerId', 'occurredAt'])
@Index(['organizationId', 'occurredAt'])
@Index(['organizationId', 'provider', 'occurredAt'])
@Index(['organizationId', 'feature', 'occurredAt'])
export class AiUsageEventEntity {
  @PrimaryGeneratedColumn('uuid', { name: 'Id' }) id!: string;
  @Column({ name: 'OrganizationId', type: 'uuid' }) organizationId!: string;
  @Column({ name: 'CustomerId', type: 'uuid' }) customerId!: string;
  @Column({ name: 'Provider', length: 100 }) provider!: AiProvider;
  @Column({ name: 'Model', length: 200 }) model!: string;
  @Column({ name: 'Feature', length: 200 }) feature!: string;
  @Column({ name: 'InputTokens', type: 'bigint' }) inputTokens!: string;
  @Column({ name: 'OutputTokens', type: 'bigint' }) outputTokens!: string;
  @Column({ name: 'Cost', type: 'numeric', precision: 18, scale: 6 }) cost!: string;
  @Column({ name: 'Currency', length: 3, default: 'USD' }) currency!: string;
  @Column({ name: 'CostSource', length: 20, default: AiCostSource.Explicit })
  costSource!: AiCostSource;
  @Column({ name: 'PricingVersion', type: 'varchar', length: 100, nullable: true })
  pricingVersion!: string | null;
  @Column({ name: 'PricingModel', type: 'varchar', length: 200, nullable: true })
  pricingModel!: string | null;
  @Column({ name: 'PricingId', type: 'uuid', nullable: true }) pricingId!: string | null;
  @Column({ name: 'Metadata', type: 'jsonb', default: () => "'{}'::jsonb" })
  metadata!: Record<string, unknown>;
  @Column({ name: 'ExternalRequestId', length: 300 }) externalRequestId!: string;
  @Column({ name: 'OccurredAt', type: 'timestamptz' }) occurredAt!: Date;
  @Column({ name: 'CreatedAt', type: 'timestamptz' }) createdAt!: Date;
}
