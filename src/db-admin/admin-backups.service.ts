import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { execFile } from 'child_process';
import { promises as fs } from 'fs';
import { cpus, tmpdir } from 'os';
import { join, resolve } from 'path';
import { promisify } from 'util';
import { DataSource } from 'typeorm';
import { UpdateBackupAutomationDto } from './dto/update-backup-automation.dto';

const execFileAsync = promisify(execFile);
const BACKUP_ARTIFACT_REGEX =
  /^backup-\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}(?:\.tar|\.dumpdir|\.sql)$/;
const TABLE_BACKUP_ARTIFACT_REGEX =
  /^table-backup-[a-zA-Z0-9_]+-[a-zA-Z0-9_]+-\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}(?:\.tar|\.dump|\.sql)$/;
const AUTOMATION_TIME_REGEX = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const AUTOMATION_CONFIG_FILE = 'backup-automation.json';
const PG_DUMP_ENV_VAR = 'PG_DUMP_PATH';
const PG_RESTORE_ENV_VAR = 'PG_RESTORE_PATH';

type TableRef = {
  schema: string;
  table: string;
  qualifiedName: string;
};

export interface BackupFileInfo {
  name: string;
  size: number;
  createdAt: string;
  artifactType: 'file' | 'directory';
}

export type BackupJobType = 'database' | 'table';
export type BackupJobSource = 'manual' | 'automatic';
export type BackupJobStatus = 'queued' | 'running' | 'completed' | 'failed';

export interface BackupJobInfo {
  id: string;
  type: BackupJobType;
  source: BackupJobSource;
  status: BackupJobStatus;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number | null;
  fileName: string | null;
  tableName: string | null;
  error: string | null;
}

export interface BackupAutomationSettings {
  enabled: boolean;
  time: string;
  intervalDays: number;
  retentionDays: number;
  parallelJobs: number;
  scheduleStartAt: string | null;
  lastTriggeredAt: string | null;
  lastCompletedAt: string | null;
  lastFailedAt: string | null;
  lastError: string | null;
}

export interface BackupAutomationState extends BackupAutomationSettings {
  nextRunAt: string | null;
  timeZone: string;
  activeDatabaseJobId: string | null;
  activeDatabaseJobStatus: BackupJobStatus | null;
  activeQueueItems: number;
}

const defaultParallelJobs = Math.max(1, Math.min(4, cpus().length));

const DEFAULT_AUTOMATION_SETTINGS: BackupAutomationSettings = {
  enabled: false,
  time: '02:00',
  intervalDays: 1,
  retentionDays: 7,
  parallelJobs: defaultParallelJobs,
  scheduleStartAt: null,
  lastTriggeredAt: null,
  lastCompletedAt: null,
  lastFailedAt: null,
  lastError: null,
};

@Injectable()
export class AdminBackupsService implements OnModuleInit, OnModuleDestroy {
  private readonly backupsDir = resolve(process.cwd(), 'backups');
  private readonly tableBackupsDir = resolve(process.cwd(), 'table-backups');
  private readonly automationConfigPath = join(
    this.backupsDir,
    AUTOMATION_CONFIG_FILE,
  );
  private readonly timeZone =
    Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  private readonly jobs = new Map<string, BackupJobInfo>();
  private backupQueue: Promise<void> = Promise.resolve();
  private automationSettings: BackupAutomationSettings = {
    ...DEFAULT_AUTOMATION_SETTINGS,
  };
  private automationTimer: NodeJS.Timeout | null = null;

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async onModuleInit() {
    await this.ensureBackupsDir();
    await this.loadAutomationSettings();
    this.startAutomationTimer();
  }

  onModuleDestroy() {
    if (this.automationTimer) {
      clearInterval(this.automationTimer);
      this.automationTimer = null;
    }
  }

  async createBackup(source: BackupJobSource = 'manual') {
    await this.ensureBackupsDir();
    const activeJob = this.findActiveJob('database');

    if (activeJob) {
      return {
        message: 'Ya existe un backup completo en cola o ejecutandose.',
        job: activeJob,
      };
    }

    const pgDumpPath = await this.resolvePgToolPath('pg_dump');
    const artifactName = this.buildBackupFileName();
    const artifactPath = join(this.backupsDir, artifactName);
    const job = this.createJob('database', null, source);

    if (source === 'automatic') {
      this.automationSettings.lastTriggeredAt = job.createdAt;
      this.automationSettings.lastError = null;
      await this.persistAutomationSettings();
    }

    this.enqueueBackupWork(async () => {
      try {
        this.markJobRunning(job.id);
        if (pgDumpPath) {
          await this.runDatabasePgDump(artifactPath, pgDumpPath);
        } else {
          await this.writeDatabaseCompatibilityTarBackup(artifactPath);
        }
        await this.applyRetentionPolicy(
          this.backupsDir,
          BACKUP_ARTIFACT_REGEX,
          this.automationSettings.retentionDays,
        );
        await this.markJobCompleted(job.id, artifactName);
      } catch (error) {
        await this.cleanupArtifact(artifactPath);
        await this.markJobFailed(job.id, error);
      }
    });

    return {
      message:
        source === 'automatic'
          ? 'Backup automatico programado para ejecutarse en segundo plano.'
          : 'Backup agregado a la cola y ejecutandose en segundo plano.',
      job,
    };
  }

  async listBackups(): Promise<BackupFileInfo[]> {
    await this.ensureBackupsDir();
    return this.listBackupArtifacts(this.backupsDir, BACKUP_ARTIFACT_REGEX);
  }

  async createTableBackup(tableName: string) {
    const table = this.parseTableRef(tableName);
    await this.ensureTableBackupsDir();
    const qualifiedTable = `${table.schema}.${table.table}`;
    const activeJob = this.findActiveJob('table', qualifiedTable);

    if (activeJob) {
      return {
        message:
          'Ya existe un backup de esta tabla en cola o ejecutandose.',
        job: activeJob,
      };
    }

    const pgDumpPath = await this.resolvePgToolPath('pg_dump');
    const artifactName = pgDumpPath
      ? this.buildTableBackupFileName(table.schema, table.table)
      : this.buildTableSqlBackupFileName(table.schema, table.table);
    const artifactPath = join(this.tableBackupsDir, artifactName);
    const job = this.createJob('table', qualifiedTable, 'manual');

    this.enqueueBackupWork(async () => {
      try {
        this.markJobRunning(job.id);
        if (pgDumpPath) {
          await this.runTablePgDump(artifactPath, qualifiedTable, pgDumpPath);
        } else {
          await this.writeTableSqlBackup(artifactPath, qualifiedTable);
        }
        await this.applyRetentionPolicy(
          this.tableBackupsDir,
          TABLE_BACKUP_ARTIFACT_REGEX,
          this.automationSettings.retentionDays,
        );
        await this.markJobCompleted(job.id, artifactName);
      } catch (error) {
        await this.cleanupArtifact(artifactPath);
        await this.markJobFailed(job.id, error);
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
    return this.listBackupArtifacts(
      this.tableBackupsDir,
      TABLE_BACKUP_ARTIFACT_REGEX,
    );
  }

  async restoreBackup(fileName: string) {
    if (!BACKUP_ARTIFACT_REGEX.test(fileName)) {
      throw new BadRequestException('Nombre de backup invalido.');
    }

    await this.ensureBackupsDir();
    const artifactPath = join(this.backupsDir, fileName);

    try {
      await fs.access(artifactPath);
    } catch {
      throw new NotFoundException('El backup seleccionado no existe.');
    }

    if (fileName.endsWith('.sql')) {
      await this.restoreSqlBackup(artifactPath);
    } else if (
      fileName.endsWith('.tar') &&
      (await this.isCompatibilityTarBackup(artifactPath))
    ) {
      await this.restoreCompatibilityTarBackup(artifactPath);
    } else {
      const pgRestorePath = await this.resolvePgToolPath('pg_restore');
      if (!pgRestorePath) {
        throw new InternalServerErrorException(
          'No se encontro pg_restore ni una ruta valida en PG_RESTORE_PATH.',
        );
      }
      await this.runPgRestore(artifactPath, fileName, pgRestorePath);
    }

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

  getAutomationSettings(): BackupAutomationState {
    const nextRunAt = this.computeNextAutomationRunAt();
    const activeDatabaseJob = this.findActiveJob('database');
    const activeQueueItems = this.listJobs().filter((job) =>
      ['queued', 'running'].includes(job.status),
    ).length;

    return {
      ...this.automationSettings,
      nextRunAt: nextRunAt ? nextRunAt.toISOString() : null,
      timeZone: this.timeZone,
      activeDatabaseJobId: activeDatabaseJob?.id ?? null,
      activeDatabaseJobStatus: activeDatabaseJob?.status ?? null,
      activeQueueItems,
    };
  }

  async updateAutomationSettings(dto: UpdateBackupAutomationDto) {
    const normalized = this.normalizeAutomationSettings(dto);
    const shouldResetSchedule =
      normalized.enabled &&
      (!this.automationSettings.enabled ||
        this.hasAutomationScheduleChanged(normalized));
    const scheduleStartAt = normalized.enabled
      ? shouldResetSchedule
        ? new Date().toISOString()
        : this.automationSettings.scheduleStartAt ?? new Date().toISOString()
      : this.automationSettings.scheduleStartAt;

    this.automationSettings = {
      ...this.automationSettings,
      enabled: normalized.enabled,
      time: normalized.time,
      intervalDays: normalized.intervalDays,
      retentionDays: normalized.retentionDays,
      parallelJobs: normalized.parallelJobs,
      scheduleStartAt,
      lastTriggeredAt: shouldResetSchedule
        ? null
        : this.automationSettings.lastTriggeredAt,
      lastError: shouldResetSchedule ? null : this.automationSettings.lastError,
    };

    await this.persistAutomationSettings();
    this.startAutomationTimer();

    return {
      message: this.automationSettings.enabled
        ? 'Automatizacion de backups actualizada.'
        : 'Automatizacion de backups desactivada.',
      settings: this.getAutomationSettings(),
    };
  }

  private async ensureBackupsDir() {
    await fs.mkdir(this.backupsDir, { recursive: true });
  }

  private async ensureTableBackupsDir() {
    await fs.mkdir(this.tableBackupsDir, { recursive: true });
  }

  private createJob(
    type: BackupJobType,
    tableName: string | null,
    source: BackupJobSource,
  ) {
    const now = new Date().toISOString();
    const job: BackupJobInfo = {
      id: this.buildJobId(),
      type,
      source,
      status: 'queued',
      createdAt: now,
      startedAt: null,
      finishedAt: null,
      durationMs: null,
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
    job.durationMs = null;
    job.error = null;
  }

  private async markJobCompleted(jobId: string, fileName: string) {
    const job = this.jobs.get(jobId);
    if (!job) {
      return;
    }

    job.status = 'completed';
    job.fileName = fileName;
    job.finishedAt = new Date().toISOString();
    job.durationMs = this.calculateDurationMs(job);

    if (job.source === 'automatic') {
      this.automationSettings.lastCompletedAt = job.finishedAt;
      this.automationSettings.lastError = null;
      await this.persistAutomationSettings();
    }
  }

  private async markJobFailed(jobId: string, error: unknown) {
    const job = this.jobs.get(jobId);
    if (!job) {
      return;
    }

    job.status = 'failed';
    job.finishedAt = new Date().toISOString();
    job.durationMs = this.calculateDurationMs(job);
    job.error =
      error instanceof Error
        ? error.message
        : 'Error desconocido al generar backup.';

    if (job.source === 'automatic') {
      this.automationSettings.lastFailedAt = job.finishedAt;
      this.automationSettings.lastError = job.error;
      await this.persistAutomationSettings();
    }
  }

  private calculateDurationMs(job: BackupJobInfo) {
    if (!job.startedAt || !job.finishedAt) {
      return null;
    }

    return Math.max(
      0,
      new Date(job.finishedAt).getTime() - new Date(job.startedAt).getTime(),
    );
  }

  private trimJobs() {
    const jobs = Array.from(this.jobs.values()).sort((a, b) =>
      a.createdAt < b.createdAt ? 1 : -1,
    );

    for (const job of jobs.slice(40)) {
      this.jobs.delete(job.id);
    }
  }

  private buildBackupFileName() {
    return `backup-${this.buildStamp()}.tar`;
  }

  private buildTableBackupFileName(schema: string, table: string) {
    return `table-backup-${schema}-${table}-${this.buildStamp()}.dump`;
  }

  private buildTableSqlBackupFileName(schema: string, table: string) {
    return `table-backup-${schema}-${table}-${this.buildStamp()}.sql`;
  }

  private quoteIdentifier(identifier: string) {
    return `"${this.assertIdentifier(identifier)}"`;
  }

  private formatQualifiedTableName(table: TableRef) {
    return `${this.quoteIdentifier(table.schema)}.${this.quoteIdentifier(table.table)}`;
  }

  private buildStamp() {
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
  }

  private async runDatabasePgDump(targetPath: string, pgDumpPath: string) {
    await this.cleanupArtifact(targetPath);
    const databaseUrl = this.resolveDatabaseUrl();
    const args = [
      `--dbname=${databaseUrl}`,
      '--format=tar',
      '--no-owner',
      '--no-privileges',
      `--file=${targetPath}`,
    ];

    try {
      await execFileAsync(pgDumpPath, args, { windowsHide: true });
    } catch (error) {
      throw this.buildPgToolError(error, 'pg_dump', 'generar el backup');
    }
  }

  private async runTablePgDump(
    targetPath: string,
    table: string,
    pgDumpPath: string,
  ) {
    await this.cleanupArtifact(targetPath);
    const databaseUrl = this.resolveDatabaseUrl();
    const args = [
      `--dbname=${databaseUrl}`,
      '--format=custom',
      '--compress=0',
      '--no-owner',
      '--no-privileges',
      `--file=${targetPath}`,
      `--table=${table}`,
    ];

    try {
      await execFileAsync(pgDumpPath, args, { windowsHide: true });
    } catch (error) {
      throw this.buildPgToolError(error, 'pg_dump', 'generar el backup');
    }
  }

  private async runPgRestore(
    targetPath: string,
    fileName: string,
    pgRestorePath: string,
  ) {
    const databaseUrl = this.resolveDatabaseUrl();
    const args = [
      `--dbname=${databaseUrl}`,
      '--clean',
      '--if-exists',
      '--no-owner',
      '--no-privileges',
    ];

    if (fileName.endsWith('.dumpdir')) {
      args.push(`--jobs=${this.resolveParallelJobs()}`);
    }

    args.push(targetPath);

    try {
      await execFileAsync(pgRestorePath, args, { windowsHide: true });
    } catch (error) {
      throw this.buildPgToolError(error, 'pg_restore', 'restaurar el backup');
    }
  }

  private buildPgToolError(
    error: unknown,
    toolName: 'pg_dump' | 'pg_restore',
    action: string,
  ) {
    const message =
      error instanceof Error
        ? error.message
        : `Error desconocido al ejecutar ${toolName}.`;

    if (this.isCommandNotFoundError(error)) {
      return new InternalServerErrorException(
        `No se encontro ${toolName} en el PATH. Instala PostgreSQL client tools.`,
      );
    }

    return new InternalServerErrorException(
      `No se pudo ${action}: ${message}`,
    );
  }

  private async resolvePgToolPath(tool: 'pg_dump' | 'pg_restore') {
    const envVar = tool === 'pg_dump' ? PG_DUMP_ENV_VAR : PG_RESTORE_ENV_VAR;
    const envPath = process.env[envVar];
    if (envPath) {
      const envCandidate = await this.resolvePgToolPathFromEnv(envPath, tool);
      if (envCandidate) {
        return envCandidate;
      }
    }

    const binary = process.platform === 'win32' ? `${tool}.exe` : tool;
    const resolver =
      process.platform === 'win32'
        ? { command: 'where.exe', args: [binary] }
        : { command: 'which', args: [binary] };

    try {
      const { stdout } = await execFileAsync(resolver.command, resolver.args, {
        windowsHide: true,
      });
      const firstPath = stdout
        .split(/\r?\n/)
        .map((value) => value.trim())
        .find((value) => value.length > 0);
      if (firstPath && (await this.pathExists(firstPath))) {
        return firstPath;
      }
    } catch {
      // Si no esta en PATH seguimos con deteccion local.
    }

    if (process.platform === 'win32') {
      for (const root of [
        'C:\\Program Files\\PostgreSQL',
        'C:\\Program Files (x86)\\PostgreSQL',
      ]) {
        const candidate = await this.findWindowsPgTool(root, binary);
        if (candidate) {
          return candidate;
        }
      }
    }

    return null;
  }

  private async resolvePgToolPathFromEnv(
    configuredPath: string,
    tool: 'pg_dump' | 'pg_restore',
  ) {
    const sanitizedPath = configuredPath.trim().replace(/^"(.*)"$/, '$1');
    if (!sanitizedPath) {
      return null;
    }

    const binary = process.platform === 'win32' ? `${tool}.exe` : tool;
    const directPath = sanitizedPath;
    if (await this.pathExists(directPath)) {
      return directPath;
    }

    const nestedPath = join(sanitizedPath, binary);
    if (await this.pathExists(nestedPath)) {
      return nestedPath;
    }

    return null;
  }

  private async findWindowsPgTool(rootDir: string, binary: string) {
    try {
      const entries = await fs.readdir(rootDir, { withFileTypes: true });
      const versions = entries
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));

      for (const version of versions) {
        const candidate = join(rootDir, version, 'bin', binary);
        if (await this.pathExists(candidate)) {
          return candidate;
        }
      }
    } catch {
      return null;
    }

    return null;
  }

  private async pathExists(targetPath: string) {
    try {
      await fs.access(targetPath);
      return true;
    } catch {
      return false;
    }
  }

  private async applyRetentionPolicy(
    targetDir: string,
    namePattern: RegExp,
    retentionDays: number,
  ) {
    const cutoffMs =
      Date.now() - Math.max(1, retentionDays) * 24 * 60 * 60 * 1000;
    const entries = await fs.readdir(targetDir, { withFileTypes: true });
    let deletedCount = 0;

    for (const entry of entries) {
      if (
        !(entry.isFile() || entry.isDirectory()) ||
        !namePattern.test(entry.name)
      ) {
        continue;
      }

      const fullPath = join(targetDir, entry.name);
      const stat = await fs.stat(fullPath);
      if (stat.mtimeMs < cutoffMs) {
        await fs.rm(fullPath, { recursive: true, force: true });
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

  private resolveParallelJobs() {
    const maxRecommended = Math.max(1, Math.min(4, cpus().length));
    return Math.max(
      1,
      Math.min(this.automationSettings.parallelJobs, maxRecommended),
    );
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
    return { schema, table, qualifiedName: `${schema}.${table}` };
  }

  private assertIdentifier(value: string) {
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(value)) {
      throw new BadRequestException(`Identificador invalido: ${value}`);
    }
    return value;
  }

  private async writeDatabaseSqlBackup(targetPath: string) {
    await this.cleanupArtifact(targetPath);
    const sql = await this.exportDatabaseAsSql();
    await fs.writeFile(targetPath, sql, 'utf8');
  }

  private async writeDatabaseCompatibilityTarBackup(targetPath: string) {
    const tempDir = await fs.mkdtemp(join(tmpdir(), 'econolab-db-backup-'));
    const sqlFileName = 'backup.sql';
    const metadataFileName = 'compatibility.json';

    try {
      await this.cleanupArtifact(targetPath);
      await fs.writeFile(
        join(tempDir, sqlFileName),
        await this.exportDatabaseAsSql(),
        'utf8',
      );
      await fs.writeFile(
        join(tempDir, metadataFileName),
        JSON.stringify(
          {
            type: 'sql-compat-backup',
            generatedAt: new Date().toISOString(),
          },
          null,
          2,
        ),
        'utf8',
      );
      await this.createTarArchive(targetPath, tempDir, [
        sqlFileName,
        metadataFileName,
      ]);
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  }

  private async writeTableSqlBackup(targetPath: string, tableName: string) {
    await this.cleanupArtifact(targetPath);
    const sql = await this.exportTableAsSql(tableName);
    await fs.writeFile(targetPath, sql, 'utf8');
  }

  private async restoreSqlBackup(targetPath: string) {
    const sql = await fs.readFile(targetPath, 'utf8');
    if (!sql.trim()) {
      throw new BadRequestException('El backup SQL esta vacio.');
    }

    await this.dataSource.query(sql);
  }

  private async restoreCompatibilityTarBackup(targetPath: string) {
    const tempDir = await fs.mkdtemp(join(tmpdir(), 'econolab-db-restore-'));
    const sqlPath = join(tempDir, 'backup.sql');

    try {
      await this.extractTarArchive(targetPath, tempDir);
      if (!(await this.pathExists(sqlPath))) {
        throw new InternalServerErrorException(
          'El backup .tar compatible no contiene un backup.sql valido.',
        );
      }

      await this.restoreSqlBackup(sqlPath);
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  }

  private async isCompatibilityTarBackup(targetPath: string) {
    const entries = await this.listTarArchiveEntries(targetPath);
    return (
      entries.includes('backup.sql') && entries.includes('compatibility.json')
    );
  }

  private async createTarArchive(
    targetPath: string,
    sourceDir: string,
    entries: string[],
  ) {
    try {
      await execFileAsync(this.getTarBinary(), ['-cf', targetPath, '-C', sourceDir, ...entries], {
        windowsHide: true,
      });
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Error desconocido al empaquetar el backup.';
      throw new InternalServerErrorException(
        `No se pudo empaquetar el backup en .tar: ${message}`,
      );
    }
  }

  private async extractTarArchive(targetPath: string, targetDir: string) {
    try {
      await execFileAsync(this.getTarBinary(), ['-xf', targetPath, '-C', targetDir], {
        windowsHide: true,
      });
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Error desconocido al extraer el backup .tar.';
      throw new InternalServerErrorException(
        `No se pudo extraer el backup .tar: ${message}`,
      );
    }
  }

  private async listTarArchiveEntries(targetPath: string) {
    try {
      const { stdout } = await execFileAsync(this.getTarBinary(), ['-tf', targetPath], {
        windowsHide: true,
      });
      return stdout
        .split(/\r?\n/)
        .map((entry) => entry.trim().replace(/^\.\/+/, ''))
        .filter((entry) => entry.length > 0);
    } catch {
      return [];
    }
  }

  private getTarBinary() {
    return process.platform === 'win32' ? 'tar.exe' : 'tar';
  }

  private async exportDatabaseAsSql() {
    const tables = await this.getOrderedTableRefs();
    const truncateTargets = tables
      .map((table) => this.formatQualifiedTableName(table))
      .join(', ');
    const lines: string[] = [
      '-- Backup SQL generado por AdminBackupsService',
      `-- Generated at: ${new Date().toISOString()}`,
      '',
      'SET search_path TO operativo, public;',
      'BEGIN;',
      '',
    ];

    if (truncateTargets) {
      lines.push(
        `TRUNCATE TABLE ${truncateTargets} RESTART IDENTITY CASCADE;`,
        '',
      );
    }

    for (const table of tables) {
      lines.push(await this.buildTableInsertStatements(table));
      lines.push('');
    }

    lines.push('COMMIT;');
    return lines.join('\n').trimEnd();
  }

  private async exportTableAsSql(tableName: string) {
    const table = this.parseTableRef(tableName);
    const qualifiedTable = this.formatQualifiedTableName(table);
    const lines: string[] = [
      `-- Backup SQL para ${table.qualifiedName}`,
      `-- Generated at: ${new Date().toISOString()}`,
      '',
      'SET search_path TO operativo, public;',
      'BEGIN;',
      '',
      `TRUNCATE TABLE ${qualifiedTable} RESTART IDENTITY CASCADE;`,
      '',
      await this.buildTableInsertStatements(table),
      '',
      'COMMIT;',
    ];

    return lines.join('\n').trimEnd();
  }

  private async buildTableInsertStatements(table: TableRef) {
    const rows = await this.getTableRows(table);
    const columns = await this.getTableColumns(table);
    const qualifiedTable = this.formatQualifiedTableName(table);
    const lines = [`-- Table: ${table.qualifiedName}`];

    if (rows.length === 0) {
      lines.push(`-- ${table.qualifiedName} sin filas.`);
      return lines.join('\n');
    }

    const columnList = columns.map((column) => this.quoteIdentifier(column)).join(', ');
    for (const row of rows) {
      const values = columns
        .map((column) => this.toSqlLiteral(row[column]))
        .join(', ');
      lines.push(
        `INSERT INTO ${qualifiedTable} (${columnList}) VALUES (${values});`,
      );
    }

    const sequenceResetStatements = await this.buildSequenceResetStatements(
      table,
      qualifiedTable,
    );
    if (sequenceResetStatements) {
      lines.push('');
      lines.push(sequenceResetStatements);
    }

    return lines.join('\n');
  }

  private async buildSequenceResetStatements(
    table: TableRef,
    qualifiedTable: string,
  ) {
    const sequenceColumns = await this.getSequenceColumns(table);
    if (sequenceColumns.length === 0) {
      return '';
    }

    return sequenceColumns
      .map((column) => {
        const quotedColumn = this.quoteIdentifier(column);
        return [
          `SELECT setval(`,
          `  pg_get_serial_sequence('${qualifiedTable}', '${column}'),`,
          `  COALESCE((SELECT MAX(${quotedColumn}) FROM ${qualifiedTable}), 1),`,
          `  (SELECT MAX(${quotedColumn}) IS NOT NULL FROM ${qualifiedTable})`,
          `);`,
        ].join('\n');
      })
      .join('\n');
  }

  private async getOrderedTableRefs() {
    const tables = await this.getBackupTables();
    const rows = (await this.dataSource.query(
      `
      SELECT
        tc.table_schema AS child_schema,
        tc.table_name AS child_table,
        ccu.table_schema AS parent_schema,
        ccu.table_name AS parent_table
      FROM information_schema.table_constraints tc
      INNER JOIN information_schema.constraint_column_usage ccu
        ON ccu.constraint_name = tc.constraint_name
       AND ccu.constraint_schema = tc.constraint_schema
      WHERE tc.constraint_type = 'FOREIGN KEY'
        AND tc.table_schema IN ('operativo', 'public')
        AND ccu.table_schema IN ('operativo', 'public')
      `,
    )) as Array<{
      child_schema: string;
      child_table: string;
      parent_schema: string;
      parent_table: string;
    }>;

    const byName = new Map<string, TableRef>(
      tables.map((table) => [table.qualifiedName, table]),
    );
    const indegree = new Map<string, number>(
      tables.map((table) => [table.qualifiedName, 0]),
    );
    const edges = new Map<string, Set<string>>();

    for (const row of rows) {
      const parent = `${row.parent_schema}.${row.parent_table}`;
      const child = `${row.child_schema}.${row.child_table}`;

      if (!byName.has(parent) || !byName.has(child) || parent === child) {
        continue;
      }

      const children = edges.get(parent) ?? new Set<string>();
      if (!children.has(child)) {
        children.add(child);
        edges.set(parent, children);
        indegree.set(child, (indegree.get(child) ?? 0) + 1);
      }
    }

    const queue = tables
      .filter((table) => (indegree.get(table.qualifiedName) ?? 0) === 0)
      .sort((a, b) => a.qualifiedName.localeCompare(b.qualifiedName));
    const ordered: TableRef[] = [];

    while (queue.length > 0) {
      const current = queue.shift();
      if (!current) {
        break;
      }

      ordered.push(current);

      for (const child of edges.get(current.qualifiedName) ?? []) {
        const nextIndegree = (indegree.get(child) ?? 0) - 1;
        indegree.set(child, nextIndegree);
        if (nextIndegree === 0) {
          const childTable = byName.get(child);
          if (childTable) {
            queue.push(childTable);
            queue.sort((a, b) => a.qualifiedName.localeCompare(b.qualifiedName));
          }
        }
      }
    }

    return ordered.length === tables.length ? ordered : tables;
  }

  private async getBackupTables(): Promise<TableRef[]> {
    const rows = (await this.dataSource.query(
      `
      SELECT table_schema, table_name
      FROM information_schema.tables
      WHERE table_schema IN ('operativo', 'public')
        AND table_type = 'BASE TABLE'
      ORDER BY table_schema ASC, table_name ASC
      `,
    )) as Array<{ table_schema: string; table_name: string }>;

    return rows.map((row) => ({
      schema: row.table_schema,
      table: row.table_name,
      qualifiedName: `${row.table_schema}.${row.table_name}`,
    }));
  }

  private async getTableColumns(table: TableRef) {
    const rows = (await this.dataSource.query(
      `
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = $1 AND table_name = $2
      ORDER BY ordinal_position ASC
      `,
      [table.schema, table.table],
    )) as Array<{ column_name: string }>;

    return rows.map((row) => row.column_name);
  }

  private async getSequenceColumns(table: TableRef) {
    const rows = (await this.dataSource.query(
      `
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = $1
        AND table_name = $2
        AND (column_default LIKE 'nextval(%' OR is_identity = 'YES')
      ORDER BY ordinal_position ASC
      `,
      [table.schema, table.table],
    )) as Array<{ column_name: string }>;

    return rows.map((row) => row.column_name);
  }

  private async getTableRows(table: TableRef) {
    return (await this.dataSource.query(
      `SELECT * FROM ${this.formatQualifiedTableName(table)}`,
    )) as Record<string, unknown>[];
  }

  private toSqlLiteral(value: unknown): string {
    if (value == null) return 'NULL';
    if (typeof value === 'number' || typeof value === 'bigint') {
      return String(value);
    }
    if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
    if (value instanceof Date) {
      return `'${value.toISOString().replace(/'/g, "''")}'`;
    }
    if (Buffer.isBuffer(value)) {
      return `'\\x${value.toString('hex')}'`;
    }
    if (Array.isArray(value)) {
      return this.toSqlArrayLiteral(value);
    }
    if (typeof value === 'object') {
      return `'${JSON.stringify(value).replace(/'/g, "''")}'`;
    }
    return `'${String(value).replace(/'/g, "''")}'`;
  }

  private toSqlArrayLiteral(values: readonly unknown[]) {
    const encodeArrayValue = (value: unknown): string => {
      if (value == null) {
        return 'NULL';
      }

      if (Array.isArray(value)) {
        return `{${value.map(encodeArrayValue).join(',')}}`;
      }

      if (
        typeof value === 'number' ||
        typeof value === 'bigint' ||
        typeof value === 'boolean'
      ) {
        return String(value);
      }

      const raw = Buffer.isBuffer(value)
        ? `\\x${value.toString('hex')}`
        : value instanceof Date
          ? value.toISOString()
          : typeof value === 'object'
            ? JSON.stringify(value)
            : String(value);

      const escaped = raw.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
      return `"${escaped}"`;
    };

    const literal = `{${values.map(encodeArrayValue).join(',')}}`;
    return `'${literal.replace(/'/g, "''")}'`;
  }

  private async listBackupArtifacts(
    targetDir: string,
    namePattern: RegExp,
  ): Promise<BackupFileInfo[]> {
    const entries = await fs.readdir(targetDir, { withFileTypes: true });
    const artifacts = entries.filter(
      (entry) =>
        (entry.isFile() || entry.isDirectory()) && namePattern.test(entry.name),
    );

    const result = await Promise.all(
      artifacts.map(async (artifact) => {
        const fullPath = join(targetDir, artifact.name);
        const stat = await fs.stat(fullPath);
        const size = artifact.isDirectory()
          ? await this.getDirectorySize(fullPath)
          : stat.size;

        return {
          name: artifact.name,
          size,
          createdAt: (stat.birthtime ?? stat.ctime).toISOString(),
          artifactType: artifact.isDirectory() ? 'directory' : 'file',
        } satisfies BackupFileInfo;
      }),
    );

    return result.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  }

  private async getDirectorySize(targetDir: string): Promise<number> {
    const entries = await fs.readdir(targetDir, { withFileTypes: true });
    const sizes = await Promise.all(
      entries.map(async (entry) => {
        const fullPath = join(targetDir, entry.name);
        if (entry.isDirectory()) {
          return this.getDirectorySize(fullPath);
        }

        const stat = await fs.stat(fullPath);
        return stat.size;
      }),
    );

    return sizes.reduce((total, size) => total + size, 0);
  }

  private async cleanupArtifact(targetPath: string) {
    await fs.rm(targetPath, { recursive: true, force: true });
  }

  private findActiveJob(type: BackupJobType, tableName?: string | null) {
    return this.listJobs().find((job) => {
      if (job.type !== type) {
        return false;
      }

      if (tableName && job.tableName !== tableName) {
        return false;
      }

      return job.status === 'queued' || job.status === 'running';
    });
  }

  private startAutomationTimer() {
    if (this.automationTimer) {
      clearInterval(this.automationTimer);
    }

    this.automationTimer = setInterval(() => {
      void this.handleAutomationTick();
    }, 60_000);

    void this.handleAutomationTick();
  }

  private async handleAutomationTick() {
    if (!this.automationSettings.enabled) {
      return;
    }

    if (this.findActiveJob('database')) {
      return;
    }

    const nextRunAt = this.computeNextAutomationRunAt();
    if (!nextRunAt || Date.now() < nextRunAt.getTime()) {
      return;
    }

    await this.createBackup('automatic');
  }

  private computeNextAutomationRunAt(reference = new Date()) {
    if (!this.automationSettings.enabled) {
      return null;
    }

    const [hours, minutes] = this.parseAutomationTime(
      this.automationSettings.time,
    );
    const effectiveLastTriggeredAt = this.getEffectiveLastTriggeredAt();

    if (effectiveLastTriggeredAt) {
      const nextRunAt = this.buildScheduledDate(
        effectiveLastTriggeredAt,
        hours,
        minutes,
      );
      nextRunAt.setDate(
        nextRunAt.getDate() + Math.max(1, this.automationSettings.intervalDays),
      );
      return nextRunAt;
    }

    const scheduleStartAt =
      this.parseIsoDate(this.automationSettings.scheduleStartAt) ?? reference;
    return this.buildScheduledDate(scheduleStartAt, hours, minutes);
  }

  private parseAutomationTime(value: string) {
    if (!AUTOMATION_TIME_REGEX.test(value)) {
      return [2, 0] as const;
    }

    const [hours, minutes] = value.split(':').map((part) => Number(part));
    return [hours, minutes] as const;
  }

  private async loadAutomationSettings() {
    try {
      const raw = await fs.readFile(this.automationConfigPath, 'utf8');
      const parsed = JSON.parse(raw) as Partial<BackupAutomationSettings>;
      this.automationSettings = this.normalizeAutomationSettings(parsed);
    } catch (error) {
      if (
        error &&
        typeof error === 'object' &&
        'code' in error &&
        error.code === 'ENOENT'
      ) {
        await this.persistAutomationSettings();
        return;
      }

      this.automationSettings = { ...DEFAULT_AUTOMATION_SETTINGS };
      await this.persistAutomationSettings();
    }
  }

  private async persistAutomationSettings() {
    await this.ensureBackupsDir();
    await fs.writeFile(
      this.automationConfigPath,
      JSON.stringify(this.automationSettings, null, 2),
      'utf8',
    );
  }

  private normalizeAutomationSettings(
    candidate: Partial<BackupAutomationSettings | UpdateBackupAutomationDto>,
  ): BackupAutomationSettings {
    const runtimeCandidate = candidate as Partial<BackupAutomationSettings>;
    const time =
      typeof candidate.time === 'string' &&
      AUTOMATION_TIME_REGEX.test(candidate.time)
        ? candidate.time
        : DEFAULT_AUTOMATION_SETTINGS.time;

    const intervalDays = this.normalizeInteger(
      candidate.intervalDays,
      1,
      90,
      DEFAULT_AUTOMATION_SETTINGS.intervalDays,
    );

    const retentionDays = this.normalizeInteger(
      candidate.retentionDays,
      1,
      30,
      DEFAULT_AUTOMATION_SETTINGS.retentionDays,
    );

    const parallelJobs = this.normalizeInteger(
      candidate.parallelJobs,
      1,
      4,
      DEFAULT_AUTOMATION_SETTINGS.parallelJobs,
    );

    return {
      enabled:
        typeof candidate.enabled === 'boolean'
          ? candidate.enabled
          : DEFAULT_AUTOMATION_SETTINGS.enabled,
      time,
      intervalDays,
      retentionDays,
      parallelJobs,
      scheduleStartAt:
        this.normalizeIsoDate(runtimeCandidate.scheduleStartAt) ??
        this.normalizeIsoDate(runtimeCandidate.lastTriggeredAt),
      lastTriggeredAt: this.normalizeIsoDate(runtimeCandidate.lastTriggeredAt),
      lastCompletedAt: this.normalizeIsoDate(runtimeCandidate.lastCompletedAt),
      lastFailedAt: this.normalizeIsoDate(runtimeCandidate.lastFailedAt),
      lastError: this.normalizeAutomationError(runtimeCandidate.lastError),
    };
  }

  private hasAutomationScheduleChanged(nextSettings: BackupAutomationSettings) {
    return (
      this.automationSettings.time !== nextSettings.time ||
      this.automationSettings.intervalDays !== nextSettings.intervalDays
    );
  }

  private getEffectiveLastTriggeredAt() {
    const lastTriggeredAt = this.parseIsoDate(
      this.automationSettings.lastTriggeredAt,
    );
    if (!lastTriggeredAt) {
      return null;
    }

    const scheduleStartAt = this.parseIsoDate(
      this.automationSettings.scheduleStartAt,
    );
    if (!scheduleStartAt) {
      return lastTriggeredAt;
    }

    return lastTriggeredAt.getTime() >= scheduleStartAt.getTime()
      ? lastTriggeredAt
      : null;
  }

  private buildScheduledDate(base: Date, hours: number, minutes: number) {
    const scheduled = new Date(base);
    scheduled.setHours(hours, minutes, 0, 0);
    return scheduled;
  }

  private normalizeAutomationError(value: unknown) {
    if (typeof value !== 'string' || value.trim().length === 0) {
      return null;
    }

    const normalized = value.trim();
    if (/no se encontro pg_dump/i.test(normalized)) {
      return null;
    }

    return normalized;
  }

  private normalizeInteger(
    value: unknown,
    min: number,
    max: number,
    fallback: number,
  ) {
    if (typeof value !== 'number' || Number.isNaN(value)) {
      return fallback;
    }

    return Math.max(min, Math.min(max, Math.trunc(value)));
  }

  private normalizeIsoDate(value: unknown) {
    if (typeof value !== 'string' || value.trim().length === 0) {
      return null;
    }

    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }

  private parseIsoDate(value: string | null) {
    if (!value) {
      return null;
    }

    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
}
