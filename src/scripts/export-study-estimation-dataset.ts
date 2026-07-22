import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { NestFactory } from '@nestjs/core';
import { DataSource } from 'typeorm';
import { AppModule } from '../app.module';
import { toCsv } from '../common/utils/csv.util';

type RegressionDatasetRow = {
  study_id: number;
  study_code: string;
  study_name: string;
  is_synthetic: boolean;
  type: string;
  method: string;
  parameter_count: number;
  normal_price: string | number;
};

function findProjectRoot() {
  // Admite ejecutar desde la raiz general o desde backend. No contiene la
  // ruta de una computadora especifica.
  const currentDirectory = resolve(process.cwd());
  const candidates = [currentDirectory, resolve(currentDirectory, '..')];
  const projectRoot = candidates.find((candidate) =>
    existsSync(join(candidate, '04_ETL')),
  );

  if (!projectRoot) {
    throw new Error('No se encontro 04_ETL desde el directorio actual.');
  }

  return projectRoot;
}

async function main() {
  const projectRoot = findProjectRoot();
  const regressionRoot = join(projectRoot, 'ml', 'regression');
  const sqlPath = join(
    projectRoot,
    '04_ETL',
    '02_regresion_extraer_dataset.sql',
  );
  const outputDirectory = join(projectRoot, '05_Datasets');
  const outputPath = join(outputDirectory, '02_regresion_estudios_dataset.csv');
  const metadataPath = join(
    outputDirectory,
    '02_regresion_estudios_metadata.json',
  );
  const mlDataDirectory = join(regressionRoot, 'data');
  const mlOutputPath = join(
    mlDataDirectory,
    '02_regresion_estudios_dataset.csv',
  );
  const mlMetadataPath = join(
    mlDataDirectory,
    '02_regresion_estudios_metadata.json',
  );

  const application = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error'],
  });

  try {
    const dataSource = application.get(DataSource);

    // PASO 1: esta es la sentencia que lee studies y study_details de la BD.
    const sql = await readFile(sqlPath, 'utf8');
    const rows = await dataSource.query<RegressionDatasetRow[]>(sql);

    if (rows.length < 10) {
      throw new Error(
        `Solo se obtuvieron ${rows.length} filas; se requieren al menos 10.`,
      );
    }

    // PASO 2: se crea el CSV. Cada fila representa exactamente un estudio.
    const headers = [
      'study_id',
      'study_code',
      'study_name',
      'is_synthetic',
      'type',
      'method',
      'parameter_count',
      'normal_price',
    ];
    const csv = toCsv(
      headers,
      rows.map((row) => [
        row.study_id,
        row.study_code,
        row.study_name,
        String(row.is_synthetic),
        row.type,
        row.method,
        row.parameter_count,
        row.normal_price,
      ]),
    );

    await mkdir(outputDirectory, { recursive: true });
    await mkdir(mlDataDirectory, { recursive: true });
    await Promise.all([
      writeFile(outputPath, csv, 'utf8'),
      writeFile(mlOutputPath, csv, 'utf8'),
    ]);

    // PASO 2B: registra cuándo y con qué consulta se obtuvo este snapshot.
    // El CSV no tiene una fecha por estudio, por eso no se inventa un periodo:
    // se documenta como corte puntual y se identifica por su SHA-256.
    const metadata = {
      exportedAtUtc: new Date().toISOString(),
      snapshotType: 'point_in_time_catalog_snapshot',
      temporalCoverage: {
        available: false,
        reason:
          'El dataset no incluye una fecha de observacion por estudio; no representa una serie temporal.',
      },
      sourceQuery: '04_ETL/02_regresion_extraer_dataset.sql',
      sourceTables: ['operativo.studies', 'operativo.study_details'],
      dataset: '05_Datasets/02_regresion_estudios_dataset.csv',
      rows: rows.length,
      sha256: createHash('sha256').update(csv, 'utf8').digest('hex'),
    };
    await Promise.all([
      writeFile(
        metadataPath,
        `${JSON.stringify(metadata, null, 2)}\n`,
        'utf8',
      ),
      writeFile(
        mlMetadataPath,
        `${JSON.stringify(metadata, null, 2)}\n`,
        'utf8',
      ),
    ]);
    process.stdout.write(
      `Dataset de regresion exportado: ${rows.length} filas -> ${outputPath}\nCopia para libreta -> ${mlOutputPath}\nMetadatos del snapshot -> ${metadataPath}\n`,
    );
  } finally {
    await application.close();
  }
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`No fue posible exportar el dataset: ${message}\n`);
  process.exitCode = 1;
});
