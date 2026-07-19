import { Transform, TransformFnParams } from 'class-transformer';
import { IsString, Length } from 'class-validator';

export class UpdateStudyClusterProfileDto {
  @Transform(({ value }: TransformFnParams): unknown =>
    typeof value === 'string'
      ? value.trim().replace(/\s+/g, ' ')
      : (value as unknown),
  )
  @IsString({ message: 'El nombre visible debe ser texto.' })
  @Length(3, 150, {
    message: 'El nombre visible debe tener entre 3 y 150 caracteres.',
  })
  displayName: string;
}
