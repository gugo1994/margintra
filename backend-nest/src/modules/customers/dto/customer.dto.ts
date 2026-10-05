import {
  IsEmail,
  IsISO4217CurrencyCode,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
export class CreateCustomerDto {
  @IsString() @Length(1, 200) externalCustomerId!: string;
  @IsString() @Length(1, 200) name!: string;
  @IsOptional() @IsEmail() @MaxLength(320) email?: string | null;
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) monthlyRevenue!: number;
  @IsISO4217CurrencyCode() currency = 'USD';
}
export class UpdateCustomerDto extends CreateCustomerDto {}
export class UpdateCustomerGuardrailsDto {
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(99.99)
  targetGrossMargin?: number | null;
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(99.99)
  warningThreshold?: number | null;
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(100)
  criticalThreshold?: number | null;
}
