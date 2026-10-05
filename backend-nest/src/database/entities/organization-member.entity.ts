import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { OrganizationRole } from '../../common/enums/domain.enums';
@Entity('organization_members')
@Index(['organizationId', 'userId'], { unique: true })
export class OrganizationMemberEntity {
  @PrimaryGeneratedColumn('uuid', { name: 'Id' }) id!: string;
  @Column({ name: 'OrganizationId', type: 'uuid' }) organizationId!: string;
  @Column({ name: 'UserId', type: 'uuid' }) userId!: string;
  @Column({ name: 'Role', type: 'varchar', length: 20 }) role!: OrganizationRole;
  @Column({ name: 'CreatedAt', type: 'timestamptz' }) createdAt!: Date;
}
