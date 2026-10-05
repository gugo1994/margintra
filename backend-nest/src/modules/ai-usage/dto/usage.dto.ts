import { IsDateString, IsNumber, IsString, IsUUID, Length, Max, Min } from 'class-validator';
export class IngestUsageDto {
  @IsUUID() customerId!: string;
  @IsString() @Length(1, 100) provider!: string;
  @IsString() @Length(1, 200) model!: string;
  @IsString() @Length(1, 200) feature!: string;
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(0)
  @Max(Number.MAX_SAFE_INTEGER)
  inputTokens!: number;
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(0)
  @Max(Number.MAX_SAFE_INTEGER)
  outputTokens!: number;
  @IsNumber({ maxDecimalPlaces: 6 }) @Min(0) cost!: number;
  @IsString() @Length(1, 300) externalRequestId!: string;
  @IsDateString() occurredAt!: string;
}
