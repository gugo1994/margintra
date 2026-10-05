import { IsNumber, IsOptional, Max, Min } from 'class-validator';
export class UpdateMarginSettingsDto {
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) @Max(99.99) targetGrossMargin!: number;
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(99.99)
  warningThreshold?: number;
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(100)
  criticalThreshold?: number;
}
