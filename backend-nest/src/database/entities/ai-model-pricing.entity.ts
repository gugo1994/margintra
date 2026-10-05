import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { AiProvider, PricingSourceType, PricingStatus } from '../../common/enums/domain.enums';

@Entity('ai_model_pricing')
@Index(['provider', 'model', 'version'], { unique: true })
@Index('IDX_ai_model_pricing_active_range', ['provider', 'model', 'effectiveFrom'], {
  where: '"Status"=\'active\'',
})
export class AiModelPricingEntity {
  @PrimaryGeneratedColumn('uuid', { name: 'Id' }) id!: string;
  @Column({ name: 'Provider', length: 100 }) provider!: AiProvider;
  @Column({ name: 'Model', length: 200 }) model!: string;
  @Column({ name: 'PricingModel', length: 200 }) pricingModel!: string;
  @Column({ name: 'InputPricePerMillion', type: 'numeric', precision: 18, scale: 8 })
  inputPricePerMillion!: string;
  @Column({ name: 'OutputPricePerMillion', type: 'numeric', precision: 18, scale: 8 })
  outputPricePerMillion!: string;
  @Column({ name: 'Currency', length: 3 }) currency!: string;
  @Column({ name: 'EffectiveFrom', type: 'timestamptz' }) effectiveFrom!: Date;
  @Column({ name: 'EffectiveTo', type: 'timestamptz', nullable: true }) effectiveTo!: Date | null;
  @Column({ name: 'Version', length: 100 }) version!: string;
  @Column({ name: 'SourceType', length: 30 }) sourceType!: PricingSourceType;
  @Column({ name: 'SourceReference', type: 'varchar', length: 500, nullable: true })
  sourceReference!: string | null;
  @Column({ name: 'Status', length: 20 }) status!: PricingStatus;
  @Column({ name: 'LastVerifiedAt', type: 'timestamptz', nullable: true })
  lastVerifiedAt!: Date | null;
  @Column({ name: 'OperatorSource', type: 'varchar', length: 100, nullable: true })
  operatorSource!: string | null;
  @Column({ name: 'CreatedBy', type: 'varchar', length: 100, nullable: true })
  createdBy!: string | null;
  @Column({ name: 'ActivatedBy', type: 'varchar', length: 100, nullable: true })
  activatedBy!: string | null;
  @Column({ name: 'RetiredBy', type: 'varchar', length: 100, nullable: true })
  retiredBy!: string | null;
  @Column({ name: 'ActivatedAt', type: 'timestamptz', nullable: true })
  activatedAt!: Date | null;
  @Column({ name: 'RetiredAt', type: 'timestamptz', nullable: true })
  retiredAt!: Date | null;
  @Column({ name: 'CreatedAt', type: 'timestamptz' }) createdAt!: Date;
  @Column({ name: 'UpdatedAt', type: 'timestamptz' }) updatedAt!: Date;
}
