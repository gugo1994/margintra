import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';
@Entity('organizations')
export class OrganizationEntity {
  @PrimaryGeneratedColumn('uuid', { name: 'Id' }) id!: string;
  @Column({ name: 'Name', length: 200 }) name!: string;
  @Column({ name: 'TargetGrossMargin', type: 'numeric', precision: 5, scale: 2 })
  targetGrossMargin!: string;
  @Column({ name: 'BudgetWarningThreshold', type: 'numeric', precision: 5, scale: 2 })
  budgetWarningThreshold!: string;
  @Column({ name: 'BudgetCriticalThreshold', type: 'numeric', precision: 5, scale: 2 })
  budgetCriticalThreshold!: string;
  @Column({ name: 'ReportingCurrency', length: 3 }) reportingCurrency!: string;
  @Column({ name: 'OnboardingStartedAt', type: 'timestamptz', nullable: true })
  onboardingStartedAt!: Date | null;
  @Column({ name: 'OnboardingCompletedAt', type: 'timestamptz', nullable: true })
  onboardingCompletedAt!: Date | null;
  @Column({ name: 'CreatedAt', type: 'timestamptz' }) createdAt!: Date;
  @Column({ name: 'UpdatedAt', type: 'timestamptz' }) updatedAt!: Date;
}
