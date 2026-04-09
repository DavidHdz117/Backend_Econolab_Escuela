import { Type } from 'class-transformer';
import { IsBoolean } from 'class-validator';

export class UpdateStudyDetailStatusDto {
  @Type(() => Boolean)
  @IsBoolean({ message: 'El estatus del detalle es invalido.' })
  isActive: boolean;
}
