import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
} from 'class-validator';
import { StudyType } from '../entities/study.entity';

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
  @IsString({ message: 'El metodo debe ser texto.' })
  @Length(0, 150, { message: 'El metodo no puede exceder 150 caracteres.' })
  method?: string;
}
