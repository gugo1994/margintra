import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { StripeConnectionStatus } from '../../common/enums/domain.enums';
@Entity('stripe_connections')
export class StripeConnectionEntity {
  @PrimaryGeneratedColumn('uuid', { name: 'Id' }) id!: string;
  @Index({ unique: true })
  @Column({ name: 'OrganizationId', type: 'uuid' })
  organizationId!: string;
  @Index({ unique: true })
  @Column({ name: 'PublicIdentifier', type: 'uuid' })
  publicIdentifier!: string;
  @Column({ name: 'StripeAccountId', type: 'varchar', length: 100, nullable: true })
  stripeAccountId!: string | null;
  @Column({ name: 'EncryptedSecretKey', type: 'varchar', length: 4096, nullable: true })
  encryptedSecretKey!: string | null;
  @Column({ name: 'EncryptedWebhookSecret', type: 'varchar', length: 4096, nullable: true })
  encryptedWebhookSecret!: string | null;
  @Column({ name: 'LiveMode' }) liveMode!: boolean;
  @Column({ name: 'Status', length: 30 }) status!: StripeConnectionStatus;
  @Column({ name: 'LastSyncAt', type: 'timestamptz', nullable: true }) lastSyncAt!: Date | null;
  @Column({ name: 'ActiveSyncAttemptToken', type: 'uuid', nullable: true })
  activeSyncAttemptToken!: string | null;
  @Column({ name: 'LastSuccessfulSyncAt', type: 'timestamptz', nullable: true })
  lastSuccessfulSyncAt!: Date | null;
  @Column({ name: 'LastError', type: 'varchar', length: 500, nullable: true }) lastError!:
    string | null;
  @Column({ name: 'CreatedAt', type: 'timestamptz' }) createdAt!: Date;
  @Column({ name: 'UpdatedAt', type: 'timestamptz' }) updatedAt!: Date;
}
