import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('customer_guardrail_versions')
@Index(['organizationId', 'customerId', 'effectiveFrom'], { unique: true })
export class CustomerGuardrailVersionEntity {
  @PrimaryGeneratedColumn('uuid', { name: 'Id' }) id!: string;
  @Column({ name: 'OrganizationId', type: 'uuid' }) organizationId!: string;
  @Column({ name: 'CustomerId', type: 'uuid' }) customerId!: string;
  @Column({
    name: 'TargetGrossMarginOverride',
    type: 'numeric',
    precision: 5,
    scale: 2,
    nullable: true,
  })
  targetGrossMarginOverride!: string | null;
  @Column({
    name: 'WarningThresholdOverride',
    type: 'numeric',
    precision: 5,
    scale: 2,
    nullable: true,
  })
  warningThresholdOverride!: string | null;
  @Column({
    name: 'CriticalThresholdOverride',
    type: 'numeric',
    precision: 5,
    scale: 2,
    nullable: true,
  })
  criticalThresholdOverride!: string | null;
  @Column({ name: 'EffectiveFrom', type: 'timestamptz' }) effectiveFrom!: Date;
  @Column({ name: 'CreatedAt', type: 'timestamptz' }) createdAt!: Date;
}
