import {
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
} from 'class-validator';
import { AiProvider, PricingSourceType } from '../../../common/enums/domain.enums';

const monetaryRate = /^(0|[1-9]\d*)(\.\d{1,8})?$/;

export class CreateVerifiedPricingCandidateDto {
  @IsEnum(AiProvider) provider!: AiProvider;
  @IsString() @Length(1, 200) model!: string;
  @IsOptional() @IsString() @Length(1, 200) canonicalModel?: string;
  @Length(1, 19) @Matches(monetaryRate) inputPricePerMillion!: string;
  @Length(1, 19) @Matches(monetaryRate) outputPricePerMillion!: string;
  @Matches(/^[A-Z]{3}$/) currency!: string;
  @IsDateString() effectiveFrom!: string;
  @IsEnum(PricingSourceType) sourceType!: PricingSourceType;
  @IsOptional() @IsString() @Length(1, 500) sourceReference?: string;
  @IsString() @Length(1, 100) operatorSource!: string;
}

export class PricingVersionActionDto {
  @IsUUID() id!: string;
  @IsString() @Length(1, 100) operatorSource!: string;
}
