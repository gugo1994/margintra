import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { AlertSeverity, MarginAlertType } from '../../common/enums/domain.enums';
@Entity('margin_alerts')
@Index(['organizationId', 'customerId', 'type'], { unique: true, where: '"ResolvedAt" IS NULL' })
export class MarginAlertEntity {
  @PrimaryGeneratedColumn('uuid', { name: 'Id' }) id!: string;
  @Column({ name: 'OrganizationId', type: 'uuid' }) organizationId!: string;
  @Column({ name: 'CustomerId', type: 'uuid' }) customerId!: string;
  @Column({ name: 'Type', length: 40 }) type!: MarginAlertType;
  @Column({ name: 'Severity', length: 20 }) severity!: AlertSeverity;
  @Column({ name: 'Message', length: 500 }) message!: string;
  @Column({ name: 'MetadataJson', type: 'jsonb' }) metadataJson!: string;
  @Column({ name: 'ResolvedAt', type: 'timestamptz', nullable: true }) resolvedAt!: Date | null;
  @Column({ name: 'CreatedAt', type: 'timestamptz' }) createdAt!: Date;
}
