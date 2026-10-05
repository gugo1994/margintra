import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { IngestionApiKeyStatus } from '../../common/enums/domain.enums';

@Entity('ingestion_api_keys')
@Index(['keyId'], { unique: true })
@Index(['organizationId', 'createdAt'])
export class IngestionApiKeyEntity {
  @PrimaryGeneratedColumn('uuid', { name: 'Id' }) id!: string;
  @Column({ name: 'OrganizationId', type: 'uuid' }) organizationId!: string;
  @Column({ name: 'Name', length: 100 }) name!: string;
  @Column({ name: 'KeyId', length: 24 }) keyId!: string;
  @Column({ name: 'KeyPrefix', length: 40 }) keyPrefix!: string;
  @Column({ name: 'SecretHash', length: 200 }) secretHash!: string;
  @Column({ name: 'Status', length: 20 }) status!: IngestionApiKeyStatus;
  @Column({ name: 'CreatedAt', type: 'timestamptz' }) createdAt!: Date;
  @Column({ name: 'RevokedAt', type: 'timestamptz', nullable: true }) revokedAt!: Date | null;
  @Column({ name: 'LastUsedAt', type: 'timestamptz', nullable: true }) lastUsedAt!: Date | null;
}
