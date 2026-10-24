import { IsString, Matches, MaxLength } from 'class-validator';

export class RefreshDto {
  @IsString()
  @MaxLength(100)
  @Matches(/^[0-9a-f-]{36}\.[A-Za-z0-9_-]{43}$/)
  refreshToken: string;
}
