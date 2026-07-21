import { Type } from 'class-transformer';
import {
  IsArray,
  IsDateString,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { CreateServiceItemDto } from './service-item.dto';

/**
 * Datos que ya conoce el formulario antes de registrar una orden.
 * El estado real y las fechas posteriores no forman parte de la inferencia.
 */
export class PredictServiceOutcomeDto {
  @IsOptional()
  @IsString({ message: 'La sucursal debe ser una cadena de texto.' })
  @MaxLength(150, { message: 'La sucursal no puede exceder 150 caracteres.' })
  branchName?: string;

  @IsOptional()
  @IsDateString({}, { message: 'La fecha/hora de muestra no es valida.' })
  sampleAt?: string;

  @IsDateString({}, { message: 'La fecha/hora de entrega no es valida.' })
  deliveryAt: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({}, { message: 'El porcentaje de cortesia debe ser numerico.' })
  @Min(0, { message: 'La cortesia no puede ser negativa.' })
  @Max(100, { message: 'La cortesia no puede ser mayor a 100.' })
  courtesyPercent?: number;

  @IsArray({ message: 'Los estudios deben venir en un arreglo.' })
  @ValidateNested({ each: true })
  @Type(() => CreateServiceItemDto)
  items: CreateServiceItemDto[];
}
