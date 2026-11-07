import {
  IsBoolean,
  IsInt,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { Transform } from 'class-transformer';
export class CatalogDto {
  @IsString() @MinLength(2) @MaxLength(80) name: string;
  @IsString() @MaxLength(240) description: string;
  @IsInt() @Min(0) @Max(10000000) priceCents: number;
}
export class ActiveDto {
  @IsBoolean()
  @Transform(({ obj, key }) => (obj as Record<string, unknown>)[key])
  active: boolean;
}
export class ActivityDto {
  @IsInt() @Min(1) itemId: number;
  @IsInt() @Min(1) @Max(1000) quantity: number;
  @IsString() @MaxLength(10) date: string;
}
