import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { RevenueSource, StripeCustomerStatus } from '../../common/enums/domain.enums';
@Entity('customers')
@Index(['organizationId', 'externalCustomerId'], { unique: true })
@Index(['organizationId', 'stripeCustomerId'], {
  unique: true,
  where: '"StripeCustomerId" IS NOT NULL',
})
export class CustomerEntity {
  @PrimaryGeneratedColumn('uuid', { name: 'Id' }) id!: string;
  @Column({ name: 'OrganizationId', type: 'uuid' }) organizationId!: string;
  @Column({ name: 'ExternalCustomerId', length: 200 }) externalCustomerId!: string;
  @Column({ name: 'Name', length: 200 }) name!: string;
  @Column({ name: 'Email', type: 'varchar', length: 320, nullable: true }) email!: string | null;
  @Column({ name: 'MonthlyRevenue', type: 'numeric', precision: 18, scale: 2 })
  monthlyRevenue!: string;
  @Column({ name: 'ManualMonthlyRevenue', type: 'numeric', precision: 18, scale: 2 })
  manualMonthlyRevenue!: string;
  @Column({ name: 'RevenueSource', length: 20 }) revenueSource!: RevenueSource;
  @Column({ name: 'StripeCustomerId', type: 'varchar', length: 100, nullable: true })
  stripeCustomerId!: string | null;
  @Column({ name: 'StripeCustomerStatus', length: 20 }) stripeCustomerStatus!: StripeCustomerStatus;
  @Column({ name: 'RevenueUpdatedAt', type: 'timestamptz', nullable: true })
  revenueUpdatedAt!: Date | null;
  @Column({ name: 'RevenueStale' }) revenueStale!: boolean;
  @Column({ name: 'Currency', length: 3 }) currency!: string;
  @Column({
    name: 'TargetGrossMarginOverride',
    type: 'numeric',
    precision: 5,
    scale: 2,
    nullable: true,
  })
  targetGrossMarginOverride!: string | null;
  @Column({
    name: 'BudgetWarningThresholdOverride',
    type: 'numeric',
    precision: 5,
    scale: 2,
    nullable: true,
  })
  budgetWarningThresholdOverride!: string | null;
  @Column({
    name: 'BudgetCriticalThresholdOverride',
    type: 'numeric',
    precision: 5,
    scale: 2,
    nullable: true,
  })
  budgetCriticalThresholdOverride!: string | null;
  @Column({ name: 'CreatedAt', type: 'timestamptz' }) createdAt!: Date;
  @Column({ name: 'UpdatedAt', type: 'timestamptz' }) updatedAt!: Date;
}
