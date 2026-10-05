import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { BillingProvider } from '../../common/enums/domain.enums';
@Entity('billing_subscriptions')
@Index(['organizationId', 'provider', 'externalSubscriptionId'], { unique: true })
@Index(['organizationId', 'customerId'])
export class BillingSubscriptionEntity {
  @PrimaryGeneratedColumn('uuid', { name: 'Id' }) id!: string;
  @Column({ name: 'OrganizationId', type: 'uuid' }) organizationId!: string;
  @Column({ name: 'CustomerId', type: 'uuid' }) customerId!: string;
  @Column({ name: 'Provider', length: 30 }) provider!: BillingProvider;
  @Column({ name: 'ExternalSubscriptionId', length: 100 }) externalSubscriptionId!: string;
  @Column({ name: 'ExternalCustomerId', length: 100 }) externalCustomerId!: string;
  @Column({ name: 'Name', length: 200 }) name!: string;
  @Column({ name: 'Status', length: 40 }) status!: string;
  @Column({ name: 'Currency', length: 3 }) currency!: string;
  @Column({ name: 'CurrentPeriodStart', type: 'timestamptz', nullable: true })
  currentPeriodStart!: Date | null;
  @Column({ name: 'CurrentPeriodEnd', type: 'timestamptz', nullable: true })
  currentPeriodEnd!: Date | null;
  @Column({ name: 'CancelAtPeriodEnd' }) cancelAtPeriodEnd!: boolean;
  @Column({ name: 'MonthlyRecurringRevenue', type: 'numeric', precision: 18, scale: 6 })
  monthlyRecurringRevenue!: string;
  @Column({ name: 'Warning', type: 'varchar', length: 1000, nullable: true }) warning!:
    string | null;
  @Column({ name: 'CreatedAt', type: 'timestamptz' }) createdAt!: Date;
  @Column({ name: 'UpdatedAt', type: 'timestamptz' }) updatedAt!: Date;
}
