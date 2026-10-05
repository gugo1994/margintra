import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
@Entity('users')
export class UserEntity {
  @PrimaryGeneratedColumn('uuid', { name: 'Id' }) id!: string;
  @Index({ unique: true }) @Column({ name: 'Email', length: 320 }) email!: string;
  @Column({ name: 'PasswordHash', length: 200 }) passwordHash!: string;
  @Column({ name: 'CreatedAt', type: 'timestamptz' }) createdAt!: Date;
  @Column({ name: 'UpdatedAt', type: 'timestamptz' }) updatedAt!: Date;
}
