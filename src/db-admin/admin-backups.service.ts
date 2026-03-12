import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { promises as fs } from 'fs';
import { join, resolve } from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);
const BACKUP_FILE_REGEX = /^backup-\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.sql$/;
const TABLE_BACKUP_FILE_REGEX = /^table-backup-[a-zA-Z0-9_]+-[a-zA-Z0-9_]+-\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.sql$/;

export interface BackupFileInfo {
  name: string;
  size: number;
  createdAt: string;
}

@Injectable()
export class AdminBackupsService {
  private readonly backupsDir = resolve(process.cwd(), 'backups');
  private readonly tableBackupsDir = resolve(process.cwd(), 'table-backups');

  async createBackup() {
    await this.ensureBackupsDir();

    const fileName = this.buildBackupFileName();
    const filePath = join(this.backupsDir, fileName);

    await this.runPgDump(filePath);
    const deletedByRetention = await this.applyRetentionPolicy(
      this.backupsDir,
      BACKUP_FILE_REGEX,
    );
    const stat = await fs.stat(filePath);

    return {
      message: 'Backup generado correctamente.',
      fileName,
      size: stat.size,
      createdAt: (stat.birthtime ?? stat.ctime).toISOString(),
      deletedByRetention,
    };
  }

  async listBackups(): Promise<BackupFileInfo[]> {
    await this.ensureBackupsDir();
    return this.listBackupFiles(this.backupsDir, BACKUP_FILE_REGEX);
  }

  async createTableBackup(tableName: string) {
    const table = this.parseTableRef(tableName);
    await this.ensureTableBackupsDir();

    const fileName = this.buildTableBackupFileName(table.schema, table.table);
    const filePath = join(this.tableBackupsDir, fileName);

    await this.runPgDump(filePath, `${table.schema}.${table.table}`);
    const deletedByRetention = await this.applyRetentionPolicy(
      this.tableBackupsDir,
      TABLE_BACKUP_FILE_REGEX,
    );
    const stat = await fs.stat(filePath);

    return {
      message: 'Backup de tabla generado correctamente.',
      fileName,
      table: `${table.schema}.${table.table}`,
      size: stat.size,
      createdAt: (stat.birthtime ?? stat.ctime).toISOString(),
      deletedByRetention,
    };
  }

  async listTableBackups(): Promise<BackupFileInfo[]> {
    await this.ensureTableBackupsDir();
    return this.listBackupFiles(this.tableBackupsDir, TABLE_BACKUP_FILE_REGEX);
  }

  async restoreBackup(fileName: string) {
    if (!BACKUP_FILE_REGEX.test(fileName)) {
      throw new BadRequestException('Nombre de backup invalido.');
    }

    await this.ensureBackupsDir();
    const filePath = join(this.backupsDir, fileName);

    try {
      await fs.access(filePath);
    } catch {
      throw new NotFoundException('El backup seleccionado no existe.');
    }

    await this.runPsqlRestore(filePath);

    return {
      message: 'Restauracion ejecutada correctamente.',
      fileName,
    };
  }

  private async ensureBackupsDir() {
    await fs.mkdir(this.backupsDir, { recursive: true });
  }

  private async ensureTableBackupsDir() {
    await fs.mkdir(this.tableBackupsDir, { recursive: true });
  }

  private buildBackupFileName() {
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
    return `backup-${stamp}.sql`;
  }

  private buildTableBackupFileName(schema: string, table: string) {
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
    return `table-backup-${schema}-${table}-${stamp}.sql`;
  }

  private async runPgDump(filePath: string, table?: string) {
    const databaseUrl = this.resolveDatabaseUrl();
    const args = [
      `--dbname=${databaseUrl}`,
      '--format=plain',
      '--no-owner',
      '--no-privileges',
      '--clean',
      '--if-exists',
      `--file=${filePath}`,
    ];

    if (table) {
      args.push(`--table=${table}`);
    }

    try {
      await execFileAsync('pg_dump', args, { windowsHide: true });
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Error desconocido al ejecutar pg_dump.';
      if (this.isCommandNotFoundError(error)) {
        throw new InternalServerErrorException(
          'No se encontro pg_dump en el PATH. Instala PostgreSQL client tools.',
        );
      }
      throw new InternalServerErrorException(
        `No se pudo generar el backup: ${message}`,
      );
    }
  }

  private async runPsqlRestore(filePath: string) {
    const databaseUrl = this.resolveDatabaseUrl();

    try {
      await execFileAsync(
        'psql',
        [`--dbname=${databaseUrl}`, `--file=${filePath}`],
        { windowsHide: true },
      );
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Error desconocido al ejecutar psql.';
      if (this.isCommandNotFoundError(error)) {
        throw new InternalServerErrorException(
          'No se encontro psql en el PATH. Instala PostgreSQL client tools.',
        );
      }
      throw new InternalServerErrorException(
        `No se pudo restaurar el backup: ${message}`,
      );
    }
  }

  private async applyRetentionPolicy(
    targetDir: string,
    namePattern: RegExp,
  ) {
    const cutoffMs = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const entries = await fs.readdir(targetDir, { withFileTypes: true });
    let deletedCount = 0;

    for (const entry of entries) {
      if (!entry.isFile() || !namePattern.test(entry.name)) {
        continue;
      }

      const fullPath = join(targetDir, entry.name);
      const stat = await fs.stat(fullPath);
      if (stat.mtimeMs < cutoffMs) {
        await fs.unlink(fullPath);
        deletedCount += 1;
      }
    }

    return deletedCount;
  }

  private resolveDatabaseUrl() {
    if (process.env.DATABASE_URL) {
      return process.env.DATABASE_URL;
    }

    const host = process.env.DATABASE_HOST;
    const port = process.env.DATABASE_PORT ?? '5432';
    const user = process.env.DATABASE_USER;
    const pass = process.env.DATABASE_PASS;
    const name = process.env.DATABASE_NAME;

    if (!host || !user || !pass || !name) {
      throw new InternalServerErrorException(
        'Falta DATABASE_URL y no se pudo construir con DATABASE_HOST/PORT/USER/PASS/NAME.',
      );
    }

    const encodedUser = encodeURIComponent(user);
    const encodedPass = encodeURIComponent(pass);

    return `postgresql://${encodedUser}:${encodedPass}@${host}:${port}/${name}`;
  }

  private isCommandNotFoundError(error: unknown) {
    if (!error || typeof error !== 'object') return false;
    const candidate = error as { code?: unknown };
    return candidate.code === 'ENOENT';
  }

  private parseTableRef(raw: string) {
    if (!raw || typeof raw !== 'string') {
      throw new BadRequestException('Debe enviar tableName.');
    }

    const trimmed = raw.trim();
    const [schemaPart, tablePart] = trimmed.includes('.')
      ? trimmed.split('.', 2)
      : ['public', trimmed];

    const schema = this.assertIdentifier(schemaPart);
    const table = this.assertIdentifier(tablePart);
    return { schema, table };
  }

  private assertIdentifier(value: string) {
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(value)) {
      throw new BadRequestException(`Identificador invalido: ${value}`);
    }
    return value;
  }

  private async listBackupFiles(
    targetDir: string,
    namePattern: RegExp,
  ): Promise<BackupFileInfo[]> {
    const entries = await fs.readdir(targetDir, { withFileTypes: true });
    const files = entries.filter(
      (entry) =>
        entry.isFile() &&
        entry.name.endsWith('.sql') &&
        namePattern.test(entry.name),
    );

    const result: BackupFileInfo[] = [];
    for (const file of files) {
      const fullPath = join(targetDir, file.name);
      const stat = await fs.stat(fullPath);
      result.push({
        name: file.name,
        size: stat.size,
        createdAt: (stat.birthtime ?? stat.ctime).toISOString(),
      });
    }

    return result.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  }
}
