import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsString,
  Matches,
  Max,
  Min,
} from 'class-validator';

export class UpdateBackupAutomationDto {
  @IsBoolean({ message: 'enabled debe ser booleano.' })
  enabled: boolean;

  @IsString({ message: 'time debe ser una cadena.' })
  @Matches(/^(?:[01]\d|2[0-3]):[0-5]\d$/, {
    message: 'time debe usar formato HH:mm.',
  })
  time: string;

  @Type(() => Number)
  @IsInt({ message: 'intervalDays debe ser entero.' })
  @Min(1, { message: 'intervalDays debe ser al menos 1.' })
  @Max(90, { message: 'intervalDays no puede exceder 90.' })
  intervalDays: number;

  @Type(() => Number)
  @IsInt({ message: 'retentionDays debe ser entero.' })
  @Min(1, { message: 'retentionDays debe ser al menos 1.' })
  @Max(30, { message: 'retentionDays no puede exceder 30.' })
  retentionDays: number;

  @Type(() => Number)
  @IsInt({ message: 'parallelJobs debe ser entero.' })
  @Min(1, { message: 'parallelJobs debe ser al menos 1.' })
  @Max(4, { message: 'parallelJobs no puede exceder 4.' })
  parallelJobs: number;
}
