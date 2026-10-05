import { Transform } from 'class-transformer';
import { IsEmail, IsString, Length, MaxLength } from 'class-validator';
const normalizeEmail = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;
export class RegisterDto {
  @Transform(normalizeEmail) @IsEmail() @MaxLength(320) email!: string;
  @IsString() @Length(8, 128) password!: string;
  @IsString() @Length(1, 200) organizationName!: string;
}
export class LoginDto {
  @Transform(normalizeEmail) @IsEmail() @MaxLength(320) email!: string;
  @IsString() @Length(1, 128) password!: string;
}
export interface AuthResponseDto {
  accessToken: string;
  expiresAt: string;
  userId: string;
  organizationId: string;
  email: string;
}
