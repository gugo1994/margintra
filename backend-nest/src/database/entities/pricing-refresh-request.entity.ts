import { Column, Entity, PrimaryColumn } from 'typeorm';
import { AiProvider } from '../../common/enums/domain.enums';

@Entity('pricing_refresh_requests')
export class PricingRefreshRequestEntity {
  @PrimaryColumn({ name: 'Provider', length: 100 }) provider!: AiProvider;
  @Column({ name: 'RequestedModels', type: 'text', array: true, default: '{}' })
  requestedModels!: string[];
  @Column({ name: 'RequestedAt', type: 'timestamptz' }) requestedAt!: Date;
  @Column({ name: 'NextAttemptAt', type: 'timestamptz' }) nextAttemptAt!: Date;
  @Column({ name: 'ClaimedAt', type: 'timestamptz', nullable: true }) claimedAt!: Date | null;
  @Column({ name: 'AttemptCount', type: 'integer', default: 0 }) attemptCount!: number;
  @Column({ name: 'LastAttemptAt', type: 'timestamptz', nullable: true })
  lastAttemptAt!: Date | null;
  @Column({ name: 'LastSuccessfulAt', type: 'timestamptz', nullable: true })
  lastSuccessfulAt!: Date | null;
  @Column({ name: 'LastErrorCategory', type: 'varchar', length: 80, nullable: true })
  lastErrorCategory!: string | null;
  @Column({ name: 'CreatedAt', type: 'timestamptz' }) createdAt!: Date;
  @Column({ name: 'UpdatedAt', type: 'timestamptz' }) updatedAt!: Date;
}
