import { Type } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { AiProvider } from '../../../common/enums/domain.enums';
import { INGESTION_LIMITS } from '../constants/ingestion.constants';

export class TokenUsageDto {
  @IsInt() @Min(0) @Max(INGESTION_LIMITS.tokens) inputTokens!: number;
  @IsInt() @Min(0) @Max(INGESTION_LIMITS.tokens) outputTokens!: number;
}
export class ProductionUsageDto {
  @IsString() @Length(1, INGESTION_LIMITS.externalRequestId) externalRequestId!: string;
  @IsString() @Length(1, INGESTION_LIMITS.externalCustomerId) customerId!: string;
  @IsEnum(AiProvider) provider!: AiProvider;
  @IsString() @Length(1, INGESTION_LIMITS.model) model!: string;
  @IsOptional() @IsString() @Length(1, INGESTION_LIMITS.feature) feature?: string;
  @ValidateNested() @Type(() => TokenUsageDto) usage!: TokenUsageDto;
  @IsOptional() @Matches(/^(0|[1-9]\d*)(\.\d{1,6})?$/) cost?: string;
  @ValidateIf((x: ProductionUsageDto) => x.cost !== undefined) @Matches(/^USD$/) currency?: string;
  @IsDateString() occurredAt!: string;
  @IsOptional() @IsObject() metadata?: Record<string, unknown>;
}
