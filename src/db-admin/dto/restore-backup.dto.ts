import { IsString, Matches } from 'class-validator';

export class RestoreBackupDto {
  @IsString({ message: 'fileName debe ser una cadena de texto.' })
  @Matches(/^backup-\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.sql$/, {
    message: 'fileName invalido. Usa un respaldo generado por el sistema.',
  })
  fileName: string;
}
