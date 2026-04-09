import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { QueryResultRow } from 'pg';
import { Role } from 'src/common/enums/roles.enum';
import { DatabaseService } from 'src/database/database.service';
import { DataSource } from 'typeorm';
import {
  BackupFormat,
  BackupScope,
  GenerateBackupDto,
} from './dto/generate-backup.dto';
import {
  AdminBackupsService,
  type BackupJobInfo,
} from './admin-backups.service';

type DbIdentityRow = QueryResultRow & {
  current_user: string;
  current_schema: string;
  now: string;
};

type NumericValue = string | number | null;

type TableRef = {
  schema: string;
  name: string;
  qualifiedName: string;
};

type MonitoringSummaryRow = QueryResultRow & {
  database_name: string;
  database_size_bytes: NumericValue;
  database_size_pretty: string;
  table_count: NumericValue;
  index_count: NumericValue;
  commits: NumericValue;
  rollbacks: NumericValue;
  deadlocks: NumericValue;
  temp_files: NumericValue;
  temp_bytes: NumericValue;
  temp_bytes_pretty: string;
  blks_read: NumericValue;
  blks_hit: NumericValue;
  stats_reset: string | null;
};

type MonitoringConnectionTotalsRow = QueryResultRow & {
  total_connections: NumericValue;
  active_connections: NumericValue;
  idle_connections: NumericValue;
  waiting_sessions: NumericValue;
  long_running_queries: NumericValue;
  max_connections: NumericValue;
};

type MonitoringConnectionStateRow = QueryResultRow & {
  state: string | null;
  total: NumericValue;
};

type MonitoringTableAccessRow = QueryResultRow & {
  schemaname: string;
  table_name: string;
  seq_scan: NumericValue;
  idx_scan: NumericValue;
  n_live_tup: NumericValue;
  n_dead_tup: NumericValue;
  index_usage_pct: NumericValue;
};

type MonitoringIndexRow = QueryResultRow & {
  schemaname: string;
  table_name: string;
  index_name: string;
  idx_scan: NumericValue;
  idx_tup_read: NumericValue;
  idx_tup_fetch: NumericValue;
  size_bytes: NumericValue;
  size_pretty: string;
};

type MonitoringStorageRow = QueryResultRow & {
  schemaname: string;
  table_name: string;
  total_size_bytes: NumericValue;
  total_size_pretty: string;
  table_size_bytes: NumericValue;
  table_size_pretty: string;
  indexes_size_bytes: NumericValue;
  indexes_size_pretty: string;
  n_live_tup: NumericValue;
  n_dead_tup: NumericValue;
};

type MonitoringMaintenanceRow = QueryResultRow & {
  schemaname: string;
  table_name: string;
  vacuum_count: NumericValue;
  autovacuum_count: NumericValue;
  analyze_count: NumericValue;
  autoanalyze_count: NumericValue;
  last_vacuum: string | null;
  last_autovacuum: string | null;
  last_analyze: string | null;
  last_autoanalyze: string | null;
  n_dead_tup: NumericValue;
  maintenance_need_pct: NumericValue;
};

type MonitoringActivityLogRow = QueryResultRow & {
  pid: NumericValue;
  usename: string | null;
  application_name: string | null;
  client_addr: string | null;
  state: string | null;
  wait_event_type: string | null;
  wait_event: string | null;
  backend_type: string | null;
  backend_start: string | null;
  xact_start: string | null;
  query_start: string | null;
  state_change: string | null;
  query_duration_ms: NumericValue;
  query: string | null;
};

type MonitoringBlockedSessionRow = QueryResultRow & {
  blocked_pid: NumericValue;
  blocked_user: string | null;
  blocked_state: string | null;
  blocked_wait_event_type: string | null;
  blocked_wait_event: string | null;
  blocked_duration_ms: NumericValue;
  blocked_query: string | null;
  blocking_pid: NumericValue;
  blocking_user: string | null;
  blocking_state: string | null;
  blocking_query: string | null;
};

type MonitoringExtensionStatusRow = QueryResultRow & {
  installed: boolean;
  version: string | null;
};

type MonitoringStatementLogRow = QueryResultRow & {
  calls: NumericValue;
  total_exec_time: NumericValue;
  mean_exec_time: NumericValue;
  rows: NumericValue;
  shared_blks_hit: NumericValue;
  shared_blks_read: NumericValue;
  temp_blks_written: NumericValue;
  query: string | null;
};

type MonitoringLoggingSettingRow = QueryResultRow & {
  name: string;
  setting: string;
};

type MonitoringConsoleEntryLevel = 'info' | 'warn' | 'error' | 'success';
type MonitoringConsoleEntryCategory =
  | 'summary'
  | 'query'
  | 'lock'
  | 'backup'
  | 'statement'
  | 'system';

type MonitoringConsoleEntry = {
  id: string;
  occurredAt: string;
  level: MonitoringConsoleEntryLevel;
  source: string;
  category: MonitoringConsoleEntryCategory;
  title: string;
  message: string;
  context: string | null;
  commandText: string | null;
};

type MonitoringActiveSession = {
  pid: number;
  user: string;
  applicationName: string;
  clientAddress: string;
  state: string;
  waitEventType: string | null;
  waitEvent: string | null;
  backendType: string;
  queryStart: string | null;
  stateChange: string | null;
  queryDurationMs: number;
  queryPreview: string;
  queryText: string;
};

type MonitoringBlockedSession = {
  blockedPid: number;
  blockedUser: string;
  blockedState: string;
  blockedWaitEventType: string | null;
  blockedWaitEvent: string | null;
  blockedDurationMs: number;
  blockedQueryPreview: string;
  blockedQueryText: string;
  blockingPid: number;
  blockingUser: string;
  blockingState: string;
  blockingQueryPreview: string;
  blockingQueryText: string;
};

type MonitoringTopStatement = {
  id: string;
  calls: number;
  totalExecTimeMs: number;
  meanExecTimeMs: number;
  rows: number;
  sharedHits: number;
  sharedReads: number;
  tempWritten: number;
  queryPreview: string;
  queryText: string;
};

@Injectable()
export class DbAdminService {
  constructor(
    private readonly db: DatabaseService,
    private readonly adminBackupsService: AdminBackupsService,
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  async generateBackup(payload: GenerateBackupDto) {
    const format = payload.format ?? BackupFormat.SQL;
    const now = new Date();
    const stamp = now.toISOString().replace(/[:.]/g, '-');

    if (payload.scope === BackupScope.TABLE) {
      if (!payload.tableName) {
        throw new BadRequestException(
          'tableName es requerido cuando scope = table',
        );
      }

      const tableRef = this.parseTableReference(payload.tableName);
      const safeFileBase = `${tableRef.schema}_${tableRef.name}`;
      if (format === BackupFormat.CSV) {
        const csv = await this.exportTableAsCsv(tableRef.qualifiedName);
        return {
          fileName: `${safeFileBase}_${stamp}.csv`,
          mimeType: 'text/csv; charset=utf-8',
          content: csv,
        };
      }

      const sql = await this.exportTableAsSql(tableRef.qualifiedName);
      return {
        fileName: `${safeFileBase}_${stamp}.sql`,
        mimeType: 'application/sql; charset=utf-8',
        content: sql,
      };
    }

    const sql = await this.exportDatabaseAsSql();
    return {
      fileName: `db_operativo_${stamp}.sql`,
      mimeType: 'application/sql; charset=utf-8',
      content: sql,
    };
  }

  async topics() {
    const [backupRestore, automation, exportImport, security, performance] =
      await Promise.all([
        this.backupRestore(),
        this.automation(),
        this.exportImport(),
        this.security(),
        this.performance(),
      ]);

    return {
      ok: true,
      checkedAt: new Date().toISOString(),
      module: 'Administracion de Base de Datos',
      topics: [backupRestore, automation, exportImport, security, performance],
    };
  }

  async monitoring() {
    const [
      summaryResult,
      connectionTotalsResult,
      connectionStatesResult,
      tableAccessResult,
      topIndexesResult,
      storageResult,
      maintenanceResult,
    ] = await Promise.all([
      this.db.query<MonitoringSummaryRow>(
        Role.Admin,
        `
        SELECT
          current_database() AS database_name,
          pg_database_size(current_database()) AS database_size_bytes,
          pg_size_pretty(pg_database_size(current_database())) AS database_size_pretty,
          COALESCE((
            SELECT COUNT(*)::int
            FROM pg_stat_user_tables
            WHERE schemaname IN ('operativo', 'public')
          ), 0) AS table_count,
          COALESCE((
            SELECT COUNT(*)::int
            FROM pg_stat_user_indexes
            WHERE schemaname IN ('operativo', 'public')
          ), 0) AS index_count,
          xact_commit AS commits,
          xact_rollback AS rollbacks,
          deadlocks,
          temp_files,
          temp_bytes,
          pg_size_pretty(temp_bytes) AS temp_bytes_pretty,
          blks_read,
          blks_hit,
          stats_reset::text AS stats_reset
        FROM pg_stat_database
        WHERE datname = current_database()
        `,
      ),
      this.db.query<MonitoringConnectionTotalsRow>(
        Role.Admin,
        `
        SELECT
          COUNT(*)::int AS total_connections,
          COUNT(*) FILTER (WHERE state = 'active')::int AS active_connections,
          COUNT(*) FILTER (WHERE state = 'idle')::int AS idle_connections,
          COUNT(*) FILTER (WHERE wait_event_type IS NOT NULL)::int AS waiting_sessions,
          COUNT(*) FILTER (
            WHERE state = 'active'
              AND query_start IS NOT NULL
              AND NOW() - query_start > INTERVAL '5 minutes'
          )::int AS long_running_queries,
          (
            SELECT setting::int
            FROM pg_settings
            WHERE name = 'max_connections'
          ) AS max_connections
        FROM pg_stat_activity
        WHERE datname = current_database()
        `,
      ),
      this.db.query<MonitoringConnectionStateRow>(
        Role.Admin,
        `
        SELECT
          COALESCE(state, 'unknown') AS state,
          COUNT(*)::int AS total
        FROM pg_stat_activity
        WHERE datname = current_database()
        GROUP BY COALESCE(state, 'unknown')
        ORDER BY total DESC, state ASC
        `,
      ),
      this.db.query<MonitoringTableAccessRow>(
        Role.Admin,
        `
        SELECT
          schemaname,
          relname AS table_name,
          seq_scan,
          idx_scan,
          n_live_tup,
          n_dead_tup,
          CASE
            WHEN seq_scan + idx_scan = 0 THEN 0
            ELSE ROUND((idx_scan::numeric * 100) / (seq_scan + idx_scan), 2)
          END AS index_usage_pct
        FROM pg_stat_user_tables
        WHERE schemaname IN ('operativo', 'public')
        ORDER BY (seq_scan + idx_scan) DESC, idx_scan DESC, relname ASC
        LIMIT 8
        `,
      ),
      this.db.query<MonitoringIndexRow>(
        Role.Admin,
        `
        SELECT
          s.schemaname,
          s.relname AS table_name,
          s.indexrelname AS index_name,
          s.idx_scan,
          s.idx_tup_read,
          s.idx_tup_fetch,
          pg_relation_size(s.indexrelid) AS size_bytes,
          pg_size_pretty(pg_relation_size(s.indexrelid)) AS size_pretty
        FROM pg_stat_user_indexes s
        WHERE s.schemaname IN ('operativo', 'public')
        ORDER BY s.idx_scan DESC, pg_relation_size(s.indexrelid) DESC, s.indexrelname ASC
        LIMIT 8
        `,
      ),
      this.db.query<MonitoringStorageRow>(
        Role.Admin,
        `
        SELECT
          schemaname,
          relname AS table_name,
          pg_total_relation_size(relid) AS total_size_bytes,
          pg_size_pretty(pg_total_relation_size(relid)) AS total_size_pretty,
          pg_relation_size(relid) AS table_size_bytes,
          pg_size_pretty(pg_relation_size(relid)) AS table_size_pretty,
          pg_indexes_size(relid) AS indexes_size_bytes,
          pg_size_pretty(pg_indexes_size(relid)) AS indexes_size_pretty,
          n_live_tup,
          n_dead_tup
        FROM pg_stat_user_tables
        WHERE schemaname IN ('operativo', 'public')
        ORDER BY pg_total_relation_size(relid) DESC, relname ASC
        LIMIT 8
        `,
      ),
      this.db.query<MonitoringMaintenanceRow>(
        Role.Admin,
        `
        SELECT
          schemaname,
          relname AS table_name,
          vacuum_count,
          autovacuum_count,
          analyze_count,
          autoanalyze_count,
          last_vacuum::text AS last_vacuum,
          last_autovacuum::text AS last_autovacuum,
          last_analyze::text AS last_analyze,
          last_autoanalyze::text AS last_autoanalyze,
          n_dead_tup,
          CASE
            WHEN n_live_tup = 0 THEN 0
            ELSE ROUND((n_dead_tup::numeric * 100) / n_live_tup, 2)
          END AS maintenance_need_pct
        FROM pg_stat_user_tables
        WHERE schemaname IN ('operativo', 'public')
        ORDER BY n_dead_tup DESC, relname ASC
        LIMIT 8
        `,
      ),
    ]);

    const summary = summaryResult.rows[0];
    const connectionTotals = connectionTotalsResult.rows[0];

    const blocksRead = this.toNumber(summary?.blks_read);
    const blocksHit = this.toNumber(summary?.blks_hit);
    const cacheHitRatioPct = this.toPercentage(
      blocksHit,
      blocksRead + blocksHit,
    );

    const totalSeqScans = tableAccessResult.rows.reduce(
      (total, row) => total + this.toNumber(row.seq_scan),
      0,
    );
    const totalIdxScans = tableAccessResult.rows.reduce(
      (total, row) => total + this.toNumber(row.idx_scan),
      0,
    );

    const totalConnections = this.toNumber(connectionTotals?.total_connections);
    const maxConnections = this.toNumber(connectionTotals?.max_connections);
    const totalLiveTuples = storageResult.rows.reduce(
      (total, row) => total + this.toNumber(row.n_live_tup),
      0,
    );
    const totalDeadTuples = storageResult.rows.reduce(
      (total, row) => total + this.toNumber(row.n_dead_tup),
      0,
    );

    return {
      ok: true,
      checkedAt: new Date().toISOString(),
      database: {
        name: summary?.database_name ?? '',
        sizeBytes: this.toNumber(summary?.database_size_bytes),
        sizePretty: summary?.database_size_pretty ?? '0 bytes',
        statsResetAt: summary?.stats_reset ?? null,
      },
      overview: {
        tableCount: this.toNumber(summary?.table_count),
        indexCount: this.toNumber(summary?.index_count),
        commits: this.toNumber(summary?.commits),
        rollbacks: this.toNumber(summary?.rollbacks),
        deadlocks: this.toNumber(summary?.deadlocks),
        tempFiles: this.toNumber(summary?.temp_files),
        tempBytes: this.toNumber(summary?.temp_bytes),
        tempBytesPretty: summary?.temp_bytes_pretty ?? '0 bytes',
        cacheHitRatioPct,
        totalSeqScans,
        totalIdxScans,
        indexUsagePct: this.toPercentage(
          totalIdxScans,
          totalSeqScans + totalIdxScans,
        ),
        totalConnections,
        activeConnections: this.toNumber(connectionTotals?.active_connections),
        idleConnections: this.toNumber(connectionTotals?.idle_connections),
        waitingSessions: this.toNumber(connectionTotals?.waiting_sessions),
        longRunningQueries: this.toNumber(
          connectionTotals?.long_running_queries,
        ),
        maxConnections,
        connectionUtilizationPct: this.toPercentage(
          totalConnections,
          maxConnections,
        ),
        liveTuples: totalLiveTuples,
        deadTuples: totalDeadTuples,
      },
      connectionsByState: connectionStatesResult.rows.map((row) => ({
        state: row.state ?? 'unknown',
        total: this.toNumber(row.total),
      })),
      tableAccess: tableAccessResult.rows.map((row) => ({
        schema: row.schemaname,
        tableName: row.table_name,
        seqScan: this.toNumber(row.seq_scan),
        idxScan: this.toNumber(row.idx_scan),
        liveTuples: this.toNumber(row.n_live_tup),
        deadTuples: this.toNumber(row.n_dead_tup),
        indexUsagePct: this.toNumber(row.index_usage_pct),
      })),
      topIndexes: topIndexesResult.rows.map((row) => ({
        schema: row.schemaname,
        tableName: row.table_name,
        indexName: row.index_name,
        scans: this.toNumber(row.idx_scan),
        tuplesRead: this.toNumber(row.idx_tup_read),
        tuplesFetched: this.toNumber(row.idx_tup_fetch),
        sizeBytes: this.toNumber(row.size_bytes),
        sizePretty: row.size_pretty,
      })),
      storage: storageResult.rows.map((row) => ({
        schema: row.schemaname,
        tableName: row.table_name,
        totalSizeBytes: this.toNumber(row.total_size_bytes),
        totalSizePretty: row.total_size_pretty,
        tableSizeBytes: this.toNumber(row.table_size_bytes),
        tableSizePretty: row.table_size_pretty,
        indexesSizeBytes: this.toNumber(row.indexes_size_bytes),
        indexesSizePretty: row.indexes_size_pretty,
        liveTuples: this.toNumber(row.n_live_tup),
        deadTuples: this.toNumber(row.n_dead_tup),
      })),
      maintenance: maintenanceResult.rows.map((row) => ({
        schema: row.schemaname,
        tableName: row.table_name,
        vacuumCount: this.toNumber(row.vacuum_count),
        autovacuumCount: this.toNumber(row.autovacuum_count),
        analyzeCount: this.toNumber(row.analyze_count),
        autoanalyzeCount: this.toNumber(row.autoanalyze_count),
        lastVacuum: row.last_vacuum,
        lastAutovacuum: row.last_autovacuum,
        lastAnalyze: row.last_analyze,
        lastAutoanalyze: row.last_autoanalyze,
        deadTuples: this.toNumber(row.n_dead_tup),
        maintenanceNeedPct: this.toNumber(row.maintenance_need_pct),
      })),
    };
  }

  async monitoringLogs() {
    const checkedAt = new Date().toISOString();
    const backupJobs = this.adminBackupsService.listJobs().slice(0, 12);

    const [
      activityResult,
      blockedResult,
      loggingSettingsResult,
      extensionResult,
    ] = await Promise.all([
      this.db.query<MonitoringActivityLogRow>(
        Role.Admin,
        `
        SELECT
          pid,
          usename,
          COALESCE(application_name, 'app') AS application_name,
          COALESCE(client_addr::text, 'local') AS client_addr,
          COALESCE(state, 'unknown') AS state,
          wait_event_type,
          wait_event,
          COALESCE(backend_type, 'client backend') AS backend_type,
          backend_start::text AS backend_start,
          xact_start::text AS xact_start,
          query_start::text AS query_start,
          state_change::text AS state_change,
          ROUND(EXTRACT(EPOCH FROM (
            NOW() - COALESCE(query_start, xact_start, backend_start)
          )) * 1000)::bigint AS query_duration_ms,
          query
        FROM pg_stat_activity
        WHERE datname = current_database()
          AND pid <> pg_backend_pid()
          AND backend_type = 'client backend'
          AND (
            state IS DISTINCT FROM 'idle'
            OR wait_event_type IS NOT NULL
            OR state = 'idle in transaction'
          )
        ORDER BY
          CASE
            WHEN state = 'active' THEN 0
            WHEN state = 'idle in transaction' THEN 1
            WHEN wait_event_type IS NOT NULL THEN 2
            ELSE 3
          END,
          query_start ASC NULLS LAST,
          backend_start DESC
        LIMIT 20
        `,
      ),
      this.db.query<MonitoringBlockedSessionRow>(
        Role.Admin,
        `
        SELECT
          blocked.pid AS blocked_pid,
          blocked.usename AS blocked_user,
          COALESCE(blocked.state, 'unknown') AS blocked_state,
          blocked.wait_event_type AS blocked_wait_event_type,
          blocked.wait_event AS blocked_wait_event,
          ROUND(EXTRACT(EPOCH FROM (
            NOW() - COALESCE(blocked.query_start, blocked.xact_start, blocked.backend_start)
          )) * 1000)::bigint AS blocked_duration_ms,
          blocked.query AS blocked_query,
          blocker.pid AS blocking_pid,
          blocker.usename AS blocking_user,
          COALESCE(blocker.state, 'unknown') AS blocking_state,
          blocker.query AS blocking_query
        FROM pg_stat_activity blocked
        CROSS JOIN LATERAL unnest(pg_blocking_pids(blocked.pid)) AS blocker_pid(pid)
        INNER JOIN pg_stat_activity blocker
          ON blocker.pid = blocker_pid.pid
        WHERE blocked.datname = current_database()
        ORDER BY blocked.query_start ASC NULLS LAST
        LIMIT 12
        `,
      ),
      this.db.query<MonitoringLoggingSettingRow>(
        Role.Admin,
        `
        SELECT name, setting
        FROM pg_settings
        WHERE name IN (
          'logging_collector',
          'log_statement',
          'log_min_duration_statement'
        )
        ORDER BY name ASC
        `,
      ),
      this.db.query<MonitoringExtensionStatusRow>(
        Role.Admin,
        `
        SELECT
          EXISTS(
            SELECT 1
            FROM pg_extension
            WHERE extname = 'pg_stat_statements'
          ) AS installed,
          (
            SELECT extversion::text
            FROM pg_extension
            WHERE extname = 'pg_stat_statements'
          ) AS version
        `,
      ),
    ]);

    const activeSessions: MonitoringActiveSession[] = activityResult.rows.map(
      (row) => {
        const queryText = this.formatQueryText(row.query);
        return {
          pid: this.toNumber(row.pid),
          user: row.usename ?? 'desconocido',
          applicationName: row.application_name ?? 'app',
          clientAddress: row.client_addr ?? 'local',
          state: row.state ?? 'unknown',
          waitEventType: row.wait_event_type ?? null,
          waitEvent: row.wait_event ?? null,
          backendType: row.backend_type ?? 'client backend',
          queryStart: row.query_start ?? null,
          stateChange: row.state_change ?? null,
          queryDurationMs: this.toNumber(row.query_duration_ms),
          queryPreview: this.buildSingleLinePreview(queryText),
          queryText,
        };
      },
    );

    const blockedSessions: MonitoringBlockedSession[] = blockedResult.rows.map(
      (row) => {
        const blockedQueryText = this.formatQueryText(row.blocked_query);
        const blockingQueryText = this.formatQueryText(row.blocking_query);
        return {
          blockedPid: this.toNumber(row.blocked_pid),
          blockedUser: row.blocked_user ?? 'desconocido',
          blockedState: row.blocked_state ?? 'unknown',
          blockedWaitEventType: row.blocked_wait_event_type ?? null,
          blockedWaitEvent: row.blocked_wait_event ?? null,
          blockedDurationMs: this.toNumber(row.blocked_duration_ms),
          blockedQueryPreview: this.buildSingleLinePreview(blockedQueryText),
          blockedQueryText,
          blockingPid: this.toNumber(row.blocking_pid),
          blockingUser: row.blocking_user ?? 'desconocido',
          blockingState: row.blocking_state ?? 'unknown',
          blockingQueryPreview: this.buildSingleLinePreview(blockingQueryText),
          blockingQueryText,
        };
      },
    );

    const loggingSettings = loggingSettingsResult.rows.reduce<
      Record<string, string>
    >((acc, row) => {
      acc[row.name] = row.setting;
      return acc;
    }, {});

    const extensionInfo = extensionResult.rows[0] ?? {
      installed: false,
      version: null,
    };

    let topStatements: MonitoringTopStatement[] = [];
    let topStatementsError: string | null = null;

    if (extensionInfo.installed) {
      try {
        const statementsResult = await this.db.query<MonitoringStatementLogRow>(
          Role.Admin,
          `
          SELECT
            calls,
            total_exec_time,
            mean_exec_time,
            rows,
            shared_blks_hit,
            shared_blks_read,
            temp_blks_written,
            query
          FROM pg_stat_statements
          WHERE dbid = (SELECT oid FROM pg_database WHERE datname = current_database())
          ORDER BY total_exec_time DESC NULLS LAST, calls DESC
          LIMIT 12
          `,
        );

        topStatements = statementsResult.rows.map((row, index) => {
          const queryText = this.formatQueryText(row.query);
          return {
            id: `statement-${index + 1}`,
            calls: this.toNumber(row.calls),
            totalExecTimeMs: this.toNumber(row.total_exec_time),
            meanExecTimeMs: this.toNumber(row.mean_exec_time),
            rows: this.toNumber(row.rows),
            sharedHits: this.toNumber(row.shared_blks_hit),
            sharedReads: this.toNumber(row.shared_blks_read),
            tempWritten: this.toNumber(row.temp_blks_written),
            queryPreview: this.buildSingleLinePreview(queryText),
            queryText,
          };
        });
      } catch (error) {
        topStatementsError =
          error instanceof Error
            ? error.message
            : 'No se pudo consultar pg_stat_statements.';
      }
    }

    const notes = [
      'La consola muestra actividad viva de PostgreSQL y el historial operativo del modulo de respaldos.',
      'No es un archivo historico completo del servidor. Para eso PostgreSQL debe tener logging persistente configurado fuera de la app.',
    ];

    if (!extensionInfo.installed) {
      notes.push(
        'pg_stat_statements no esta instalado; por eso no hay ranking historico de consultas frecuentes.',
      );
    } else if (topStatementsError) {
      notes.push(
        `pg_stat_statements esta instalado, pero no se pudo leer: ${topStatementsError}`,
      );
    }

    if (loggingSettings.logging_collector !== 'on') {
      notes.push(
        'logging_collector aparece desactivado; desde aqui no hay acceso a archivos historicos del servidor.',
      );
    }

    const summary = {
      activeSessions: activeSessions.length,
      waitingSessions: activeSessions.filter((session) =>
        Boolean(session.waitEventType),
      ).length,
      blockedSessions: blockedSessions.length,
      longRunningSessions: activeSessions.filter(
        (session) => session.queryDurationMs >= 60_000,
      ).length,
      backupJobsTracked: backupJobs.length,
      failedBackupJobs: backupJobs.filter((job) => job.status === 'failed')
        .length,
      topStatementsTracked: topStatements.length,
    };

    return {
      ok: true,
      checkedAt,
      summary,
      capabilities: {
        liveActivity: true,
        lockInspection: true,
        backupHistory: true,
        queryFrequencyExtensionInstalled: extensionInfo.installed,
        queryFrequencyRanking:
          extensionInfo.installed && topStatementsError === null,
        serverLogFiles: false,
      },
      logging: {
        loggingCollector: loggingSettings.logging_collector ?? 'unknown',
        logStatement: loggingSettings.log_statement ?? 'unknown',
        logMinDurationStatement:
          loggingSettings.log_min_duration_statement ?? 'unknown',
        pgStatStatementsVersion: extensionInfo.version ?? null,
      },
      activeSessions,
      blockedSessions,
      topStatements,
      backupJobs,
      notes,
      consoleEntries: this.buildMonitoringConsoleEntries({
        checkedAt,
        summary,
        activeSessions,
        blockedSessions,
        topStatements,
        backupJobs,
        loggingSettings,
        extensionInstalled: extensionInfo.installed,
        extensionVersion: extensionInfo.version ?? null,
        topStatementsError,
      }),
    };
  }

  async health() {
    const admin = await this.getIdentity(Role.Admin);
    const recepcionista = await this.getIdentity(Role.Recepcionista);

    return {
      ok: true,
      checkedAt: new Date().toISOString(),
      connections: {
        admin,
        recepcionista,
      },
    };
  }

  async overview() {
    const [patients, doctors, studies, services] = await Promise.all([
      this.countFromOperativeTable(Role.Admin, 'patients'),
      this.countFromOperativeTable(Role.Admin, 'doctors'),
      this.countFromOperativeTable(Role.Admin, 'studies'),
      this.countFromOperativeTable(Role.Admin, 'service_orders'),
    ]);

    return {
      ok: true,
      checkedAt: new Date().toISOString(),
      schema: 'operativo',
      totals: {
        patients,
        doctors,
        studies,
        services,
      },
    };
  }

  async tables() {
    const rows = await this.dataSource.query(
      `
      SELECT table_schema, table_name
      FROM information_schema.tables
      WHERE table_schema IN ('operativo', 'public')
        AND table_type = 'BASE TABLE'
      ORDER BY table_schema ASC, table_name ASC
      `,
    );

    const tables = rows.map((row) => ({
      schema: row.table_schema,
      name: row.table_name,
      qualifiedName: `${row.table_schema}.${row.table_name}`,
    }));

    return {
      ok: true,
      checkedAt: new Date().toISOString(),
      schemas: ['operativo', 'public'],
      tables,
    };
  }

  async backupRestore() {
    const jobs = this.adminBackupsService.listJobs();
    const completedJobs = jobs.filter((job) => job.status === 'completed').length;

    return {
      id: 'backup_restore',
      title: 'Copias de seguridad y restauracion',
      status: 'implemented',
      summary:
        'Los respaldos completos y por tabla ya se generan desde la aplicacion, se ejecutan en cola y pueden restaurarse desde archivos validados.',
      implemented: [
        'Backups completos en .tar con pg_dump cuando esta disponible',
        'Modo compatible que empaqueta respaldo SQL dentro de .tar si faltan client tools',
        'Backups por tabla desde la interfaz administrativa',
        'Restauracion con pg_restore y validacion del artefacto',
        'Cola de ejecucion para evitar respaldos duplicados',
      ],
      pending: [
        'Alertas por fallos de restauracion',
        'Notificaciones posteriores a la finalizacion de jobs',
      ],
      recommendation:
        'Mantener pg_dump y pg_restore disponibles en el servidor para conservar el flujo optimizado.',
      data: {
        completedJobs,
        queuedOrRunningJobs: jobs.filter((job) =>
          ['queued', 'running'].includes(job.status),
        ).length,
      },
    };
  }

  async automation() {
    const automation = this.adminBackupsService.getAutomationSettings();
    const { rows } = await this.db.query<{
      installed: boolean;
      version: string | null;
    }>(
      Role.Admin,
      `
      SELECT
        installed_version IS NOT NULL AS installed,
        installed_version::text AS version
      FROM pg_available_extensions
      WHERE name = 'pg_cron'
      `,
    );

    const ext = rows[0] ?? { installed: false, version: null };
    return {
      id: 'automation',
      title: 'Automatizacion de tareas',
      status: 'implemented',
      summary:
        'La aplicacion ya puede programar respaldos automaticos diarios o por intervalos de varios dias, conservarlos por retencion y ejecutarlos sin duplicar trabajos activos.',
      implemented: [
        'Programacion de backups por hora e intervalo de dias desde Admin BD',
        'Persistencia local de configuracion de automatizacion',
        'Control de retencion y cantidad de procesos paralelos',
        'Deteccion opcional de pg_cron para diagnostico del entorno',
      ],
      pending: [
        'Alertamiento por correo o webhook al finalizar jobs',
        'Calendarios avanzados ademas del intervalo por dias',
      ],
      data: {
        pgCronInstalled: ext.installed,
        pgCronVersion: ext.version,
        enabled: automation.enabled,
        nextRunAt: automation.nextRunAt,
        intervalDays: automation.intervalDays,
        retentionDays: automation.retentionDays,
        parallelJobs: automation.parallelJobs,
      },
    };
  }

  async exportImport() {
    const tables = await this.tables();
    return {
      id: 'export_import',
      title: 'Exportacion e importacion de datos',
      status: 'partial',
      summary:
        'Se ofrece catalogo de tablas operativas para preparar export/import. Falta flujo transaccional completo desde la app.',
      implemented: [
        'Listado de tablas disponibles para intercambio',
        'Definicion de formatos objetivo CSV/JSON para operaciones',
      ],
      pending: [
        'Importador con validaciones por lote',
        'Exportador incremental por fechas',
      ],
      data: {
        availableFormats: ['csv', 'json'],
        operativeTables: tables.tables.map((table) => table.qualifiedName),
      },
    };
  }

  async security() {
    const [adminIdentity, recepIdentity, privilegeSummary] = await Promise.all([
      this.getIdentity(Role.Admin),
      this.getIdentity(Role.Recepcionista),
      this.operativePrivileges(),
    ]);

    return {
      id: 'security',
      title: 'Administracion de seguridad en BD relacional',
      status: 'implemented',
      summary:
        'Se valida separacion de usuarios de conexion y privilegios del esquema operativo.',
      implemented: [
        'Conexion separada por rol de aplicacion',
        'Consulta de privilegios activos en esquema operativo',
      ],
      pending: [
        'Auditoria de DDL y DML sensible',
        'Rotacion automatizada de credenciales',
      ],
      data: {
        identities: {
          admin: adminIdentity,
          recepcionista: recepIdentity,
        },
        privilegeSummary,
      },
    };
  }

  async performance() {
    const [dbStats, activity] = await Promise.all([
      this.db.query<{
        commits: string | number;
        rollbacks: string | number;
        deadlocks: string | number;
        temp_files: string | number;
        blks_read: string | number;
        blks_hit: string | number;
      }>(
        Role.Admin,
        `
        SELECT
          xact_commit AS commits,
          xact_rollback AS rollbacks,
          deadlocks,
          temp_files,
          blks_read,
          blks_hit
        FROM pg_stat_database
        WHERE datname = current_database()
        `,
      ),
      this.db.query<{
        active_connections: string | number;
      }>(
        Role.Admin,
        `
        SELECT COUNT(*)::int AS active_connections
        FROM pg_stat_activity
        WHERE datname = current_database()
        `,
      ),
    ]);

    const stats = dbStats.rows[0];
    const activeConnections = Number(activity.rows[0]?.active_connections ?? 0);
    const blocksRead = Number(stats?.blks_read ?? 0);
    const blocksHit = Number(stats?.blks_hit ?? 0);
    const cacheHitRatio =
      blocksHit + blocksRead === 0
        ? 0
        : Number((blocksHit / (blocksHit + blocksRead)).toFixed(4));

    return {
      id: 'performance',
      title: 'Monitoreo del rendimiento del sistema gestor relacional',
      status: 'implemented',
      summary:
        'Se exponen indicadores clave de actividad y eficiencia de cache para diagnostico operativo.',
      implemented: [
        'Lectura de metricas desde pg_stat_database',
        'Conteo de conexiones activas desde pg_stat_activity',
      ],
      pending: [
        'Serie historica de metricas',
        'Alertas por umbrales de rendimiento',
      ],
      data: {
        activeConnections,
        commits: Number(stats?.commits ?? 0),
        rollbacks: Number(stats?.rollbacks ?? 0),
        deadlocks: Number(stats?.deadlocks ?? 0),
        tempFiles: Number(stats?.temp_files ?? 0),
        cacheHitRatio,
      },
    };
  }

  private buildMonitoringConsoleEntries(input: {
    checkedAt: string;
    summary: {
      activeSessions: number;
      waitingSessions: number;
      blockedSessions: number;
      longRunningSessions: number;
      backupJobsTracked: number;
      failedBackupJobs: number;
      topStatementsTracked: number;
    };
    activeSessions: MonitoringActiveSession[];
    blockedSessions: MonitoringBlockedSession[];
    topStatements: MonitoringTopStatement[];
    backupJobs: BackupJobInfo[];
    loggingSettings: Record<string, string>;
    extensionInstalled: boolean;
    extensionVersion: string | null;
    topStatementsError: string | null;
  }): MonitoringConsoleEntry[] {
    const entries: MonitoringConsoleEntry[] = [];

    entries.push({
      id: 'capture-summary',
      occurredAt: input.checkedAt,
      level: 'info',
      source: 'monitor',
      category: 'summary',
      title: 'CAPTURA DE MONITORIZACION',
      message:
        `Sesiones activas: ${input.summary.activeSessions} | ` +
        `Esperas: ${input.summary.waitingSessions} | ` +
        `Bloqueos: ${input.summary.blockedSessions} | ` +
        `Backups rastreados: ${input.summary.backupJobsTracked}`,
      context: `Snapshot generado ${input.checkedAt}`,
      commandText: null,
    });

    entries.push({
      id: 'logging-settings',
      occurredAt: input.checkedAt,
      level:
        input.loggingSettings.logging_collector === 'on' ? 'info' : 'warn',
      source: 'postgres',
      category: 'system',
      title: 'CONFIGURACION DE LOGGING DEL MOTOR',
      message:
        `logging_collector=${input.loggingSettings.logging_collector ?? 'unknown'} | ` +
        `log_statement=${input.loggingSettings.log_statement ?? 'unknown'} | ` +
        `log_min_duration_statement=${input.loggingSettings.log_min_duration_statement ?? 'unknown'}`,
      context:
        input.loggingSettings.logging_collector === 'on'
          ? 'El servidor tiene soporte para logging persistente, pero los archivos no se leen desde la app.'
          : 'La app solo puede mostrar actividad viva y el historial de respaldos del modulo.',
      commandText:
        'SHOW logging_collector;\nSHOW log_statement;\nSHOW log_min_duration_statement;',
    });

    entries.push({
      id: 'extension-status',
      occurredAt: input.checkedAt,
      level:
        input.extensionInstalled && !input.topStatementsError ? 'info' : 'warn',
      source: 'pg_stat_statements',
      category: 'system',
      title: 'ESTADO DE CONSULTAS FRECUENTES',
      message: input.extensionInstalled
        ? `Extension disponible${input.extensionVersion ? ` v${input.extensionVersion}` : ''}.`
        : 'La extension pg_stat_statements no esta instalada.',
      context: input.topStatementsError
        ? `No se pudo leer el ranking historico: ${input.topStatementsError}`
        : input.extensionInstalled
          ? `${input.topStatements.length} consultas frecuentes cargadas.`
          : 'Solo se mostraran consultas activas del momento.',
      commandText: input.extensionInstalled
        ? 'SELECT * FROM pg_stat_statements ORDER BY total_exec_time DESC LIMIT 12;'
        : null,
    });

    if (input.blockedSessions.length === 0) {
      entries.push({
        id: 'no-blocking',
        occurredAt: input.checkedAt,
        level: 'success',
        source: 'postgres',
        category: 'lock',
        title: 'SIN BLOQUEOS DETECTADOS',
        message: 'No se observaron sesiones bloqueadas en esta captura.',
        context: null,
        commandText: null,
      });
    } else {
      for (const row of input.blockedSessions) {
        entries.push({
          id: `blocking-${row.blockedPid}-${row.blockingPid}`,
          occurredAt: input.checkedAt,
          level: 'warn',
          source: 'postgres',
          category: 'lock',
          title: `BLOQUEO PID ${row.blockedPid} <- PID ${row.blockingPid}`,
          message:
            `${row.blockedUser} espera sobre ${row.blockedWaitEventType ?? 'lock'}` +
            `${row.blockedWaitEvent ? `/${row.blockedWaitEvent}` : ''}` +
            ` mientras ${row.blockingUser} mantiene la sesion bloqueante.`,
          context:
            `Bloqueada ${this.formatDurationShort(row.blockedDurationMs)} | ` +
            `estado ${row.blockedState} -> ${row.blockingState}`,
          commandText:
            `-- blocked\n${row.blockedQueryText || '<sin consulta visible>'}\n\n` +
            `-- blocking\n${row.blockingQueryText || '<sin consulta visible>'}`,
        });
      }
    }

    if (input.activeSessions.length === 0) {
      entries.push({
        id: 'no-active-sessions',
        occurredAt: input.checkedAt,
        level: 'success',
        source: 'postgres',
        category: 'query',
        title: 'SIN CONSULTAS ACTIVAS',
        message: 'No hay sesiones activas o en espera visibles para esta captura.',
        context: null,
        commandText: null,
      });
    } else {
      for (const session of input.activeSessions) {
        entries.push({
          id: `session-${session.pid}`,
          occurredAt:
            session.queryStart ?? session.stateChange ?? input.checkedAt,
          level:
            session.waitEventType || session.queryDurationMs >= 60_000
              ? 'warn'
              : 'info',
          source: 'postgres',
          category: 'query',
          title: `PID ${session.pid} • ${session.user} • ${session.state}`,
          message: session.waitEventType
            ? `Sesion en espera por ${session.waitEventType}${session.waitEvent ? `/${session.waitEvent}` : ''}.`
            : 'Sesion visible en pg_stat_activity.',
          context:
            `${session.applicationName} • ${session.clientAddress} • ` +
            `${this.formatDurationShort(session.queryDurationMs)}`,
          commandText: session.queryText || '<consulta no disponible>',
        });
      }
    }

    for (const statement of input.topStatements) {
      entries.push({
        id: statement.id,
        occurredAt: input.checkedAt,
        level: 'info',
        source: 'pg_stat_statements',
        category: 'statement',
        title:
          `TOP SQL • ${statement.calls} calls • ` +
          `avg ${this.formatDurationShort(statement.meanExecTimeMs)}`,
        message:
          `Tiempo total ${this.formatDurationShort(statement.totalExecTimeMs)} • ` +
          `${statement.rows} filas retornadas`,
        context:
          `cache hits ${statement.sharedHits} • reads ${statement.sharedReads} • temp ${statement.tempWritten}`,
        commandText: statement.queryText || '<consulta agregada no disponible>',
      });
    }

    for (const job of input.backupJobs) {
      entries.push({
        id: `backup-${job.id}`,
        occurredAt: job.finishedAt ?? job.startedAt ?? job.createdAt,
        level:
          job.status === 'completed'
            ? 'success'
            : job.status === 'failed'
              ? 'error'
              : job.status === 'running'
                ? 'warn'
                : 'info',
        source: 'backups',
        category: 'backup',
        title:
          `${job.type === 'database' ? 'BACKUP COMPLETO' : 'BACKUP POR TABLA'} • ` +
          `${job.source === 'automatic' ? 'automatico' : 'manual'} • ${job.status}`,
        message:
          job.error ??
          job.fileName ??
          (job.type === 'table' && job.tableName
            ? `Tabla ${job.tableName}`
            : 'Trabajo en progreso'),
        context:
          `Creado ${job.createdAt} • ${this.formatDurationShort(job.durationMs)}` +
          (job.tableName ? ` • ${job.tableName}` : ''),
        commandText: this.buildBackupConsoleCommand(job),
      });
    }

    const [summaryEntry, ...rest] = entries;
    const sortedRest = rest.sort((left, right) => {
      const leftTime = new Date(left.occurredAt).getTime();
      const rightTime = new Date(right.occurredAt).getTime();
      return rightTime - leftTime;
    });

    return [summaryEntry, ...sortedRest];
  }

  private async getIdentity(role: Role) {
    const { rows } = await this.db.query<DbIdentityRow>(
      role,
      `
      SELECT
        CURRENT_USER AS current_user,
        CURRENT_SCHEMA AS current_schema,
        NOW()::text AS now
      `,
    );

    const row = rows[0];
    return {
      role,
      currentUser: row.current_user,
      currentSchema: row.current_schema,
      dbTime: row.now,
    };
  }

  private async countFromOperativeTable(
    role: Role,
    tableName: string,
  ): Promise<number> {
    const safeTable = this.assertIdentifier(tableName);
    const { rows } = await this.db.queryInOperativeSchema<{
      total: string | number;
    }>(role, `SELECT COUNT(*)::int AS total FROM ${safeTable}`);

    return Number(rows[0]?.total ?? 0);
  }

  private async operativePrivileges() {
    const { rows } = await this.db.query<{
      grantee: string;
      table_name: string;
      privileges: string | null;
    }>(
      Role.Admin,
      `
      SELECT
        grantee,
        table_name,
        string_agg(privilege_type, ', ' ORDER BY privilege_type) AS privileges
      FROM information_schema.table_privileges
      WHERE table_schema = 'operativo'
        AND grantee IN ('db_admin', 'db_recepcionista')
      GROUP BY grantee, table_name
      ORDER BY grantee, table_name
      `,
    );

    return rows;
  }

  private async exportTableAsCsv(tableName: string): Promise<string> {
    const tableRef = this.parseTableReference(tableName);
    const rows = await this.getTableRows(tableRef);
    const columns = await this.getTableColumns(tableRef);

    const header = columns.map((col) => this.escapeCsv(col)).join(',');
    const body = rows
      .map((row) =>
        columns
          .map((col) => this.escapeCsv(this.normalizeForCsv(row[col])))
          .join(','),
      )
      .join('\n');

    return `${header}\n${body}`.trimEnd();
  }

  private async exportTableAsSql(tableName: string): Promise<string> {
    const tableRef = this.parseTableReference(tableName);
    const rows = await this.getTableRows(tableRef);
    const columns = await this.getTableColumns(tableRef);
    const qualifiedTable = `${tableRef.schema}.${tableRef.name}`;

    const lines: string[] = [
      `-- Backup table: ${qualifiedTable}`,
      `-- Generated at: ${new Date().toISOString()}`,
      '',
      `SET search_path TO operativo, public;`,
      '',
    ];

    if (rows.length === 0) {
      lines.push(`-- Table ${qualifiedTable} has no rows.`);
      return lines.join('\n');
    }

    const columnList = columns.map((col) => `"${col}"`).join(', ');
    for (const row of rows) {
      const valueList = columns
        .map((col) => this.toSqlLiteral(row[col]))
        .join(', ');
      lines.push(
        `INSERT INTO ${qualifiedTable} (${columnList}) VALUES (${valueList});`,
      );
    }

    return lines.join('\n');
  }

  private async exportDatabaseAsSql(): Promise<string> {
    const tableInfo = await this.tables();
    const lines: string[] = [
      `-- Backup schema operativo`,
      `-- Generated at: ${new Date().toISOString()}`,
      '',
      `SET search_path TO operativo, public;`,
      '',
    ];

    for (const table of tableInfo.tables) {
      const block = await this.exportTableAsSql(table.qualifiedName);
      lines.push(block);
      lines.push('');
    }

    return lines.join('\n');
  }

  private async getTableRows(
    table: TableRef,
  ): Promise<Record<string, unknown>[]> {
    const safeSchema = this.assertIdentifier(table.schema);
    const safeTable = this.assertIdentifier(table.name);
    return this.dataSource.query(`SELECT * FROM ${safeSchema}.${safeTable}`);
  }

  private async getTableColumns(table: TableRef): Promise<string[]> {
    const rows = await this.dataSource.query(
      `
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = $1 AND table_name = $2
      ORDER BY ordinal_position ASC
      `,
      [table.schema, table.name],
    );

    return rows.map((row: { column_name: string }) => row.column_name);
  }

  private escapeCsv(value: unknown): string {
    const raw = value == null ? '' : String(value);
    if (/[,"\n\r]/.test(raw)) {
      return `"${raw.replace(/"/g, '""')}"`;
    }
    return raw;
  }

  private normalizeForCsv(value: unknown): string {
    if (value == null) return '';
    if (value instanceof Date) return value.toISOString();
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
  }

  private toSqlLiteral(value: unknown): string {
    if (value == null) return 'NULL';
    if (typeof value === 'number' || typeof value === 'bigint')
      return String(value);
    if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
    if (value instanceof Date)
      return `'${value.toISOString().replace(/'/g, "''")}'`;
    if (typeof value === 'object')
      return `'${JSON.stringify(value).replace(/'/g, "''")}'::jsonb`;
    return `'${String(value).replace(/'/g, "''")}'`;
  }

  private parseTableReference(raw: string): TableRef {
    const trimmed = raw.trim();
    const [first, second] = trimmed.split('.');

    if (second) {
      const schema = this.assertIdentifier(first);
      const name = this.assertIdentifier(second);
      return { schema, name, qualifiedName: `${schema}.${name}` };
    }

    const name = this.assertIdentifier(first);
    return { schema: 'operativo', name, qualifiedName: `operativo.${name}` };
  }

  private assertIdentifier(name: string): string {
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
      throw new Error(`Invalid identifier: ${name}`);
    }
    return name;
  }

  private toNumber(value: NumericValue | undefined): number {
    return Number(value ?? 0);
  }

  private formatQueryText(query: string | null, maxLength = 2200): string {
    if (!query) {
      return '';
    }

    const normalized = query
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .join('\n');

    if (normalized.length <= maxLength) {
      return normalized;
    }

    return `${normalized.slice(0, maxLength - 3)}...`;
  }

  private buildSingleLinePreview(text: string, maxLength = 160): string {
    const compact = text.replace(/\s+/g, ' ').trim();
    if (!compact) {
      return '<sin consulta visible>';
    }

    if (compact.length <= maxLength) {
      return compact;
    }

    return `${compact.slice(0, maxLength - 3)}...`;
  }

  private formatDurationShort(durationMs: number | null | undefined): string {
    const safeValue = Math.max(0, Math.round(durationMs ?? 0));

    if (safeValue < 1000) {
      return `${safeValue} ms`;
    }

    if (safeValue < 60_000) {
      return `${(safeValue / 1000).toFixed(1)} s`;
    }

    const minutes = Math.floor(safeValue / 60_000);
    const seconds = Math.round((safeValue % 60_000) / 1000);
    return `${minutes}m ${seconds}s`;
  }

  private buildBackupConsoleCommand(job: BackupJobInfo): string {
    if (job.type === 'table' && job.tableName) {
      return `pg_dump --table=${job.tableName} --format=custom --no-owner --no-privileges`;
    }

    return 'pg_dump --format=tar --no-owner --no-privileges';
  }

  private toPercentage(value: number, total: number): number {
    if (total <= 0) {
      return 0;
    }

    return Number(((value / total) * 100).toFixed(2));
  }
}
