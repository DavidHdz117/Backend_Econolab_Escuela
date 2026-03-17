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
const BACKUP_FILE_REGEX = /^backup-\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.tar$/;
const TABLE_BACKUP_FILE_REGEX = /^table-backup-[a-zA-Z0-9_]+-[a-zA-Z0-9_]+-\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.tar$/;

export interface BackupFileInfo {
  name: string;
  size: number;
  createdAt: string;
}

export type BackupJobType = 'database' | 'table';
export type BackupJobStatus = 'queued' | 'running' | 'completed' | 'failed';

export interface BackupJobInfo {
  id: string;
  type: BackupJobType;
  status: BackupJobStatus;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  fileName: string | null;
  tableName: string | null;
  error: string | null;
}

@Injectable()
export class AdminBackupsService {
  private readonly backupsDir = resolve(process.cwd(), 'backups');
  private readonly tableBackupsDir = resolve(process.cwd(), 'table-backups');
  private readonly jobs = new Map<string, BackupJobInfo>();
  private backupQueue: Promise<void> = Promise.resolve();

  async createBackup() {
    await this.ensureBackupsDir();
    const job = this.createJob('database', null);

    this.enqueueBackupWork(async () => {
      try {
        const fileName = this.buildBackupFileName();
        const filePath = join(this.backupsDir, fileName);

        this.markJobRunning(job.id);
        await this.runPgDump(filePath);
        await this.applyRetentionPolicy(this.backupsDir, BACKUP_FILE_REGEX);
        this.markJobCompleted(job.id, fileName);
      } catch (error) {
        this.markJobFailed(job.id, error);
      }
    });

    return {
      message: 'Backup agregado a la cola y ejecutandose en segundo plano.',
      job,
    };
  }

  async listBackups(): Promise<BackupFileInfo[]> {
    await this.ensureBackupsDir();
    return this.listBackupFiles(this.backupsDir, BACKUP_FILE_REGEX);
  }

  async createTableBackup(tableName: string) {
    const table = this.parseTableRef(tableName);
    await this.ensureTableBackupsDir();
    const qualifiedTable = `${table.schema}.${table.table}`;
    const job = this.createJob('table', qualifiedTable);

    this.enqueueBackupWork(async () => {
      try {
        const fileName = this.buildTableBackupFileName(table.schema, table.table);
        const filePath = join(this.tableBackupsDir, fileName);

        this.markJobRunning(job.id);
        await this.runPgDump(filePath, qualifiedTable);
        await this.applyRetentionPolicy(
          this.tableBackupsDir,
          TABLE_BACKUP_FILE_REGEX,
        );
        this.markJobCompleted(job.id, fileName);
      } catch (error) {
        this.markJobFailed(job.id, error);
      }
    });

    return {
      message:
        'Backup de tabla agregado a la cola y ejecutandose en segundo plano.',
      job,
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

    await this.runPgRestore(filePath);

    return {
      message: 'Restauracion ejecutada correctamente.',
      fileName,
    };
  }

  listJobs(): BackupJobInfo[] {
    return Array.from(this.jobs.values()).sort((a, b) =>
      a.createdAt < b.createdAt ? 1 : -1,
    );
  }

  private async ensureBackupsDir() {
    await fs.mkdir(this.backupsDir, { recursive: true });
  }

  private async ensureTableBackupsDir() {
    await fs.mkdir(this.tableBackupsDir, { recursive: true });
  }

  private createJob(type: BackupJobType, tableName: string | null) {
    const now = new Date().toISOString();
    const job: BackupJobInfo = {
      id: this.buildJobId(),
      type,
      status: 'queued',
      createdAt: now,
      startedAt: null,
      finishedAt: null,
      fileName: null,
      tableName,
      error: null,
    };

    this.jobs.set(job.id, job);
    this.trimJobs();
    return job;
  }

  private buildJobId() {
    return `job-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  private enqueueBackupWork(task: () => Promise<void>) {
    this.backupQueue = this.backupQueue.then(task, task);
  }

  private markJobRunning(jobId: string) {
    const job = this.jobs.get(jobId);
    if (!job) {
      return;
    }

    job.status = 'running';
    job.startedAt = new Date().toISOString();
    job.finishedAt = null;
    job.error = null;
  }

  private markJobCompleted(jobId: string, fileName: string) {
    const job = this.jobs.get(jobId);
    if (!job) {
      return;
    }

    job.status = 'completed';
    job.fileName = fileName;
    job.finishedAt = new Date().toISOString();
  }

  private markJobFailed(jobId: string, error: unknown) {
    const job = this.jobs.get(jobId);
    if (!job) {
      return;
    }

    job.status = 'failed';
    job.finishedAt = new Date().toISOString();
    job.error =
      error instanceof Error ? error.message : 'Error desconocido al generar backup.';
  }

  private trimJobs() {
    const jobs = Array.from(this.jobs.values()).sort((a, b) =>
      a.createdAt < b.createdAt ? 1 : -1,
    );

    for (const job of jobs.slice(25)) {
      this.jobs.delete(job.id);
    }
  }

  private buildBackupFileName() {
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
    return `backup-${stamp}.tar`;
  }

  private buildTableBackupFileName(schema: string, table: string) {
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
    return `table-backup-${schema}-${table}-${stamp}.tar`;
  }

  private async runPgDump(filePath: string, table?: string) {
    const databaseUrl = this.resolveDatabaseUrl();
    const args = [
      `--dbname=${databaseUrl}`,
      '--format=tar',
      '--no-owner',
      '--no-privileges',
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

  private async runPgRestore(filePath: string) {
    const databaseUrl = this.resolveDatabaseUrl();

    try {
      await execFileAsync(
        'pg_restore',
        [
          `--dbname=${databaseUrl}`,
          '--clean',
          '--if-exists',
          '--no-owner',
          '--no-privileges',
          filePath,
        ],
        { windowsHide: true },
      );
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Error desconocido al ejecutar pg_restore.';
      if (this.isCommandNotFoundError(error)) {
        throw new InternalServerErrorException(
          'No se encontro pg_restore en el PATH. Instala PostgreSQL client tools.',
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
        entry.name.endsWith('.tar') &&
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
