import { createHash } from 'crypto';
import {
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'fs';
import { resolve } from 'path';
import { parseCsv, toCsv } from '../common/utils/csv.util';
import {
  SERVICE_OUTCOME_CLASSES,
  ServiceOutcomeClass,
  ServiceOutcomeFeatures,
  ServiceOutcomePredictionModel,
  ServiceOutcomeTrainingRow,
} from '../services/models/service-outcome-prediction.model';

type CsvRow = Record<string, string>;

const BACKEND_ROOT = process.cwd();
const ML_ROOT = resolve(BACKEND_ROOT, 'ml', 'classification');
const CSV_PATH = resolve(
  BACKEND_ROOT,
  '05_Datasets',
  '03_clasificacion_resultado_servicios.csv',
);
const ML_CSV_PATH = resolve(ML_ROOT, 'data', 'classification_service_outcomes.csv');
const TRAIN_CSV_PATH = resolve(
  BACKEND_ROOT,
  '05_Datasets',
  '03_clasificacion_resultado_servicios_train.csv',
);
const TEST_CSV_PATH = resolve(
  BACKEND_ROOT,
  '05_Datasets',
  '03_clasificacion_resultado_servicios_test.csv',
);
const ML_TRAIN_CSV_PATH = resolve(
  ML_ROOT,
  'data',
  'classification_service_outcomes_train.csv',
);
const ML_TEST_CSV_PATH = resolve(
  ML_ROOT,
  'data',
  'classification_service_outcomes_test.csv',
);
const ARTIFACT_PATH = resolve(
  BACKEND_ROOT,
  '07_Modelos',
  'classification_service_outcome_model.json',
);
const ML_ARTIFACT_PATH = resolve(
  ML_ROOT,
  'artifacts',
  'classification_service_outcome_model.json',
);
const REPORT_PATH = resolve(
  BACKEND_ROOT,
  '07_Modelos',
  'classification_training_report.json',
);
const ML_REPORT_PATH = resolve(
  ML_ROOT,
  'reports',
  'classification_training_report.json',
);
const MODEL_CARD_PATH = resolve(
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

const roundMetric = (value: number) => Math.round(value * 10_000) / 10_000;

const isOutcome = (value: unknown): value is ServiceOutcomeClass =>
  SERVICE_OUTCOME_CLASSES.includes(value as ServiceOutcomeClass);

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

const isTruthySyntheticFlag = (value: unknown) => {
  const parsed = String(value ?? '').trim().toLowerCase();
  return ['true', '1', 'yes', 'si'].includes(parsed);
};

const toIsoTimestampOrNull = (value: unknown) => {
  const parsed = new Date(String(value ?? ''));
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
};

const writeJsonAtomically = (path: string, value: unknown) => {
  const temporaryPath = `${path}.tmp`;
  writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  renameSync(temporaryPath, path);
};

const toCsvValue = (header: string, row: CsvRow) =>
  header === 'is_synthetic'
    ? isTruthySyntheticFlag(row[header])
      ? 'true'
      : 'false'
    : (row[header] ?? '');

const quantile = (sortedValues: number[], probability: number) => {
  if (sortedValues.length === 1) return sortedValues[0];
  const position = (sortedValues.length - 1) * probability;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  const weight = position - lower;
  return sortedValues[lower] * (1 - weight) + sortedValues[upper] * weight;
};

const buildFeatureEda = (rows: CsvRow[]) => ({
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
        const dominant = counts.size > 0 ? Math.max(...counts.values()) : 0;
        return [
          column.csv,
          {
            nullCount,
            cardinality: counts.size,
            dominantValueProportion: roundMetric(
              dominant / Math.max(rows.length, 1),
            ),
            lowVariability: dominant / Math.max(rows.length, 1) >= 0.99,
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

function csvRowsToObjects() {
  const [headerRow, ...dataRows] = parseCsv(readFileSync(CSV_PATH, 'utf8'));
  const headers = headerRow.map((value) => value.trim());
  return dataRows.map((row) =>
    Object.fromEntries(headers.map((header, index) => [header, row[index] ?? ''])),
  ) as CsvRow[];
}

function main() {
  for (const directory of ['data', 'artifacts', 'reports']) {
    mkdirSync(resolve(ML_ROOT, directory), { recursive: true });
  }
  mkdirSync(resolve(BACKEND_ROOT, '05_Datasets'), { recursive: true });
  mkdirSync(resolve(BACKEND_ROOT, '07_Modelos'), { recursive: true });

  const csvRows = csvRowsToObjects();
  const nullsByColumn = Object.fromEntries(
    CSV_HEADERS.map((column) => [
      column,
      csvRows.filter((row) => !String(row[column] ?? '').trim()).length,
    ]),
  );

  const rejectedByReason = {
    invalid_order_id: 0,
    duplicate_order_id: 0,
    invalid_target_y: 0,
    invalid_source_created_at: 0,
    missing_or_nonpositive_lead_hours: 0,
    missing_items: 0,
    invalid_numeric_values: 0,
  };

  const seenIds = new Set<number>();
  const trainingRows: ServiceOutcomeTrainingRow[] = [];
  const acceptedRows: CsvRow[] = [];

  for (const row of csvRows) {
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
    const promisedLeadHours = toNumberOrNull(row.promised_lead_hours);
    const itemCount = toNumberOrNull(row.item_count);
    if (promisedLeadHours === null || promisedLeadHours <= 0) {
      rejectedByReason.missing_or_nonpositive_lead_hours += 1;
      continue;
    }
    if (itemCount === null || itemCount <= 0) {
      rejectedByReason.missing_items += 1;
      continue;
    }

    const totalQuantity = toNumberOrNull(row.total_quantity);
    const distinctStudyCount = toNumberOrNull(row.distinct_study_count);
    const packageComponentCount = toNumberOrNull(row.package_component_count);
    const subtotalAmount = toNumberOrNull(row.subtotal_amount);
    const courtesyPercent = toNumberOrNull(row.courtesy_percent);
    const discountAmount = toNumberOrNull(row.discount_amount);
    const totalAmount = toNumberOrNull(row.total_amount);
    const invalidNumericValues =
      totalQuantity === null ||
      totalQuantity < itemCount ||
      distinctStudyCount === null ||
      distinctStudyCount <= 0 ||
      distinctStudyCount > totalQuantity ||
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
    acceptedRows.push(row);
    seenIds.add(orderId);
  }

  acceptedRows.sort((left, right) => {
    const difference =
      Date.parse(String(left.source_created_at)) -
      Date.parse(String(right.source_created_at));
    return difference || Number(left.order_id) - Number(right.order_id);
  });

  const csv = toCsv(
    CSV_HEADERS,
    acceptedRows.map((row) => CSV_HEADERS.map((header) => toCsvValue(header, row))),
  );
  writeFileSync(CSV_PATH, csv, 'utf8');
  writeFileSync(ML_CSV_PATH, csv, 'utf8');

  const datasetSha256 = createHash('sha256').update(csv).digest('hex');
  const sourceWatermark = acceptedRows
    .map((row) => new Date(String(row.source_updated_at)))
    .filter((date) => !Number.isNaN(date.getTime()))
    .sort((left, right) => right.getTime() - left.getTime())[0]
    ?.toISOString();
  if (!sourceWatermark) {
    throw new Error('El dataset no tiene fecha de origen valida.');
  }

  const model = new ServiceOutcomePredictionModel();
  const evaluationSplit = model.createEvaluationSplit(trainingRows);
  const trainingIds = new Set(evaluationSplit.trainingOrderIds);
  const testIds = new Set(evaluationSplit.testOrderIds);

  const trainingCsv = toCsv(
    CSV_HEADERS,
    acceptedRows
      .filter((row) => trainingIds.has(Number(row.order_id)))
      .map((row) => CSV_HEADERS.map((header) => toCsvValue(header, row))),
  );
  const testCsv = toCsv(
    CSV_HEADERS,
    acceptedRows
      .filter((row) => testIds.has(Number(row.order_id)))
      .map((row) => CSV_HEADERS.map((header) => toCsvValue(header, row))),
  );
  writeFileSync(TRAIN_CSV_PATH, trainingCsv, 'utf8');
  writeFileSync(TEST_CSV_PATH, testCsv, 'utf8');
  writeFileSync(ML_TRAIN_CSV_PATH, trainingCsv, 'utf8');
  writeFileSync(ML_TEST_CSV_PATH, testCsv, 'utf8');

  const artifact = model.trainArtifact(trainingRows, {
    datasetSha256,
    sourceWatermark,
  });
  writeJsonAtomically(ARTIFACT_PATH, artifact);
  writeJsonAtomically(ML_ARTIFACT_PATH, artifact);

  const syntheticRows = acceptedRows.filter(
    (row) => isTruthySyntheticFlag(row.is_synthetic),
  ).length;
  const qualityReport = {
    reportType: 'econolab_classification_training_report',
    generatedFromSourceWatermark: sourceWatermark,
    sourceQuery: '05_Datasets/03_clasificacion_resultado_servicios.csv',
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
      rowsExtracted: csvRows.length,
      rowsAccepted: trainingRows.length,
      rowsRejected: csvRows.length - trainingRows.length,
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
    exploratoryAnalysisX: buildFeatureEda(acceptedRows),
    evaluation: artifact.evaluation,
  };
  writeJsonAtomically(REPORT_PATH, qualityReport);
  writeJsonAtomically(ML_REPORT_PATH, qualityReport);

  writeFileSync(
    MODEL_CARD_PATH,
    `# Model card - clasificacion del resultado de servicios

## Proposito

Pronostica \`completed_on_time\`, \`delayed\` o \`cancelled\` al registrar o
consultar una orden activa. Es apoyo administrativo: no cambia estados, no
bloquea servicios y no toma decisiones clinicas.

## Datos y trazabilidad

- Unidad: una orden historica.
- CSV canonico: \`05_Datasets/03_clasificacion_resultado_servicios.csv\`.
- Y: \`outcome\`.
- X: ${artifact.dataset.predictorsX.join(', ')}.
- Solo auditoria, nunca X: ID, folio, fechas de creacion/actualizacion e \`is_synthetic\`.
- Periodo elegible: ${artifact.dataset.eligiblePeriod.start} a ${artifact.dataset.eligiblePeriod.end}.
- SHA-256 del CSV: \`${datasetSha256}\`.
- Calidad: ${trainingRows.length} filas aceptadas y ${csvRows.length - trainingRows.length} rechazadas.
- Procedencia: ${syntheticRows} sinteticas y ${trainingRows.length - syntheticRows} reales.

## Modelo y validacion

- Regresion logistica multinomial.
- Holdout temporal con ${artifact.dataset.trainingSamples} filas de train y ${artifact.dataset.evaluationTestSamples} de test.
- Accuracy: ${artifact.evaluation.accuracy}.
- Accuracy baseline: ${artifact.evaluation.baseline.accuracy}.
- Macro F1: ${artifact.evaluation.macroAverage.f1Score}.

| Clase | Precision | Recall | F1 | Soporte |
| --- | ---: | ---: | ---: | ---: |
${SERVICE_OUTCOME_CLASSES.map((outcome) => {
  const metrics = artifact.evaluation.metricsByClass[outcome];
  return `| ${outcome} | ${metrics.precision} | ${metrics.recall} | ${metrics.f1Score} | ${metrics.support} |`;
}).join('\n')}
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

main();
