import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { IsNotInFutureDate } from 'src/common/validators/is-not-in-future-date.validator';
import { ServiceStatus } from '../entities/service-order.entity';
import { CreateServiceItemDto } from './service-item.dto';

export class CreateServiceDto {
  @IsOptional()
  @IsString({ message: 'El folio debe ser una cadena de texto.' })
  @IsNotEmpty({ message: 'El folio no puede estar vacio.' })
  folio?: string;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean({ message: 'La bandera de folio automatico es invalida.' })
  autoGenerateFolio?: boolean;

  @Type(() => Number)
  @IsInt({
    message: 'El identificador del paciente debe ser un numero entero.',
  })
  patientId: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'El identificador del medico debe ser un numero entero.' })
  doctorId?: number;

  @IsOptional()
  @IsString({ message: 'La sucursal debe ser una cadena de texto.' })
  branchName?: string;

  @IsOptional()
  @IsDateString({}, { message: 'La fecha/hora de toma de muestra no es valida.' })
  @IsNotInFutureDate({
    message: 'La fecha/hora de toma de muestra no puede estar en el futuro.',
  })
  sampleAt?: string;

  @IsOptional()
  @IsDateString({}, { message: 'La fecha/hora de entrega no es valida.' })
  deliveryAt?: string;

  @IsOptional()
  @IsEnum(ServiceStatus, {
    message:
      'El estatus es invalido. Valores permitidos: pending, in_progress, delayed, completed, cancelled.',
  })
  status?: ServiceStatus;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({}, { message: 'El porcentaje de cortesia debe ser numerico.' })
  @Min(0, { message: 'La cortesia no puede ser negativa.' })
  @Max(100, { message: 'La cortesia no puede ser mayor a 100.' })
  courtesyPercent?: number;

  @IsOptional()
  @IsString({ message: 'Las notas deben ser una cadena de texto.' })
  notes?: string;
  @IsArray({ message: 'Los estudios deben venir en un arreglo.' })
  @ValidateNested({ each: true })
  @Type(() => CreateServiceItemDto)
  items: CreateServiceItemDto[];
}
