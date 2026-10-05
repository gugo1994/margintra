import { ArrayMaxSize, IsArray, IsBoolean, IsEmail } from 'class-validator';
export class UpdateNotificationPreferencesDto {
  @IsBoolean() emailEnabled!: boolean;
  @IsBoolean() warningAlertsEnabled!: boolean;
  @IsBoolean() criticalAlertsEnabled!: boolean;
  @IsBoolean() recoveryAlertsEnabled!: boolean;
  @IsArray() @ArrayMaxSize(10) @IsEmail({}, { each: true }) recipients!: string[];
}
