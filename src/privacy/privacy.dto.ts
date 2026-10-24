import {
  Equals,
  IsBoolean,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { Transform } from 'class-transformer';

export class PrivacyPreferencesDto {
  @IsOptional()
  @IsBoolean()
  @Transform(({ obj, key }) => (obj as Record<string, unknown>)[key])
  consent?: boolean;
  @IsOptional() @IsString() @MaxLength(40) noticeVersion?: string;
  @IsOptional()
  @IsBoolean()
  @Transform(({ obj, key }) => (obj as Record<string, unknown>)[key])
  optionalCommunications?: boolean;
  @IsOptional()
  @IsBoolean()
  @Transform(({ obj, key }) => (obj as Record<string, unknown>)[key])
  optionalAnalytics?: boolean;
}

export class DeleteOwnAccountDto {
  @IsString() @MinLength(8) @MaxLength(128) currentPassword: string;
  @Equals('ELIMINAR MI CUENTA') confirmation: string;
}
