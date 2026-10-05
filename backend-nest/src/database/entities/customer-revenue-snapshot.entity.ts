import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('customer_revenue_snapshots')
@Index(['organizationId', 'customerId', 'sequence'], { unique: true })
@Index(['organizationId', 'customerId', 'effectiveFrom', 'sequence'])
export class CustomerRevenueSnapshotEntity {
  @PrimaryGeneratedColumn('uuid', { name: 'Id' }) id!: string;
  @Column({ name: 'OrganizationId', type: 'uuid' }) organizationId!: string;
  @Column({ name: 'CustomerId', type: 'uuid' }) customerId!: string;
  @Column({ name: 'Revenue', type: 'numeric', precision: 18, scale: 6 }) revenue!: string;
  @Column({ name: 'Currency', length: 3 }) currency!: string;
  @Column({ name: 'EffectiveFrom', type: 'timestamptz' }) effectiveFrom!: Date;
  @Column({ name: 'Sequence', type: 'integer', nullable: true }) sequence!: number;
  @Column({ name: 'CreatedAt', type: 'timestamptz' }) createdAt!: Date;
}
