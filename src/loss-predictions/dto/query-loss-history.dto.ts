import { Type } from 'class-transformer';
import {
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class QueryLossHistoryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'studyId debe ser entero.' })
  studyId?: number;

  @IsOptional()
  @IsString({ message: 'supplyName debe ser una cadena.' })
  @MaxLength(150, { message: 'supplyName no puede exceder 150 caracteres.' })
  supplyName?: string;

  @IsOptional()
  @IsDateString({}, { message: 'fromDate debe ser una fecha valida.' })
  fromDate?: string;

  @IsOptional()
  @IsDateString({}, { message: 'toDate debe ser una fecha valida.' })
  toDate?: string;
}
