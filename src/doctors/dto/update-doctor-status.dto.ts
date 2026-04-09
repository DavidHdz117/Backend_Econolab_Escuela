import { Type } from 'class-transformer';
import { IsBoolean } from 'class-validator';

export class UpdateDoctorStatusDto {
  @Type(() => Boolean)
  @IsBoolean({ message: 'El estatus del medico es invalido.' })
  isActive: boolean;
}
