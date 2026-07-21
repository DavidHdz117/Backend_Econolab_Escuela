import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsInt,
  Min,
} from 'class-validator';

export class BatchPredictServiceOutcomeDto {
  @IsArray({ message: 'Los identificadores deben venir en un arreglo.' })
  @ArrayMinSize(1, { message: 'Incluye al menos una orden.' })
  @ArrayMaxSize(1000, {
    message: 'Solo se permiten hasta 1000 ordenes por lote.',
  })
  @ArrayUnique({ message: 'Los identificadores de orden no deben repetirse.' })
  @Type(() => Number)
  @IsInt({ each: true, message: 'Cada identificador debe ser un entero.' })
  @Min(1, { each: true, message: 'Cada identificador debe ser positivo.' })
  serviceIds: number[];
}
