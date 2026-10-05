import { IsOptional, IsString, Length, Matches } from 'class-validator';
export class ConnectStripeDto {
  @IsString() @Length(1, 512) @Matches(/^(sk|rk)_/) secretKey!: string;
  @IsOptional() @IsString() @Length(1, 512) @Matches(/^whsec_/) webhookSecret?: string | null;
}
export class UpdateStripeWebhookSecretDto {
  @IsString() @Length(1, 512) @Matches(/^whsec_/) webhookSecret!: string;
}
