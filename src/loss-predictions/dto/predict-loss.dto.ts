import { Type } from 'class-transformer';
import {
  IsDateString,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class PredictLossDto {
  @Type(() => Number)
  @IsInt({ message: 'studyId debe ser entero.' })
  studyId: number;

  @IsString({ message: 'supplyName debe ser una cadena.' })
  @IsNotEmpty({ message: 'supplyName es obligatorio.' })
  @MaxLength(150, { message: 'supplyName no puede exceder 150 caracteres.' })
  supplyName: string;

  @IsOptional()
  @IsDateString({}, { message: 'fromDate debe ser una fecha valida.' })
  fromDate?: string;

  @IsOptional()
  @IsDateString({}, { message: 'toDate debe ser una fecha valida.' })
  toDate?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'monthsAhead debe ser entero.' })
  @Min(1, { message: 'monthsAhead debe ser al menos 1.' })
  @Max(24, { message: 'monthsAhead no puede exceder 24.' })
  monthsAhead?: number;
}
