/**
 * Pipeline reproducible de clasificacion:
 *   1) ejecuta un SELECT de PostgreSQL;
 *   2) valida y exporta el dataset CSV;
 *   3) entrena con el pasado y evalua con un holdout temporal futuro;
 *   4) guarda el modelo JSON que carga el backend.
 *
 * Uso (desde backend): npm run classification:train
 */
import { createHash } from 'crypto';
import {
  copyFileSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'fs';
import { resolve } from 'path';
import { config as loadEnvironment } from 'dotenv';
import { Client } from 'pg';
import { toCsv } from '../common/utils/csv.util';
import {
  SERVICE_OUTCOME_CLASSES,
  ServiceOutcomeClass,
  ServiceOutcomeFeatures,
  ServiceOutcomePredictionModel,
  ServiceOutcomeTrainingRow,
} from '../services/models/service-outcome-prediction.model';

type DatabaseRow = Record<string, unknown> & {
  order_id: unknown;
  source_folio: unknown;
  is_synthetic: unknown;
  source_created_at: unknown;
  source_updated_at: unknown;
  outcome: unknown;
};

const BACKEND_ROOT = process.cwd();
const ML_ROOT = resolve(BACKEND_ROOT, 'ml', 'classification');
const QUERY_PATH = resolve(ML_ROOT, '01_extract_classification_dataset.sql');
const CSV_PATH = resolve(
  ML_ROOT,
  'data',
  'classification_service_outcomes.csv',
);
const TRAIN_CSV_PATH = resolve(
  ML_ROOT,
  'data',
  'classification_service_outcomes_train.csv',
);
const TEST_CSV_PATH = resolve(
  ML_ROOT,
  'data',
  'classification_service_outcomes_test.csv',
);
const ARTIFACT_PATH = resolve(
  ML_ROOT,
  'artifacts',
  'classification_service_outcome_model.json',
);
const REPORT_PATH = resolve(
  ML_ROOT,
  'reports',
  'classification_training_report.json',
);
const CANONICAL_QUERY_PATH = resolve(
  BACKEND_ROOT,
  '04_ETL',
  '03_clasificacion_extraer_dataset.sql',
);
const CANONICAL_CSV_PATH = resolve(
  BACKEND_ROOT,
  '05_Datasets',
  '03_clasificacion_resultado_servicios.csv',
);
const CANONICAL_TRAIN_CSV_PATH = resolve(
  BACKEND_ROOT,
  '05_Datasets',
  '03_clasificacion_resultado_servicios_train.csv',
);
const CANONICAL_TEST_CSV_PATH = resolve(
  BACKEND_ROOT,
  '05_Datasets',
  '03_clasificacion_resultado_servicios_test.csv',
);
const CANONICAL_ARTIFACT_PATH = resolve(
  BACKEND_ROOT,
  '07_Modelos',
  'classification_service_outcome_model.json',
);
const CANONICAL_REPORT_PATH = resolve(
  BACKEND_ROOT,
  '07_Modelos',
  'classification_training_report.json',
);
const CANONICAL_MODEL_CARD_PATH = resolve(
  BACKEND_ROOT,
  '07_Modelos',
  'classification_model_card.md',
);

const FEATURE_COLUMNS: Array<{
  csv: string;
  model: keyof ServiceOutcomeFeatures;
  kind: 'number' | 'string';
}> = [
  { csv: 'promised_lead_hours', model: 'promisedLeadHours', kind: 'number' },
  { csv: 'registration_hour', model: 'registrationHour', kind: 'number' },
  {
    csv: 'registration_weekday',
    model: 'registrationWeekday',
    kind: 'number',
  },
  { csv: 'item_count', model: 'itemCount', kind: 'number' },
  { csv: 'total_quantity', model: 'totalQuantity', kind: 'number' },
  {
    csv: 'distinct_study_count',
    model: 'distinctStudyCount',
    kind: 'number',
  },
  {
    csv: 'package_component_count',
    model: 'packageComponentCount',
    kind: 'number',
  },
  { csv: 'subtotal_amount', model: 'subtotalAmount', kind: 'number' },
  { csv: 'courtesy_percent', model: 'courtesyPercent', kind: 'number' },
  { csv: 'discount_amount', model: 'discountAmount', kind: 'number' },
  { csv: 'total_amount', model: 'totalAmount', kind: 'number' },
  { csv: 'branch_name', model: 'branchName', kind: 'string' },
  {
    csv: 'dominant_price_type',
    model: 'dominantPriceType',
    kind: 'string',
  },
];

const CSV_HEADERS = [
  'order_id',
  'source_folio',
  'is_synthetic',
  'source_created_at',
  'source_updated_at',
  ...FEATURE_COLUMNS.map((column) => column.csv),
  'outcome',
];

const requireEnvironment = (name: string) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Falta la variable de entorno ${name}.`);
  return value;
};

const resolveSsl = () => {
  const value = process.env.DATABASE_SSL?.trim().toLowerCase();
  return value && ['false', '0', 'off'].includes(value)
    ? false
    : { rejectUnauthorized: false };
};

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

const toIsoTimestampOrNull = (value: unknown) => {
  const parsed = value instanceof Date ? value : new Date(String(value ?? ''));
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
};

const isOutcome = (value: unknown): value is ServiceOutcomeClass =>
  SERVICE_OUTCOME_CLASSES.includes(value as ServiceOutcomeClass);

const writeJsonAtomically = (path: string, value: unknown) => {
  const temporaryPath = `${path}.tmp`;
  writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  renameSync(temporaryPath, path);
};

const databaseRowsToCsv = (rows: DatabaseRow[]) =>
  toCsv(
    CSV_HEADERS,
    rows.map((row) =>
      CSV_HEADERS.map((column) => {
        const value = row[column];
        if (value instanceof Date) return value.toISOString();
        if (typeof value === 'boolean') return value ? 1 : 0;
        return value as string | number | null | undefined;
      }),
    ),
  );

const roundMetric = (value: number) => Math.round(value * 10_000) / 10_000;

const quantile = (sortedValues: number[], probability: number) => {
  if (sortedValues.length === 1) return sortedValues[0];
  const position = (sortedValues.length - 1) * probability;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  const weight = position - lower;
  return sortedValues[lower] * (1 - weight) + sortedValues[upper] * weight;
};

/** EDA reproducible de las X: estadisticos, cardinalidad e IQR/outliers. */
const buildFeatureEda = (rows: DatabaseRow[]) => ({
  numeric: Object.fromEntries(
    FEATURE_COLUMNS.filter((column) => column.kind === 'number').map(
      (column) => {
        const values = rows
          .map((row) => toNumberOrNull(row[column.csv]))
          .filter((value): value is number => value !== null)
          .sort((left, right) => left - right);
        const mean =
          values.reduce((total, value) => total + value, 0) /
          Math.max(values.length, 1);
        const variance =
          values.reduce((total, value) => total + (value - mean) ** 2, 0) /
          Math.max(values.length, 1);
        const frequencies = new Map<number, number>();
        for (const value of values) {
          frequencies.set(value, (frequencies.get(value) ?? 0) + 1);
        }
        const dominantValueProportion =
          Math.max(...frequencies.values()) / Math.max(values.length, 1);
        const q1 = quantile(values, 0.25);
        const median = quantile(values, 0.5);
        const q3 = quantile(values, 0.75);
        const iqr = q3 - q1;
        const lowerFence = q1 - 1.5 * iqr;
        const upperFence = q3 + 1.5 * iqr;
        const outlierCount = values.filter(
          (value) => value < lowerFence || value > upperFence,
        ).length;
        return [
          column.csv,
          {
            nonNullCount: values.length,
            nullCount: rows.length - values.length,
            uniqueCount: new Set(values).size,
            dominantValueProportion: roundMetric(dominantValueProportion),
            lowVariability: dominantValueProportion >= 0.99,
            mean: roundMetric(mean),
            standardDeviation: roundMetric(Math.sqrt(variance)),
            minimum: values[0],
            q1: roundMetric(q1),
            median: roundMetric(median),
            q3: roundMetric(q3),
            maximum: values[values.length - 1],
            iqr: roundMetric(iqr),
            iqrOutlierCount: outlierCount,
            iqrOutlierProportion: roundMetric(
              outlierCount / Math.max(values.length, 1),
            ),
          },
        ];
      },
    ),
  ),
  categorical: Object.fromEntries(
    FEATURE_COLUMNS.filter((column) => column.kind === 'string').map(
      (column) => {
        const counts = new Map<string, number>();
        let nullCount = 0;
        for (const row of rows) {
          const value = toStringOrNull(row[column.csv]);
          if (!value) {
            nullCount += 1;
            continue;
          }
          counts.set(value, (counts.get(value) ?? 0) + 1);
        }
        return [
          column.csv,
          {
            nullCount,
            cardinality: counts.size,
            dominantValueProportion: roundMetric(
              Math.max(...counts.values()) / Math.max(rows.length, 1),
            ),
            lowVariability:
              Math.max(...counts.values()) / Math.max(rows.length, 1) >= 0.99,
            mostFrequent: [...counts.entries()]
              .sort(
                ([leftName, leftCount], [rightName, rightCount]) =>
                  rightCount - leftCount || leftName.localeCompare(rightName),
              )
              .slice(0, 10)
              .map(([value, count]) => ({ value, count })),
          },
        ];
      },
    ),
  ),
});

async function main() {
  loadEnvironment({ path: resolve(BACKEND_ROOT, '.env') });
  for (const directory of ['data', 'artifacts', 'reports']) {
    mkdirSync(resolve(ML_ROOT, directory), { recursive: true });
  }
  for (const directory of ['04_ETL', '05_Datasets', '07_Modelos']) {
    mkdirSync(resolve(BACKEND_ROOT, directory), { recursive: true });
  }
  copyFileSync(QUERY_PATH, CANONICAL_QUERY_PATH);

  const client = new Client({
    host: requireEnvironment('DATABASE_HOST'),
    port: Number(process.env.DATABASE_PORT ?? 5432),
    user: requireEnvironment('DATABASE_USER'),
    password: requireEnvironment('DATABASE_PASS'),
    database: requireEnvironment('DATABASE_NAME'),
    ssl: resolveSsl(),
  });

  await client.connect();
  let databaseRows: DatabaseRow[];
  try {
    // AQUÍ SE JALAN LOS DATOS DE LA BD: el SQL es visible y versionable.
    const query = readFileSync(QUERY_PATH, 'utf8');
    databaseRows = (await client.query(query)).rows as DatabaseRow[];
  } finally {
    await client.end();
  }

  const seenIds = new Set<number>();
  const trainingRows: ServiceOutcomeTrainingRow[] = [];
  const acceptedDatabaseRows: DatabaseRow[] = [];
  const rejectedByReason: Record<string, number> = {
    invalid_order_id: 0,
    duplicate_order_id: 0,
    invalid_target_y: 0,
    invalid_source_created_at: 0,
    missing_or_nonpositive_lead_hours: 0,
    missing_items: 0,
    invalid_numeric_values: 0,
  };
  const nullsByColumn = Object.fromEntries(
    CSV_HEADERS.map((column) => [column, 0]),
  ) as Record<string, number>;

  for (const row of databaseRows) {
    for (const column of CSV_HEADERS) {
      if (
        row[column] === null ||
        row[column] === undefined ||
        row[column] === ''
      ) {
        nullsByColumn[column] += 1;
      }
    }

    const orderId = Number(row.order_id);
    if (!Number.isInteger(orderId) || orderId <= 0) {
      rejectedByReason.invalid_order_id += 1;
      continue;
    }
    if (seenIds.has(orderId)) {
      rejectedByReason.duplicate_order_id += 1;
      continue;
    }
    if (!isOutcome(row.outcome)) {
      rejectedByReason.invalid_target_y += 1;
      continue;
    }
    const sourceCreatedAt = toIsoTimestampOrNull(row.source_created_at);
    if (!sourceCreatedAt) {
      rejectedByReason.invalid_source_created_at += 1;
      continue;
    }

    const leadHours = toNumberOrNull(row.promised_lead_hours);
    if (leadHours === null || leadHours <= 0) {
      rejectedByReason.missing_or_nonpositive_lead_hours += 1;
      continue;
    }
    const itemCount = toNumberOrNull(row.item_count);
    if (itemCount === null || itemCount <= 0) {
      rejectedByReason.missing_items += 1;
      continue;
    }
    const registrationHour = toNumberOrNull(row.registration_hour);
    const registrationWeekday = toNumberOrNull(row.registration_weekday);
    const totalQuantity = toNumberOrNull(row.total_quantity);
    const distinctStudyCount = toNumberOrNull(row.distinct_study_count);
    const packageComponentCount = toNumberOrNull(row.package_component_count);
    const subtotalAmount = toNumberOrNull(row.subtotal_amount);
    const courtesyPercent = toNumberOrNull(row.courtesy_percent);
    const discountAmount = toNumberOrNull(row.discount_amount);
    const totalAmount = toNumberOrNull(row.total_amount);
    const invalidNumericValues =
      registrationHour === null ||
      registrationHour < 0 ||
      registrationHour >= 24 ||
      registrationWeekday === null ||
      !Number.isInteger(registrationWeekday) ||
      registrationWeekday < 0 ||
      registrationWeekday > 6 ||
      !Number.isInteger(itemCount) ||
      totalQuantity === null ||
      totalQuantity < 1 ||
      distinctStudyCount === null ||
      distinctStudyCount < 1 ||
      packageComponentCount === null ||
      packageComponentCount < 0 ||
      subtotalAmount === null ||
      subtotalAmount < 0 ||
      courtesyPercent === null ||
      courtesyPercent < 0 ||
      courtesyPercent > 100 ||
      discountAmount === null ||
      discountAmount < 0 ||
      discountAmount > subtotalAmount ||
      totalAmount === null ||
      totalAmount < 0 ||
      Math.abs(totalAmount - (subtotalAmount - discountAmount)) > 0.02;
    if (invalidNumericValues) {
      rejectedByReason.invalid_numeric_values += 1;
      continue;
    }

    const trainingRow: ServiceOutcomeTrainingRow = {
      orderId,
      sourceCreatedAt,
      outcome: row.outcome,
    };
    for (const column of FEATURE_COLUMNS) {
      Object.assign(trainingRow, {
        [column.model]:
          column.kind === 'number'
            ? toNumberOrNull(row[column.csv])
            : toStringOrNull(row[column.csv]),
      });
    }
    trainingRows.push(trainingRow);
    acceptedDatabaseRows.push(row);
    seenIds.add(orderId);
  }

  // Orden cronologico para que el dataset completo y sus particiones sean
  // faciles de auditar visualmente.
  acceptedDatabaseRows.sort((left, right) => {
    const difference =
      Date.parse(String(left.source_created_at)) -
      Date.parse(String(right.source_created_at));
    return difference || Number(left.order_id) - Number(right.order_id);
  });

  // AQUÍ SE CREA EL DATASET CSV. Las columnas de auditoria no son X.
  const csv = databaseRowsToCsv(acceptedDatabaseRows);
  writeFileSync(CSV_PATH, csv, 'utf8');
  writeFileSync(CANONICAL_CSV_PATH, csv, 'utf8');

  const datasetSha256 = createHash('sha256').update(csv).digest('hex');
  const sourceWatermark = acceptedDatabaseRows
    .map((row) => new Date(String(row.source_updated_at)))
    .filter((date) => !Number.isNaN(date.getTime()))
    .sort((left, right) => right.getTime() - left.getTime())[0]
    ?.toISOString();
  if (!sourceWatermark) throw new Error('El dataset no tiene fecha de origen.');

  // AQUÍ SE GENERA/ENTRENA EL MODELO y se evalua contra test.
  const model = new ServiceOutcomePredictionModel();
  const evaluationSplit = model.createEvaluationSplit(trainingRows);
  const trainingIds = new Set(evaluationSplit.trainingOrderIds);
  const testIds = new Set(evaluationSplit.testOrderIds);
  const trainingCsv = databaseRowsToCsv(
    acceptedDatabaseRows.filter((row) => trainingIds.has(Number(row.order_id))),
  );
  const testCsv = databaseRowsToCsv(
    acceptedDatabaseRows.filter((row) => testIds.has(Number(row.order_id))),
  );
  writeFileSync(TRAIN_CSV_PATH, trainingCsv, 'utf8');
  writeFileSync(TEST_CSV_PATH, testCsv, 'utf8');
  writeFileSync(CANONICAL_TRAIN_CSV_PATH, trainingCsv, 'utf8');
  writeFileSync(CANONICAL_TEST_CSV_PATH, testCsv, 'utf8');

  const artifact = model.trainArtifact(trainingRows, {
    datasetSha256,
    sourceWatermark,
  });
  writeJsonAtomically(ARTIFACT_PATH, artifact);
  writeJsonAtomically(CANONICAL_ARTIFACT_PATH, artifact);

  const syntheticRows = acceptedDatabaseRows.filter(
    (row) => row.is_synthetic === true,
  ).length;
  const qualityReport = {
    reportType: 'econolab_classification_training_report',
    generatedFromSourceWatermark: sourceWatermark,
    sourceQuery: 'ml/classification/01_extract_classification_dataset.sql',
    datasetCsv: 'ml/classification/data/classification_service_outcomes.csv',
    modelArtifact:
      'ml/classification/artifacts/classification_service_outcome_model.json',
    datasetSha256,
    evaluationSplit: {
      strategy: artifact.model.validationStrategy,
      orderingField: artifact.model.orderingField,
      chronological: true,
      requestedTestFraction: artifact.model.testFraction,
      trainingCsv: '05_Datasets/03_clasificacion_resultado_servicios_train.csv',
      testCsv: '05_Datasets/03_clasificacion_resultado_servicios_test.csv',
      trainingRows: evaluationSplit.trainingOrderIds.length,
      testRows: evaluationSplit.testOrderIds.length,
      eligiblePeriod: evaluationSplit.eligiblePeriod,
      trainingPeriod: evaluationSplit.trainingPeriod,
      testPeriod: evaluationSplit.testPeriod,
      trainingClassDistribution: evaluationSplit.trainingClassDistribution,
      testClassDistribution: evaluationSplit.testClassDistribution,
      trainEndsBeforeTestStarts:
        Date.parse(evaluationSplit.trainingPeriod.end) <=
        Date.parse(evaluationSplit.testPeriod.start),
      overlapCount: evaluationSplit.trainingOrderIds.filter((id) =>
        testIds.has(id),
      ).length,
    },
    traceability: {
      rowUnit: 'una orden de servicio historica',
      predictorsX: artifact.dataset.predictorsX,
      targetY: artifact.dataset.targetY,
      auditOnlyNotUsedAsX: [
        'order_id',
        'source_folio',
        'source_created_at',
        'source_updated_at',
        'is_synthetic',
      ],
    },
    quality: {
      rowsExtracted: databaseRows.length,
      rowsAccepted: trainingRows.length,
      rowsRejected: databaseRows.length - trainingRows.length,
      rejectedByReason,
      duplicateOrderIds: rejectedByReason.duplicate_order_id,
      nullsByColumn,
      syntheticRows,
      realRows: trainingRows.length - syntheticRows,
      syntheticProportion: Number(
        (syntheticRows / Math.max(trainingRows.length, 1)).toFixed(4),
      ),
    },
    classDistribution: artifact.dataset.classDistribution,
    classWeights: artifact.dataset.classWeights,
    exploratoryAnalysisX: buildFeatureEda(acceptedDatabaseRows),
    evaluation: artifact.evaluation,
  };
  writeJsonAtomically(REPORT_PATH, qualityReport);
  writeJsonAtomically(CANONICAL_REPORT_PATH, qualityReport);
  writeFileSync(
    CANONICAL_MODEL_CARD_PATH,
    `# Model card — clasificación del resultado de servicios

## Propósito

Pronostica \`completed_on_time\`, \`delayed\` o \`cancelled\` al registrar o
consultar una orden activa. Es apoyo administrativo: no cambia estados, no
bloquea servicios y no toma decisiones clínicas.

## Datos y trazabilidad

- Unidad: una orden histórica.
- SQL: \`04_ETL/03_clasificacion_extraer_dataset.sql\`.
- CSV: \`05_Datasets/03_clasificacion_resultado_servicios.csv\`.
- Y: \`outcome\`, obtenida solo de estado y fechas finales.
- X: ${artifact.dataset.predictorsX.join(', ')}.
- Solo auditoría, nunca X: ID, folio, fechas de creación/actualización e \`is_synthetic\`.
- Periodo elegible: ${artifact.dataset.eligiblePeriod.start} a ${artifact.dataset.eligiblePeriod.end}.
- SHA-256 del CSV: \`${datasetSha256}\`.
- Calidad: ${trainingRows.length} filas aceptadas, ${databaseRows.length - trainingRows.length} rechazadas y ${rejectedByReason.duplicate_order_id} IDs duplicados.
- Procedencia: ${syntheticRows} sintéticas y ${trainingRows.length - syntheticRows} reales (${qualityReport.quality.syntheticProportion} sintético).

## EDA de variables X y decisiones

- El reporte JSON conserva estadísticos descriptivos, cardinalidad, proporción dominante y outliers IQR de cada X candidata.
- Se excluyen del artefacto las variables constantes o con al menos 99 % del mismo valor aprendidas en train: ${
      FEATURE_COLUMNS.filter(
        (column) => !artifact.dataset.predictorsX.includes(column.model),
      )
        .map((column) => column.csv)
        .join(', ') || 'ninguna'
    }.
- Los valores extremos IQR se conservan si son válidos operativamente; el escalado se aprende solo con train y se debe vigilar su deriva.

## Modelo y validación

- Regresión logística multinomial.
- Holdout temporal: las primeras ${artifact.dataset.trainingSamples} órdenes (${artifact.dataset.trainingPeriod.start} a ${artifact.dataset.trainingPeriod.end}) forman train y las ${artifact.dataset.evaluationTestSamples} más recientes (${artifact.dataset.testPeriod.start} a ${artifact.dataset.testPeriod.end}) forman test.
- Las tres clases están presentes en train y test; no se estratifica ni se mezclan fechas futuras.
- Imputación, estandarización, one-hot y pesos del artefacto desplegado se aprenden solo con train.
- Desbalance tratado con pesos inversos por clase.
- Baseline: clase mayoritaria de train.

| Métrica | Clasificador | Baseline |
| --- | ---: | ---: |
| Accuracy | ${artifact.evaluation.accuracy} | ${artifact.evaluation.baseline.accuracy} |
| Macro F1 | ${artifact.evaluation.macroAverage.f1Score} | ${artifact.evaluation.baseline.macroAverage.f1Score} |

| Clase | Precision | Recall | F1 | Soporte |
| --- | ---: | ---: | ---: | ---: |
${SERVICE_OUTCOME_CLASSES.map((outcome) => {
  const metrics = artifact.evaluation.metricsByClass[outcome];
  return `| ${outcome} | ${metrics.precision} | ${metrics.recall} | ${metrics.f1Score} | ${metrics.support} |`;
}).join('\n')}

## Despliegue

El backend carga \`classification_service_outcome_model.json\` una vez y lo
conserva en memoria. Las solicitudes solo realizan inferencia; no reentrenan.

\`npm run classification:train\` regenera CSV, reporte, model card y artefacto.
\`npm run classification:notebook\` ejecuta la evidencia visual.

## Limitaciones

La proporción sintética actual es ${qualityReport.quality.syntheticProportion}. Las métricas
validan el prototipo, no garantizan desempeño productivo. Se requiere acumular
historial real, validar por periodo/sucursal, revisar falsos negativos y vigilar
deriva antes de usar el resultado para decisiones operativas.
`,
    'utf8',
  );

  console.log(
    JSON.stringify(
      {
        dataset: '05_Datasets/03_clasificacion_resultado_servicios.csv',
        artifact: '07_Modelos/classification_service_outcome_model.json',
        report: '07_Modelos/classification_training_report.json',
        rows: trainingRows.length,
        syntheticRows,
        classDistribution: artifact.dataset.classDistribution,
        accuracy: artifact.evaluation.accuracy,
        baselineAccuracy: artifact.evaluation.baseline.accuracy,
        macroF1: artifact.evaluation.macroAverage.f1Score,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
