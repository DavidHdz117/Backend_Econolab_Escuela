import { Type } from 'class-transformer';
import { IsBoolean } from 'class-validator';

export class UpdatePatientStatusDto {
  @Type(() => Boolean)
  @IsBoolean({ message: 'El estatus del paciente es invalido.' })
  isActive: boolean;
}
