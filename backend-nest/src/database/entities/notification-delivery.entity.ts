import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('notification_deliveries')
@Index(['organizationId', 'alertId', 'channel', 'recipient', 'transition'], { unique: true })
@Index('IDX_notification_pending_due', ['nextAttemptAt', 'createdAt'], {
  where: '"Status"=\'pending\'',
})
@Index('IDX_notification_stale_claim', ['lastAttemptAt'], { where: '"Status"=\'processing\'' })
export class NotificationDeliveryEntity {
  @PrimaryGeneratedColumn('uuid', { name: 'Id' }) id!: string;
  @Column({ name: 'OrganizationId', type: 'uuid' }) organizationId!: string;
  @Column({ name: 'AlertId', type: 'uuid' }) alertId!: string;
  @Column({ name: 'Channel', length: 20 }) channel!: string;
  @Column({ name: 'Recipient', length: 320 }) recipient!: string;
  @Column({ name: 'Transition', length: 40 }) transition!: string;
  @Column({ name: 'Status', length: 20 }) status!: string;
  @Column({ name: 'AttemptCount' }) attemptCount!: number;
  @Column({ name: 'LastAttemptAt', type: 'timestamptz', nullable: true })
  lastAttemptAt!: Date | null;
  @Column({ name: 'NextAttemptAt', type: 'timestamptz', nullable: true })
  nextAttemptAt!: Date | null;
  @Column({ name: 'SentAt', type: 'timestamptz', nullable: true }) sentAt!: Date | null;
  @Column({ name: 'FailureReason', type: 'varchar', length: 300, nullable: true }) failureReason!:
    string | null;
  @Column({ name: 'CreatedAt', type: 'timestamptz' }) createdAt!: Date;
}
