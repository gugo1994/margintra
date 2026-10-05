import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('notification_preferences')
export class NotificationPreferenceEntity {
  @PrimaryGeneratedColumn('uuid', { name: 'Id' }) id!: string;
  @Index({ unique: true })
  @Column({ name: 'OrganizationId', type: 'uuid' })
  organizationId!: string;
  @Column({ name: 'EmailEnabled' }) emailEnabled!: boolean;
  @Column({ name: 'WarningAlertsEnabled' }) warningAlertsEnabled!: boolean;
  @Column({ name: 'CriticalAlertsEnabled' }) criticalAlertsEnabled!: boolean;
  @Column({ name: 'RecoveryAlertsEnabled' }) recoveryAlertsEnabled!: boolean;
  @Column({ name: 'Recipients', type: 'jsonb' }) recipients!: string[];
  @Column({ name: 'CreatedAt', type: 'timestamptz' }) createdAt!: Date;
  @Column({ name: 'UpdatedAt', type: 'timestamptz' }) updatedAt!: Date;
}
