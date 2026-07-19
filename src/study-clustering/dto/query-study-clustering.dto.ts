import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, Max, Min } from 'class-validator';

export class QueryStudyClusteringDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(24)
  periodMonths = 6;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(2)
  @Max(6)
  maxK = 6;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(2)
  @Max(6)
  requestedK?: number;

  @IsOptional()
  @Transform(({ value }) => {
    const candidate = value as unknown;
    if (candidate === true || candidate === 'true') return true;
    if (candidate === false || candidate === 'false') return false;
    return candidate;
  })
  @IsBoolean()
  includeSynthetic = false;
}
