import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
@Entity('margin_snapshots')
@Index(['organizationId', 'customerId', 'periodStart'], { unique: true })
export class MarginSnapshotEntity {
  @PrimaryGeneratedColumn('uuid', { name: 'Id' }) id!: string;
  @Column({ name: 'OrganizationId', type: 'uuid' }) organizationId!: string;
  @Column({ name: 'CustomerId', type: 'uuid' }) customerId!: string;
  @Column({ name: 'PeriodStart', type: 'timestamptz' }) periodStart!: Date;
  @Column({ name: 'PeriodEnd', type: 'timestamptz' }) periodEnd!: Date;
  @Column({ name: 'Revenue', type: 'numeric', precision: 18, scale: 2 }) revenue!: string;
  @Column({ name: 'AiCost', type: 'numeric', precision: 18, scale: 6 }) aiCost!: string;
  @Column({ name: 'GrossProfit', type: 'numeric', precision: 18, scale: 6 }) grossProfit!: string;
  @Column({ name: 'GrossMargin', type: 'numeric', precision: 9, scale: 4, nullable: true })
  grossMargin!: string | null;
  @Column({ name: 'AllowedAiBudget', type: 'numeric', precision: 18, scale: 6 })
  allowedAiBudget!: string;
  @Column({ name: 'RemainingAiBudget', type: 'numeric', precision: 18, scale: 6 })
  remainingAiBudget!: string;
  @Column({ name: 'CreatedAt', type: 'timestamptz' }) createdAt!: Date;
  @Column({ name: 'UpdatedAt', type: 'timestamptz' }) updatedAt!: Date;
}
