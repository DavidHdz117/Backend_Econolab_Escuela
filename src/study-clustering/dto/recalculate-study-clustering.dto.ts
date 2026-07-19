import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

/** Opciones del proceso interno que genera y persiste una nueva ejecucion. */
export class RecalculateStudyClusteringDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'El periodo debe ser un numero entero de meses.' })
  @Min(1, { message: 'El periodo minimo es de 1 mes.' })
  @Max(24, { message: 'El periodo maximo es de 24 meses.' })
  periodMonths?: number;
}
