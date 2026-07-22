import { NestFactory } from '@nestjs/core';
import { mkdir, writeFile } from 'fs/promises';
import { resolve } from 'path';
import { AppModule } from '../app.module';
import { StudyClusteringService } from '../study-clustering/study-clustering.service';

function argument(name: string) {
  return process.argv
    .slice(2)
    .find((value) => value.startsWith(`--${name}=`))
    ?.split('=', 2)[1];
}

function csvCell(value: unknown) {
  if (value == null) return '';
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

async function main() {
  const periodMonths = Number(argument('periodMonths') ?? '6');
  const periodEnd = new Date(argument('periodEnd') ?? new Date().toISOString());
  const outputRoot = resolve(argument('outputRoot') ?? process.cwd());
  const mlRoot = resolve(outputRoot, 'ml', 'clustering');
  const application = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });

  try {
    const clustering = application.get(StudyClusteringService);
    const persist = (argument('persist') ?? 'true').toLowerCase() !== 'false';
    // Usa exactamente el mismo ETL, fecha de corte y modelo que el modulo web.
    // Por defecto persiste la ejecucion que la pantalla consultara.
    const persisted = persist
      ? await clustering.recalculate({ periodMonths }, periodEnd)
      : null;
    const bundle = await clustering.buildReproducibilityBundle(
      periodMonths,
      periodEnd,
    );
    const deployment = persisted
      ? {
          persisted: true,
          runId: persisted.run.runId,
          storage:
            persisted.technicalDetails.artifact?.storage ??
            'operativo.study_clustering_runs.data_quality.modelArtifact',
          artifactLoadedByBackend:
            persisted.technicalDetails.artifact?.loaded === true,
          reassignedStudies:
            persisted.technicalDetails.artifact?.reassignedStudies ?? 0,
          mismatchesWithStoredAssignments:
            persisted.technicalDetails.artifact
              ?.mismatchesWithStoredAssignments ?? 0,
          datasetFingerprintSha256:
            persisted.technicalDetails.artifact?.datasetFingerprintSha256 ??
            null,
        }
      : { persisted: false };
    if (
      persisted &&
      deployment.datasetFingerprintSha256 !==
        bundle.metadata.datasetFingerprintSha256
    ) {
      throw new Error(
        'La huella del artefacto persistido no coincide con el CSV exportado.',
      );
    }
    const datasetDirectory = resolve(outputRoot, '05_Datasets');
    const modelDirectory = resolve(outputRoot, '07_Modelos');
    const mlDataDirectory = resolve(mlRoot, 'data');
    const mlArtifactDirectory = resolve(mlRoot, 'artifacts');
    const mlReportDirectory = resolve(mlRoot, 'reports');
    await Promise.all([
      mkdir(datasetDirectory, { recursive: true }),
      mkdir(modelDirectory, { recursive: true }),
      mkdir(mlDataDirectory, { recursive: true }),
      mkdir(mlArtifactDirectory, { recursive: true }),
      mkdir(mlReportDirectory, { recursive: true }),
    ]);

    const headers = [
      'study_id',
      'code',
      'name',
      'price',
      'delivery_hours',
      'parameter_count',
      'request_count',
      'synthetic_request_count',
      'sample_type',
      'analysis_method',
      'requires_special_processing',
      'is_synthetic',
    ];
    const csvRows = bundle.dataset.map((row) =>
      [
        row.studyId,
        row.code,
        row.name,
        row.price,
        row.deliveryHours,
        row.parameterCount,
        row.requestCount,
        row.syntheticRequestCount ?? 0,
        row.sampleType,
        row.analysisMethod,
        row.requiresSpecialProcessing,
        row.isSynthetic === true,
      ]
        .map(csvCell)
        .join(','),
    );
    const csv = `\uFEFF${headers.join(',')}\n${csvRows.join('\n')}\n`;
    const artifactDocument = {
      ...bundle.artifact,
      deployment,
      evaluation: bundle.evaluation,
      profiles: bundle.profiles,
      dataQuality: bundle.dataQuality,
      warnings: bundle.warnings,
      sources: bundle.metadata.sources,
    };
    const metadataDocument = { ...bundle.metadata, deployment };

    const datasetPath = resolve(datasetDirectory, 'clustering_estudios.csv');
    const metadataPath = resolve(
      datasetDirectory,
      'clustering_estudios_metadata.json',
    );
    const artifactPath = resolve(
      modelDirectory,
      'clustering_estudios_model.json',
    );
    const mlDatasetPath = resolve(mlDataDirectory, 'clustering_estudios.csv');
    const mlMetadataPath = resolve(
      mlReportDirectory,
      'clustering_estudios_metadata.json',
    );
    const mlArtifactPath = resolve(
      mlArtifactDirectory,
      'clustering_estudios_model.json',
    );
    await Promise.all([
      writeFile(datasetPath, csv, 'utf8'),
      writeFile(mlDatasetPath, csv, 'utf8'),
      writeFile(
        metadataPath,
        `${JSON.stringify(metadataDocument, null, 2)}\n`,
        'utf8',
      ),
      writeFile(
        mlMetadataPath,
        `${JSON.stringify(metadataDocument, null, 2)}\n`,
        'utf8',
      ),
      writeFile(
        artifactPath,
        `${JSON.stringify(artifactDocument, null, 2)}\n`,
        'utf8',
      ),
      writeFile(
        mlArtifactPath,
        `${JSON.stringify(artifactDocument, null, 2)}\n`,
        'utf8',
      ),
    ]);

    process.stdout.write(
      `${JSON.stringify(
        {
          message: 'Dataset y artefacto de clustering exportados.',
          datasetPath,
          metadataPath,
          artifactPath,
          rows: bundle.dataset.length,
          composition: bundle.metadata.composition,
          selectedK: bundle.evaluation.selectedK,
          silhouetteScore: bundle.evaluation.silhouetteScore,
          daviesBouldinScore: bundle.evaluation.daviesBouldinScore,
          datasetFingerprintSha256: bundle.metadata.datasetFingerprintSha256,
          deployment,
        },
        null,
        2,
      )}\n`,
    );
  } finally {
    await application.close();
  }
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`No fue posible exportar clustering: ${message}\n`);
  process.exitCode = 1;
});
