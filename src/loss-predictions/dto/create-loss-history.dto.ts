import { Type } from 'class-transformer';
import {
  IsDateString,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import { IsNotInFutureDate } from 'src/common/validators/is-not-in-future-date.validator';

export class CreateLossHistoryDto {
  @IsDateString({}, { message: 'date debe ser una fecha valida.' })
  @IsNotInFutureDate({
    message: 'date no puede estar en el futuro.',
  })
  date: string;

  @Type(() => Number)
  @IsInt({ message: 'studyId debe ser entero.' })
  studyId: number;

  @IsString({ message: 'supplyName debe ser una cadena.' })
  @IsNotEmpty({ message: 'supplyName es obligatorio.' })
  @MaxLength(150, { message: 'supplyName no puede exceder 150 caracteres.' })
  supplyName: string;

  @Type(() => Number)
  @IsNumber({}, { message: 'quantityLoss debe ser numerico.' })
  @Min(0.0001, { message: 'quantityLoss debe ser mayor a cero.' })
  quantityLoss: number;

  @IsOptional()
  @IsString({ message: 'notes debe ser una cadena.' })
  @MaxLength(500, { message: 'notes no puede exceder 500 caracteres.' })
  notes?: string;
}
