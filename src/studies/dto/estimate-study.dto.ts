import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsBoolean,
  Length,
  Max,
  Min,
} from 'class-validator';
import { StudySampleType, StudyType } from '../entities/study.entity';

/** Datos que el formulario envia al modelo antes de registrar el estudio. */
export class EstimateStudyDto {
  @IsEnum(StudyType, {
    message: 'El tipo de estudio es invalido.',
  })
  type: StudyType;

  @Type(() => Number)
  @IsInt({ message: 'El numero de parametros debe ser un entero.' })
  @Min(0, { message: 'El numero de parametros no puede ser negativo.' })
  @Max(500, { message: 'El numero de parametros no puede exceder 500.' })
  parameterCount: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'La duracion debe ser un entero de minutos.' })
  @Min(1, { message: 'La duracion minima es de 1 minuto.' })
  @Max(10080, { message: 'La duracion no puede exceder 10080 minutos.' })
  durationMinutes?: number;

  @IsOptional()
  @IsString({ message: 'El metodo debe ser texto.' })
  @Length(0, 150, { message: 'El metodo no puede exceder 150 caracteres.' })
  method?: string;

  @IsOptional()
  @IsEnum(StudySampleType, {
    message: 'El tipo de muestra es invalido.',
  })
  sampleType?: StudySampleType;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean({ message: 'El procesamiento especial debe ser booleano.' })
  requiresSpecialProcessing?: boolean;
}
