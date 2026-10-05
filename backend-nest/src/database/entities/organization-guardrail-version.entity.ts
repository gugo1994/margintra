import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('organization_guardrail_versions')
@Index(['organizationId', 'effectiveFrom'], { unique: true })
export class OrganizationGuardrailVersionEntity {
  @PrimaryGeneratedColumn('uuid', { name: 'Id' }) id!: string;
  @Column({ name: 'OrganizationId', type: 'uuid' }) organizationId!: string;
  @Column({ name: 'TargetGrossMargin', type: 'numeric', precision: 5, scale: 2 })
  targetGrossMargin!: string;
  @Column({ name: 'WarningThreshold', type: 'numeric', precision: 5, scale: 2 })
  warningThreshold!: string;
  @Column({ name: 'CriticalThreshold', type: 'numeric', precision: 5, scale: 2 })
  criticalThreshold!: string;
  @Column({ name: 'EffectiveFrom', type: 'timestamptz' }) effectiveFrom!: Date;
  @Column({ name: 'CreatedAt', type: 'timestamptz' }) createdAt!: Date;
}
