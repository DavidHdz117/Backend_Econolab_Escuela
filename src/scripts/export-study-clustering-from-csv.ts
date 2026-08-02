import { createHash } from 'crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { parseCsv, toCsv } from '../common/utils/csv.util';
import {
  StudyClusteringArtifact,
  StudyClusteringModel,
  StudyClusteringRow,
} from '../study-clustering/models/study-clustering.model';

type StoredStudyClusteringArtifact = StudyClusteringArtifact & {
  generatedAt: string;
  trainingPeriod: { start: string; end: string; months: number };
  datasetFingerprintSha256: string;
  datasetComposition: {
    totalRows: number;
    realRows: number;
    syntheticRows: number;
    syntheticPercentage: number;
    totalRequestCount: number;
    syntheticRequestCount: number;
    syntheticRequestPercentage: number;
  };
};

const BACKEND_ROOT = process.cwd();
const ML_ROOT = resolve(BACKEND_ROOT, 'ml', 'clustering');
const DATASET_PATH = resolve(BACKEND_ROOT, '05_Datasets', 'clustering_estudios.csv');
const ML_DATASET_PATH = resolve(ML_ROOT, 'data', 'clustering_estudios.csv');
const METADATA_PATH = resolve(
  BACKEND_ROOT,
  '05_Datasets',
  'clustering_estudios_metadata.json',
);
const ASSIGNMENTS_PATH = resolve(
  BACKEND_ROOT,
  '05_Datasets',
  'clustering_estudios_asignaciones.csv',
);
const ML_METADATA_PATH = resolve(
  ML_ROOT,
  'reports',
  'clustering_estudios_metadata.json',
);
const ML_ASSIGNMENTS_PATH = resolve(
  ML_ROOT,
  'reports',
  'clustering_estudios_asignaciones.csv',
);
const ARTIFACT_PATH = resolve(
  BACKEND_ROOT,
  '07_Modelos',
  'clustering_estudios_model.json',
);
const ML_ARTIFACT_PATH = resolve(
  ML_ROOT,
  'artifacts',
  'clustering_estudios_model.json',
);

const HEADERS = [
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

const toNumberOrNull = (value: unknown) => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const toStringOrNull = (value: unknown) => {
  if (value === null || value === undefined) return null;
  const parsed = String(value).trim();
  return parsed || null;
};

const toBooleanOrNull = (value: unknown) => {
  const parsed = String(value ?? '').trim().toLowerCase();
  if (!parsed) return null;
  if (['true', '1', 'yes', 'si'].includes(parsed)) return true;
  if (['false', '0', 'no'].includes(parsed)) return false;
  return null;
};

const toCsvBooleanValue = (value: boolean | null) => {
  if (value === null) return '';
  return value ? 'true' : 'false';
};

const dataSources = () => ({
  price: 'operativo.studies.normalPrice',
  deliveryHours: 'operativo.studies.durationMinutes / 60',
  parameterCount: 'operativo.study_details',
  requestCount: 'operativo.service_order_items + operativo.service_orders',
  syntheticRequestCount:
    "misma fuente; SUM(quantity) cuando folio LIKE 'ECO-ML-%' (solo auditoria)",
  sampleType: 'operativo.studies.sampleType',
  analysisMethod: 'operativo.studies.method',
  requiresSpecialProcessing: 'operativo.studies.requiresSpecialProcessing',
  isSynthetic:
    "operativo.studies.code LIKE 'ECN-CAT-%' (solo auditoria; no entra al modelo)",
});

const datasetFingerprint = (dataset: StudyClusteringRow[]) => {
  const canonicalRows = [...dataset]
    .sort((left, right) => left.studyId - right.studyId)
    .map((row) => ({
      studyId: row.studyId,
      code: row.code,
      name: row.name,
      price: row.price,
      deliveryHours: row.deliveryHours,
      parameterCount: row.parameterCount,
      requestCount: row.requestCount,
      syntheticRequestCount: row.syntheticRequestCount ?? 0,
      sampleType: row.sampleType,
      analysisMethod: row.analysisMethod,
      requiresSpecialProcessing: row.requiresSpecialProcessing,
      isSynthetic: row.isSynthetic === true,
    }));
  return createHash('sha256')
    .update(JSON.stringify(canonicalRows), 'utf8')
    .digest('hex');
};

const enrichArtifact = (
  artifact: StudyClusteringArtifact,
  dataset: StudyClusteringRow[],
  periodStart: Date,
  periodEnd: Date,
  periodMonths: number,
): StoredStudyClusteringArtifact => {
  const syntheticRows = dataset.filter((row) => row.isSynthetic).length;
  const totalRequestCount = dataset.reduce(
    (sum, row) => sum + Number(row.requestCount ?? 0),
    0,
  );
  const syntheticRequestCount = dataset.reduce(
    (sum, row) => sum + Number(row.syntheticRequestCount ?? 0),
    0,
  );
  return {
    ...artifact,
    generatedAt: periodEnd.toISOString(),
    trainingPeriod: {
      start: periodStart.toISOString(),
      end: periodEnd.toISOString(),
      months: periodMonths,
    },
    datasetFingerprintSha256: datasetFingerprint(dataset),
    datasetComposition: {
      totalRows: dataset.length,
      realRows: dataset.length - syntheticRows,
      syntheticRows,
      syntheticPercentage: Number(
        ((syntheticRows / Math.max(dataset.length, 1)) * 100).toFixed(2),
      ),
      totalRequestCount,
      syntheticRequestCount,
      syntheticRequestPercentage: Number(
        (
          (syntheticRequestCount / Math.max(totalRequestCount, 1)) *
          100
        ).toFixed(2),
      ),
    },
  };
};

function loadRows() {
  const [headerRow, ...dataRows] = parseCsv(readFileSync(DATASET_PATH, 'utf8'));
  const headers = headerRow.map((value) => value.trim());
  return dataRows.map((row) =>
    Object.fromEntries(headers.map((header, index) => [header, row[index] ?? ''])),
  ) as Array<Record<string, string>>;
}

function main() {
  for (const directory of ['data', 'artifacts', 'reports']) {
    mkdirSync(resolve(ML_ROOT, directory), { recursive: true });
  }
  mkdirSync(resolve(BACKEND_ROOT, '05_Datasets'), { recursive: true });
  mkdirSync(resolve(BACKEND_ROOT, '07_Modelos'), { recursive: true });

  const rawRows = loadRows();
  const dataset: StudyClusteringRow[] = rawRows.map((row) => ({
    studyId: Number(row.study_id),
    code: String(row.code ?? ''),
    name: String(row.name ?? ''),
    price: toNumberOrNull(row.price),
    deliveryHours: toNumberOrNull(row.delivery_hours),
    parameterCount: toNumberOrNull(row.parameter_count),
    requestCount: toNumberOrNull(row.request_count),
    syntheticRequestCount: toNumberOrNull(row.synthetic_request_count),
    sampleType: toStringOrNull(row.sample_type),
    analysisMethod: toStringOrNull(row.analysis_method),
    requiresSpecialProcessing: toBooleanOrNull(row.requires_special_processing),
    isSynthetic: toBooleanOrNull(row.is_synthetic) === true,
  }));

  const csv = toCsv(
    HEADERS,
    dataset.map((row) => [
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
      toCsvBooleanValue(row.requiresSpecialProcessing),
      toCsvBooleanValue(row.isSynthetic === true),
    ]),
  );
  writeFileSync(DATASET_PATH, csv, 'utf8');
  writeFileSync(ML_DATASET_PATH, csv, 'utf8');

  const model = new StudyClusteringModel();
  const result = model.analyze(dataset, { maxK: 6 });
  const periodEnd = new Date();
  const periodStart = new Date(periodEnd);
  periodStart.setUTCMonth(periodStart.getUTCMonth() - 6);
  const artifact = enrichArtifact(
    result.artifact,
    dataset,
    periodStart,
    periodEnd,
    6,
  );

  const artifactDocument = {
    ...artifact,
    deployment: { persisted: false },
    evaluation: {
      selectedK: result.model.selectedK,
      elbowK: result.model.elbowK,
      silhouetteScore: result.model.silhouetteScore,
      daviesBouldinScore: result.model.daviesBouldinScore,
      inertia: result.model.inertia,
      alternatives: result.evaluations,
    },
    profiles: result.profiles,
    dataQuality: result.dataQuality,
    warnings: result.warnings,
    sources: dataSources(),
  };
  const metadataDocument = {
    generatedAt: periodEnd.toISOString(),
    periodStart: periodStart.toISOString(),
    periodEnd: periodEnd.toISOString(),
    periodMonths: 6,
    unitOfAnalysis: 'Un estudio individual activo del catalogo ECONOLAB',
    datasetFingerprintSha256: artifact.datasetFingerprintSha256,
    composition: artifact.datasetComposition,
    sources: dataSources(),
    exclusions: [
      'Paquetes, estudios inactivos o suspendidos',
      'MLTRAIN y registros marcados como DATOS SINTETICOS',
      'Ordenes canceladas para calcular request_count',
    ],
  };
  const assignmentsCsv = toCsv(
    [
      'study_id',
      'code',
      'name',
      'cluster',
      'distance_to_centroid',
      'outlier_score',
      'is_outlier',
      'is_synthetic',
      'price',
      'delivery_hours',
      'parameter_count',
      'request_count',
      'sample_type',
      'analysis_method',
      'requires_special_processing',
    ],
    result.studies.map((study) => [
      study.studyId,
      study.code,
      study.name,
      study.cluster,
      study.distanceToCentroid,
      study.outlierScore,
      toCsvBooleanValue(study.isOutlier),
      toCsvBooleanValue(study.isSynthetic === true),
      study.values.price,
      study.values.deliveryHours,
      study.values.parameterCount,
      study.values.requestCount,
      study.values.sampleType,
      study.values.analysisMethod,
      toCsvBooleanValue(study.values.requiresSpecialProcessing),
    ]),
  );

  writeFileSync(ARTIFACT_PATH, `${JSON.stringify(artifactDocument, null, 2)}\n`, 'utf8');
  writeFileSync(ML_ARTIFACT_PATH, `${JSON.stringify(artifactDocument, null, 2)}\n`, 'utf8');
  writeFileSync(METADATA_PATH, `${JSON.stringify(metadataDocument, null, 2)}\n`, 'utf8');
  writeFileSync(ML_METADATA_PATH, `${JSON.stringify(metadataDocument, null, 2)}\n`, 'utf8');
  writeFileSync(ASSIGNMENTS_PATH, assignmentsCsv, 'utf8');
  writeFileSync(ML_ASSIGNMENTS_PATH, assignmentsCsv, 'utf8');

  console.log(
    JSON.stringify(
      {
        dataset: '05_Datasets/clustering_estudios.csv',
        artifact: '07_Modelos/clustering_estudios_model.json',
        metadata: '05_Datasets/clustering_estudios_metadata.json',
        assignments: '05_Datasets/clustering_estudios_asignaciones.csv',
        rows: dataset.length,
        selectedK: result.model.selectedK,
        silhouette: result.model.silhouetteScore,
        daviesBouldin: result.model.daviesBouldinScore,
      },
      null,
      2,
    ),
  );
}

main();
