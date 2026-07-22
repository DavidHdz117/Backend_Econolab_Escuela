import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { existsSync, readFileSync } from 'fs';
import { isAbsolute, resolve } from 'path';

// Y: clases que el modelo aprende a pronosticar.
export const SERVICE_OUTCOME_CLASSES = [
  'completed_on_time',
  'delayed',
  'cancelled',
] as const;

export const SERVICE_OUTCOME_MODEL_VERSION = '3.0.0';
export const SERVICE_OUTCOME_MINIMUM_SAMPLES_PER_CLASS = 5;
export const SERVICE_OUTCOME_TEST_FRACTION = 0.2;
export const SERVICE_OUTCOME_ARTIFACT_RELATIVE_PATH =
  'ml/classification/artifacts/classification_service_outcome_model.json';

export type ServiceOutcomeClass = (typeof SERVICE_OUTCOME_CLASSES)[number];

/** X: datos que ya se conocen cuando se registra una orden. */
export type ServiceOutcomeFeatures = {
  promisedLeadHours?: number | null;
  registrationHour?: number | null;
  registrationWeekday?: number | null;
  itemCount?: number | null;
  totalQuantity?: number | null;
  distinctStudyCount?: number | null;
  packageComponentCount?: number | null;
  subtotalAmount?: number | null;
  courtesyPercent?: number | null;
  discountAmount?: number | null;
  totalAmount?: number | null;
  maxStudyDurationMinutes?: number | null;
  averageStudyDurationMinutes?: number | null;
  totalParameterCount?: number | null;
  specialProcessingCount?: number | null;
  branchName?: string | null;
  dominantPriceType?: string | null;
  dominantSampleType?: string | null;
  dominantAnalysisMethod?: string | null;
};

export type ServiceOutcomeTrainingRow = ServiceOutcomeFeatures & {
  // Trazabilidad: identifica la fila, pero NO se utiliza como predictor.
  orderId: number;
  // Auditoria temporal: ordena train/test, pero NO se utiliza como predictor.
  sourceCreatedAt: string;
  // Y: resultado real conocido de una orden historica.
  outcome: ServiceOutcomeClass;
};

type ServiceOutcomeTemporalPeriod = {
  start: string;
  end: string;
};

export type ServiceOutcomePrediction = {
  outcome: ServiceOutcomeClass;
  probability: number;
  probabilities: Record<ServiceOutcomeClass, number>;
};

export type ServiceOutcomeClassMetrics = {
  precision: number;
  recall: number;
  f1Score: number;
  support: number;
};

export type ServiceOutcomeAggregateMetrics = {
  precision: number;
  recall: number;
  f1Score: number;
};

export type ServiceOutcomeConfusionMatrix = Record<
  ServiceOutcomeClass,
  Record<ServiceOutcomeClass, number>
>;

type NumericFeatureName = Exclude<
  keyof ServiceOutcomeFeatures,
  | 'branchName'
  | 'dominantPriceType'
  | 'dominantSampleType'
  | 'dominantAnalysisMethod'
>;

type CategoricalFeatureName = Exclude<
  keyof ServiceOutcomeFeatures,
  NumericFeatureName
>;

export type ServiceOutcomePreprocessingConfig = {
  numeric: Array<{
    key: NumericFeatureName;
    mean: number;
    standardDeviation: number;
  }>;
  categorical: Array<{
    key: CategoricalFeatureName;
    categories: string[];
  }>;
};

type Evaluation = {
  accuracy: number;
  confusionMatrix: ServiceOutcomeConfusionMatrix;
  metricsByClass: Record<ServiceOutcomeClass, ServiceOutcomeClassMetrics>;
  macroAverage: ServiceOutcomeAggregateMetrics;
  weightedAverage: ServiceOutcomeAggregateMetrics;
};

/**
 * Archivo JSON que se genera de forma offline y que el backend solo carga.
 * Contiene el preprocesamiento y los pesos necesarios para inferencia.
 */
export type ServiceOutcomeModelArtifact = {
  artifactType: 'econolab_service_outcome_classifier';
  schemaVersion: 2;
  trainedAt: string;
  datasetSha256: string;
  sourceWatermark: string;
  model: {
    algorithm: 'multinomial_logistic_regression';
    version: string;
    classes: readonly ServiceOutcomeClass[];
    validationStrategy: 'temporal_holdout';
    orderingField: 'source_created_at';
    testFraction: number;
    classBalanceStrategy: 'inverse_frequency_class_weights';
  };
  dataset: {
    eligibleSamples: number;
    trainingSamples: number;
    evaluationTrainingSamples: number;
    evaluationTestSamples: number;
    minimumSamplesPerClass: number;
    discardedRows: number;
    classDistribution: Record<ServiceOutcomeClass, number>;
    classWeights: Record<ServiceOutcomeClass, number>;
    trainingClassDistribution: Record<ServiceOutcomeClass, number>;
    testClassDistribution: Record<ServiceOutcomeClass, number>;
    eligiblePeriod: ServiceOutcomeTemporalPeriod;
    trainingPeriod: ServiceOutcomeTemporalPeriod;
    testPeriod: ServiceOutcomeTemporalPeriod;
    predictorsX: (keyof ServiceOutcomeFeatures)[];
    targetY: 'outcome';
  };
  evaluation: Evaluation & {
    baseline: Evaluation & {
      strategy: 'majority_class';
      predictedClass: ServiceOutcomeClass;
    };
  };
  preprocessing: ServiceOutcomePreprocessingConfig;
  classifier: { weights: number[][] };
  warnings: string[];
};

export type ServiceOutcomePredictionResult = {
  predictions: ServiceOutcomePrediction[];
  model: {
    algorithm: 'multinomial_logistic_regression';
    version: string;
    trainingSamples: number;
    evaluationTrainingSamples: number;
    evaluationTestSamples: number;
    minimumSamplesPerClass: number;
    classDistribution: Record<ServiceOutcomeClass, number>;
    accuracy: number;
    baselineAccuracy: number;
    confusionMatrix: ServiceOutcomeConfusionMatrix;
    metricsByClass: Record<ServiceOutcomeClass, ServiceOutcomeClassMetrics>;
    macroAverage: ServiceOutcomeAggregateMetrics;
    weightedAverage: ServiceOutcomeAggregateMetrics;
    featuresUsed: (keyof ServiceOutcomeFeatures)[];
    discardedRows: number;
    validationStrategy: 'temporal_holdout';
    orderingField: 'source_created_at';
    trainingPeriod: ServiceOutcomeTemporalPeriod;
    testPeriod: ServiceOutcomeTemporalPeriod;
    testFraction: number;
    classBalanceStrategy: string;
    artifactDatasetSha256: string;
    trainedAt: string;
  };
  warnings: string[];
};

export type ServiceOutcomeModelUnavailableDetails = {
  minimumSamplesPerClass: number;
  validSamples: number;
  discardedRows: number;
  classDistribution: Record<ServiceOutcomeClass, number>;
};

export class ServiceOutcomeModelUnavailableError extends Error {
  readonly code = 'SERVICE_OUTCOME_MODEL_UNAVAILABLE';

  constructor(
    message: string,
    readonly details: ServiceOutcomeModelUnavailableDetails,
  ) {
    super(message);
    this.name = 'ServiceOutcomeModelUnavailableError';
  }
}

type FittedClassifier = {
  preprocessing: ServiceOutcomePreprocessingConfig;
  weights: number[][];
  classWeights: Record<ServiceOutcomeClass, number>;
};

type CleanTrainingRows = {
  rows: ServiceOutcomeTrainingRow[];
  discardedRows: number;
};

const NUMERIC_FEATURES: NumericFeatureName[] = [
  'promisedLeadHours',
  'registrationHour',
  'registrationWeekday',
  'itemCount',
  'totalQuantity',
  'distinctStudyCount',
  'packageComponentCount',
  'subtotalAmount',
  'courtesyPercent',
  'discountAmount',
  'totalAmount',
  'maxStudyDurationMinutes',
  'averageStudyDurationMinutes',
  'totalParameterCount',
  'specialProcessingCount',
];

const CATEGORICAL_FEATURES: CategoricalFeatureName[] = [
  'branchName',
  'dominantPriceType',
  'dominantSampleType',
  'dominantAnalysisMethod',
];

const MAX_EPOCHS = 1_200;
const LEARNING_RATE = 0.08;
const L2_PENALTY = 0.01;
const EARLY_STOPPING_PATIENCE = 40;
const MINIMUM_LOSS_IMPROVEMENT = 1e-8;
const MINIMUM_STANDARD_DEVIATION = 1e-9;
const MAXIMUM_DOMINANT_VALUE_PROPORTION = 0.99;
const MISSING_CATEGORY = '__missing__';
const OTHER_CATEGORY = '__other__';

/**
 * Entrenamiento offline e inferencia del clasificador.
 *
 * - `trainArtifact` se usa SOLO por el script de entrenamiento.
 * - `predictUsingArtifact` es lo que usa el backend en cada solicitud.
 * - El JSON se lee una vez y queda guardado en memoria.
 */
@Injectable()
export class ServiceOutcomePredictionModel implements OnModuleInit {
  private readonly logger = new Logger(ServiceOutcomePredictionModel.name);
  private cachedArtifact: ServiceOutcomeModelArtifact | null = null;
  private cachedArtifactPath: string | null = null;

  onModuleInit() {
    try {
      const artifact = this.getArtifact();
      this.logger.log(
        `Modelo de servicios ${artifact.model.version} cargado (${artifact.dataset.trainingSamples} filas).`,
      );
    } catch (error) {
      this.logger.warn(
        error instanceof Error ? error.message : 'No se pudo cargar el modelo.',
      );
    }
  }

  /**
   * GENERA EL MODELO: limpia, divide, valida, reentrena y devuelve el artefacto.
   * El holdout temporal hace repetible el split y evalua con el periodo futuro.
   */
  trainArtifact(
    rows: ServiceOutcomeTrainingRow[],
    provenance: {
      datasetSha256: string;
      sourceWatermark: string;
      trainedAt?: string;
    },
  ): ServiceOutcomeModelArtifact {
    const cleaned = this.cleanTrainingRows(rows);
    const classDistribution = this.countClasses(cleaned.rows);
    this.assertEnoughRows(cleaned, classDistribution);

    const split = this.temporalSplit(cleaned.rows);
    const evaluationClassifier = this.fitClassifier(split.training);
    const predicted = split.test.map((row) =>
      this.predictOne(row, evaluationClassifier),
    );
    const evaluation = this.evaluate(
      split.test.map((row) => row.outcome),
      predicted.map((row) => row.outcome),
    );

    // Baseline honesto: siempre predice la clase mayoritaria aprendida en train.
    const trainingDistribution = this.countClasses(split.training);
    const baselineClass = this.majorityClass(trainingDistribution);
    const baselineEvaluation = this.evaluate(
      split.test.map((row) => row.outcome),
      split.test.map(() => baselineClass),
    );

    // Este es el clasificador exacto que se evalua y despliega. Imputacion,
    // escalado, categorias y pesos se ajustan exclusivamente con train.
    const deployedClassifier = evaluationClassifier;
    const predictorsX = this.getFeaturesUsed(deployedClassifier.preprocessing);
    const warnings = this.buildWarnings(
      cleaned.discardedRows,
      classDistribution,
      predictorsX,
    );

    return {
      artifactType: 'econolab_service_outcome_classifier',
      schemaVersion: 2,
      trainedAt: provenance.trainedAt ?? provenance.sourceWatermark,
      datasetSha256: provenance.datasetSha256,
      sourceWatermark: provenance.sourceWatermark,
      model: {
        algorithm: 'multinomial_logistic_regression',
        version: SERVICE_OUTCOME_MODEL_VERSION,
        classes: SERVICE_OUTCOME_CLASSES,
        validationStrategy: 'temporal_holdout',
        orderingField: 'source_created_at',
        testFraction: SERVICE_OUTCOME_TEST_FRACTION,
        classBalanceStrategy: 'inverse_frequency_class_weights',
      },
      dataset: {
        eligibleSamples: cleaned.rows.length,
        trainingSamples: split.training.length,
        evaluationTrainingSamples: split.training.length,
        evaluationTestSamples: split.test.length,
        minimumSamplesPerClass: SERVICE_OUTCOME_MINIMUM_SAMPLES_PER_CLASS,
        discardedRows: cleaned.discardedRows,
        classDistribution,
        classWeights: deployedClassifier.classWeights,
        trainingClassDistribution: trainingDistribution,
        testClassDistribution: this.countClasses(split.test),
        eligiblePeriod: this.temporalPeriod(cleaned.rows),
        trainingPeriod: this.temporalPeriod(split.training),
        testPeriod: this.temporalPeriod(split.test),
        predictorsX,
        targetY: 'outcome',
      },
      evaluation: {
        ...evaluation,
        baseline: {
          strategy: 'majority_class',
          predictedClass: baselineClass,
          ...baselineEvaluation,
        },
      },
      preprocessing: deployedClassifier.preprocessing,
      classifier: { weights: deployedClassifier.weights },
      warnings,
    };
  }

  /** Devuelve el mismo holdout temporal que usa la evaluacion. */
  createEvaluationSplit(rows: ServiceOutcomeTrainingRow[]) {
    const cleaned = this.cleanTrainingRows(rows);
    const distribution = this.countClasses(cleaned.rows);
    this.assertEnoughRows(cleaned, distribution);
    const split = this.temporalSplit(cleaned.rows);
    return {
      trainingOrderIds: split.training.map((row) => row.orderId),
      testOrderIds: split.test.map((row) => row.orderId),
      eligiblePeriod: this.temporalPeriod(cleaned.rows),
      trainingPeriod: this.temporalPeriod(split.training),
      testPeriod: this.temporalPeriod(split.test),
      trainingClassDistribution: this.countClasses(split.training),
      testClassDistribution: this.countClasses(split.test),
    };
  }

  /** UTILIZA EL MODELO: no consulta la BD ni vuelve a entrenar. */
  predictUsingArtifact(
    inputs: ServiceOutcomeFeatures[],
  ): ServiceOutcomePredictionResult {
    return this.predictFromArtifact(inputs, this.getArtifact());
  }

  /** Util para pruebas y para comprobar un artefacto antes de guardarlo. */
  predictFromArtifact(
    inputs: ServiceOutcomeFeatures[],
    artifact: ServiceOutcomeModelArtifact,
  ): ServiceOutcomePredictionResult {
    this.validateArtifact(artifact);
    const classifier: FittedClassifier = {
      preprocessing: artifact.preprocessing,
      weights: artifact.classifier.weights,
      classWeights: artifact.dataset.classWeights,
    };

    return {
      predictions: inputs.map((input) => this.predictOne(input, classifier)),
      model: this.toPublicModelMetadata(artifact),
      warnings: artifact.warnings,
    };
  }

  /** Compatibilidad para pruebas antiguas; el backend no llama este metodo. */
  predictMany(
    inputs: ServiceOutcomeFeatures[],
    rows: ServiceOutcomeTrainingRow[],
  ): ServiceOutcomePredictionResult {
    const artifact = this.trainArtifact(rows, {
      datasetSha256: 'in-memory-test-dataset',
      sourceWatermark: 'test',
      trainedAt: 'test',
    });
    return this.predictFromArtifact(inputs, artifact);
  }

  getArtifactMetadata(): ServiceOutcomePredictionResult['model'] | null {
    try {
      return this.toPublicModelMetadata(this.getArtifact());
    } catch {
      return null;
    }
  }

  getLoadedArtifactPath() {
    return this.cachedArtifactPath;
  }

  private getArtifact() {
    if (this.cachedArtifact) return this.cachedArtifact;

    const artifactPath = this.resolveArtifactPath();
    try {
      const artifact = JSON.parse(
        readFileSync(artifactPath, 'utf8'),
      ) as ServiceOutcomeModelArtifact;
      this.validateArtifact(artifact);
      this.cachedArtifact = artifact;
      this.cachedArtifactPath = artifactPath;
      return artifact;
    } catch (error) {
      const reason =
        error instanceof Error && error.message.startsWith('El artefacto')
          ? error.message
          : 'el archivo no existe o no se puede leer';
      throw new ServiceOutcomeModelUnavailableError(
        `No se pudo cargar el artefacto de clasificacion: ${reason}.`,
        {
          minimumSamplesPerClass: SERVICE_OUTCOME_MINIMUM_SAMPLES_PER_CLASS,
          validSamples: 0,
          discardedRows: 0,
          classDistribution: this.emptyClassRecord(() => 0),
        },
      );
    }
  }

  private resolveArtifactPath() {
    const configured = process.env.SERVICE_OUTCOME_MODEL_PATH?.trim();
    if (configured) {
      return isAbsolute(configured)
        ? configured
        : resolve(process.cwd(), configured);
    }

    // Permite iniciar desde `backend`, desde la raíz o directamente desde dist.
    const candidates = [
      resolve(process.cwd(), SERVICE_OUTCOME_ARTIFACT_RELATIVE_PATH),
      resolve(process.cwd(), 'backend', SERVICE_OUTCOME_ARTIFACT_RELATIVE_PATH),
      resolve(__dirname, '../../../', SERVICE_OUTCOME_ARTIFACT_RELATIVE_PATH),
    ];
    return (
      candidates.find((candidate) => existsSync(candidate)) ?? candidates[0]
    );
  }

  private validateArtifact(artifact: ServiceOutcomeModelArtifact) {
    if (
      artifact?.artifactType !== 'econolab_service_outcome_classifier' ||
      artifact.schemaVersion !== 2 ||
      artifact.model?.version !== SERVICE_OUTCOME_MODEL_VERSION
    ) {
      throw new Error(
        'El artefacto no existe, esta danado o usa otra version.',
      );
    }

    const featureCount = this.getFeatureCount(artifact.preprocessing);
    const validWeights =
      artifact.classifier?.weights?.length === SERVICE_OUTCOME_CLASSES.length &&
      artifact.classifier.weights.every(
        (weights) =>
          weights.length === featureCount &&
          weights.every((weight) => Number.isFinite(weight)),
      );
    if (!validWeights)
      throw new Error('Los pesos del artefacto son invalidos.');
  }

  private toPublicModelMetadata(
    artifact: ServiceOutcomeModelArtifact,
  ): ServiceOutcomePredictionResult['model'] {
    return {
      algorithm: artifact.model.algorithm,
      version: artifact.model.version,
      trainingSamples: artifact.dataset.trainingSamples,
      evaluationTrainingSamples: artifact.dataset.evaluationTrainingSamples,
      evaluationTestSamples: artifact.dataset.evaluationTestSamples,
      minimumSamplesPerClass: artifact.dataset.minimumSamplesPerClass,
      classDistribution: artifact.dataset.classDistribution,
      accuracy: artifact.evaluation.accuracy,
      baselineAccuracy: artifact.evaluation.baseline.accuracy,
      confusionMatrix: artifact.evaluation.confusionMatrix,
      metricsByClass: artifact.evaluation.metricsByClass,
      macroAverage: artifact.evaluation.macroAverage,
      weightedAverage: artifact.evaluation.weightedAverage,
      featuresUsed: artifact.dataset.predictorsX,
      discardedRows: artifact.dataset.discardedRows,
      validationStrategy: artifact.model.validationStrategy,
      orderingField: artifact.model.orderingField,
      trainingPeriod: artifact.dataset.trainingPeriod,
      testPeriod: artifact.dataset.testPeriod,
      testFraction: artifact.model.testFraction,
      classBalanceStrategy: artifact.model.classBalanceStrategy,
      artifactDatasetSha256: artifact.datasetSha256,
      trainedAt: artifact.trainedAt,
    };
  }

  private assertEnoughRows(
    cleaned: CleanTrainingRows,
    distribution: Record<ServiceOutcomeClass, number>,
  ) {
    const insufficientClass = SERVICE_OUTCOME_CLASSES.find(
      (outcome) =>
        distribution[outcome] < SERVICE_OUTCOME_MINIMUM_SAMPLES_PER_CLASS,
    );
    if (!insufficientClass) return;

    throw new ServiceOutcomeModelUnavailableError(
      `Se requieren al menos ${SERVICE_OUTCOME_MINIMUM_SAMPLES_PER_CLASS} ordenes validas de cada resultado.`,
      {
        minimumSamplesPerClass: SERVICE_OUTCOME_MINIMUM_SAMPLES_PER_CLASS,
        validSamples: cleaned.rows.length,
        discardedRows: cleaned.discardedRows,
        classDistribution: distribution,
      },
    );
  }

  private cleanTrainingRows(rows: ServiceOutcomeTrainingRow[]) {
    const cleaned: ServiceOutcomeTrainingRow[] = [];
    const seenOrderIds = new Set<number>();
    let discardedRows = 0;

    for (const row of rows) {
      const validId = Number.isInteger(row?.orderId) && row.orderId > 0;
      const sourceCreatedAt = this.toIsoTimestamp(row?.sourceCreatedAt);
      if (
        !validId ||
        !sourceCreatedAt ||
        !this.isOutcomeClass(row?.outcome) ||
        !this.hasAtLeastOneFeature(row) ||
        seenOrderIds.has(row.orderId)
      ) {
        discardedRows += 1;
        continue;
      }
      seenOrderIds.add(row.orderId);
      cleaned.push({ ...row, sourceCreatedAt });
    }
    return { rows: cleaned, discardedRows };
  }

  private hasAtLeastOneFeature(row: ServiceOutcomeFeatures) {
    return (
      NUMERIC_FEATURES.some(
        (feature) => this.toFiniteNumber(row[feature]) !== null,
      ) ||
      CATEGORICAL_FEATURES.some(
        (feature) => this.normalizeCategory(row[feature]) !== MISSING_CATEGORY,
      )
    );
  }

  private isOutcomeClass(value: unknown): value is ServiceOutcomeClass {
    return SERVICE_OUTCOME_CLASSES.some((outcome) => outcome === value);
  }

  private countClasses(rows: ServiceOutcomeTrainingRow[]) {
    const distribution = this.emptyClassRecord(() => 0);
    for (const row of rows) distribution[row.outcome] += 1;
    return distribution;
  }

  /**
   * Holdout temporal: entrena con el pasado y evalua con el 20 % mas reciente.
   * `sourceCreatedAt` es trazabilidad, nunca una X del clasificador.
   */
  private temporalSplit(rows: ServiceOutcomeTrainingRow[]) {
    const ordered = [...rows].sort((left, right) => {
      const difference =
        Date.parse(left.sourceCreatedAt) - Date.parse(right.sourceCreatedAt);
      return difference || left.orderId - right.orderId;
    });
    const testSize = Math.max(
      1,
      Math.min(
        ordered.length - 1,
        Math.round(ordered.length * SERVICE_OUTCOME_TEST_FRACTION),
      ),
    );
    const training = ordered.slice(0, ordered.length - testSize);
    const test = ordered.slice(ordered.length - testSize);
    const trainingDistribution = this.countClasses(training);
    const testDistribution = this.countClasses(test);
    const missingClass = SERVICE_OUTCOME_CLASSES.find(
      (outcome) =>
        trainingDistribution[outcome] === 0 || testDistribution[outcome] === 0,
    );
    if (missingClass) {
      throw new ServiceOutcomeModelUnavailableError(
        `El holdout temporal no conserva ejemplos de ${missingClass} en train y test.`,
        {
          minimumSamplesPerClass: SERVICE_OUTCOME_MINIMUM_SAMPLES_PER_CLASS,
          validSamples: rows.length,
          discardedRows: 0,
          classDistribution: this.countClasses(rows),
        },
      );
    }
    return { training, test };
  }

  private temporalPeriod(rows: ServiceOutcomeTrainingRow[]) {
    const timestamps = rows
      .map((row) => this.toIsoTimestamp(row.sourceCreatedAt))
      .filter((value): value is string => value !== null)
      .sort((left, right) => Date.parse(left) - Date.parse(right));
    if (timestamps.length === 0) {
      throw new Error('No hay fechas validas para construir el periodo.');
    }
    return { start: timestamps[0], end: timestamps[timestamps.length - 1] };
  }

  private fitClassifier(rows: ServiceOutcomeTrainingRow[]): FittedClassifier {
    const preprocessing = this.buildPreprocessing(rows);
    const featureCount = this.getFeatureCount(preprocessing);
    if (featureCount === 1) {
      throw new ServiceOutcomeModelUnavailableError(
        'El dataset no tiene variables con variacion suficiente.',
        {
          minimumSamplesPerClass: SERVICE_OUTCOME_MINIMUM_SAMPLES_PER_CLASS,
          validSamples: rows.length,
          discardedRows: 0,
          classDistribution: this.countClasses(rows),
        },
      );
    }

    const classWeights = this.calculateClassWeights(rows);
    const features = rows.map((row) =>
      this.toFeatureVector(row, preprocessing),
    );
    const targets = rows.map((row) =>
      SERVICE_OUTCOME_CLASSES.indexOf(row.outcome),
    );
    // ESTA SENTENCIA ENTRENA LA REGRESION LOGISTICA MULTINOMIAL.
    const weights = this.fitLogisticRegression(
      features,
      targets,
      featureCount,
      classWeights,
    );
    return { preprocessing, weights, classWeights };
  }

  private calculateClassWeights(rows: ServiceOutcomeTrainingRow[]) {
    const distribution = this.countClasses(rows);
    return this.emptyClassRecord((outcome) =>
      this.round(
        rows.length / (SERVICE_OUTCOME_CLASSES.length * distribution[outcome]),
      ),
    );
  }

  private buildPreprocessing(
    rows: ServiceOutcomeTrainingRow[],
  ): ServiceOutcomePreprocessingConfig {
    const numeric: ServiceOutcomePreprocessingConfig['numeric'] = [];
    const categorical: ServiceOutcomePreprocessingConfig['categorical'] = [];

    for (const key of NUMERIC_FEATURES) {
      const values = rows
        .map((row) => this.toFiniteNumber(row[key]))
        .filter((value): value is number => value !== null);
      if (values.length < 2) continue;
      const frequencies = new Map<number, number>();
      for (const value of values) {
        frequencies.set(value, (frequencies.get(value) ?? 0) + 1);
      }
      const dominantProportion =
        Math.max(...frequencies.values()) / values.length;
      if (dominantProportion >= MAXIMUM_DOMINANT_VALUE_PROPORTION) continue;
      const mean =
        values.reduce((sum, value) => sum + value, 0) / values.length;
      const variance =
        values.reduce((sum, value) => sum + (value - mean) ** 2, 0) /
        values.length;
      const standardDeviation = Math.sqrt(variance);
      if (standardDeviation > MINIMUM_STANDARD_DEVIATION) {
        numeric.push({ key, mean, standardDeviation });
      }
    }

    for (const key of CATEGORICAL_FEATURES) {
      const observed = [
        ...new Set(rows.map((row) => this.normalizeCategory(row[key]))),
      ].sort();
      const dominantProportion = Math.max(
        ...observed.map(
          (category) =>
            rows.filter((row) => this.normalizeCategory(row[key]) === category)
              .length / rows.length,
        ),
      );
      if (
        observed.length >= 2 &&
        dominantProportion < MAXIMUM_DOMINANT_VALUE_PROPORTION
      ) {
        categorical.push({ key, categories: [...observed, OTHER_CATEGORY] });
      }
    }
    return { numeric, categorical };
  }

  private getFeatureCount(config: ServiceOutcomePreprocessingConfig) {
    return (
      1 +
      config.numeric.length +
      config.categorical.reduce(
        (total, feature) => total + feature.categories.length,
        0,
      )
    );
  }

  private getFeaturesUsed(config: ServiceOutcomePreprocessingConfig) {
    return [
      ...config.numeric.map((feature) => feature.key),
      ...config.categorical.map((feature) => feature.key),
    ];
  }

  private toFeatureVector(
    input: ServiceOutcomeFeatures,
    config: ServiceOutcomePreprocessingConfig,
  ) {
    const vector = [1];
    for (const feature of config.numeric) {
      const value = this.toFiniteNumber(input[feature.key]) ?? feature.mean;
      vector.push((value - feature.mean) / feature.standardDeviation);
    }
    for (const feature of config.categorical) {
      const normalized = this.normalizeCategory(input[feature.key]);
      const category = feature.categories.includes(normalized)
        ? normalized
        : OTHER_CATEGORY;
      for (const configured of feature.categories) {
        vector.push(category === configured ? 1 : 0);
      }
    }
    return vector;
  }

  private fitLogisticRegression(
    features: number[][],
    targets: number[],
    featureCount: number,
    classWeights: Record<ServiceOutcomeClass, number>,
  ) {
    const weights = SERVICE_OUTCOME_CLASSES.map(
      () => Array(featureCount).fill(0) as number[],
    );
    const sampleWeights = targets.map(
      (target) => classWeights[SERVICE_OUTCOME_CLASSES[target]],
    );
    const totalSampleWeight = sampleWeights.reduce(
      (sum, value) => sum + value,
      0,
    );
    let bestLoss = Number.POSITIVE_INFINITY;
    let epochsWithoutImprovement = 0;

    for (let epoch = 0; epoch < MAX_EPOCHS; epoch += 1) {
      const gradients = SERVICE_OUTCOME_CLASSES.map(
        () => Array(featureCount).fill(0) as number[],
      );
      let loss = 0;

      for (let rowIndex = 0; rowIndex < features.length; rowIndex += 1) {
        const row = features[rowIndex];
        const sampleWeight = sampleWeights[rowIndex];
        const probabilities = this.softmax(
          weights.map((classWeightsForRow) =>
            this.dot(row, classWeightsForRow),
          ),
        );
        const target = targets[rowIndex];
        loss -=
          sampleWeight *
          Math.log(Math.max(probabilities[target], Number.EPSILON));

        for (let classIndex = 0; classIndex < weights.length; classIndex += 1) {
          const error =
            sampleWeight *
            (probabilities[classIndex] - (target === classIndex ? 1 : 0));
          for (
            let featureIndex = 0;
            featureIndex < featureCount;
            featureIndex += 1
          ) {
            gradients[classIndex][featureIndex] += error * row[featureIndex];
          }
        }
      }

      loss /= totalSampleWeight;
      const epochLearningRate = LEARNING_RATE / Math.sqrt(1 + epoch * 0.01);
      for (let classIndex = 0; classIndex < weights.length; classIndex += 1) {
        for (
          let featureIndex = 0;
          featureIndex < featureCount;
          featureIndex += 1
        ) {
          const regularization =
            featureIndex === 0
              ? 0
              : L2_PENALTY * weights[classIndex][featureIndex];
          const gradient =
            gradients[classIndex][featureIndex] / totalSampleWeight;
          weights[classIndex][featureIndex] -=
            epochLearningRate * (gradient + regularization);
        }
      }

      if (bestLoss - loss > MINIMUM_LOSS_IMPROVEMENT) {
        bestLoss = loss;
        epochsWithoutImprovement = 0;
      } else if (++epochsWithoutImprovement >= EARLY_STOPPING_PATIENCE) {
        break;
      }
    }
    return weights;
  }

  private predictOne(
    input: ServiceOutcomeFeatures,
    classifier: FittedClassifier,
  ): ServiceOutcomePrediction {
    const vector = this.toFeatureVector(input, classifier.preprocessing);
    const values = this.softmax(
      classifier.weights.map((weights) => this.dot(vector, weights)),
    );
    const probabilities = this.emptyClassRecord(
      (outcome) => values[SERVICE_OUTCOME_CLASSES.indexOf(outcome)],
    );
    const outcome = SERVICE_OUTCOME_CLASSES.reduce((best, candidate) =>
      probabilities[candidate] > probabilities[best] ? candidate : best,
    );
    return { outcome, probability: probabilities[outcome], probabilities };
  }

  private evaluate(
    actual: ServiceOutcomeClass[],
    predicted: ServiceOutcomeClass[],
  ): Evaluation {
    const confusionMatrix = this.emptyClassRecord(() =>
      this.emptyClassRecord(() => 0),
    );
    for (let index = 0; index < actual.length; index += 1) {
      confusionMatrix[actual[index]][predicted[index]] += 1;
    }

    const metricsByClass = this.emptyClassRecord((outcome) => {
      const truePositives = confusionMatrix[outcome][outcome];
      const falsePositives = SERVICE_OUTCOME_CLASSES.reduce(
        (total, actualClass) =>
          actualClass === outcome
            ? total
            : total + confusionMatrix[actualClass][outcome],
        0,
      );
      const falseNegatives = SERVICE_OUTCOME_CLASSES.reduce(
        (total, predictedClass) =>
          predictedClass === outcome
            ? total
            : total + confusionMatrix[outcome][predictedClass],
        0,
      );
      const support = SERVICE_OUTCOME_CLASSES.reduce(
        (total, predictedClass) =>
          total + confusionMatrix[outcome][predictedClass],
        0,
      );
      const precision = this.safeDivide(
        truePositives,
        truePositives + falsePositives,
      );
      const recall = this.safeDivide(
        truePositives,
        truePositives + falseNegatives,
      );
      return {
        precision: this.round(precision),
        recall: this.round(recall),
        f1Score: this.round(
          this.safeDivide(2 * precision * recall, precision + recall),
        ),
        support,
      };
    });

    const correct = SERVICE_OUTCOME_CLASSES.reduce(
      (total, outcome) => total + confusionMatrix[outcome][outcome],
      0,
    );
    const totalSupport = actual.length;
    const average = (weighted: boolean): ServiceOutcomeAggregateMetrics => {
      const denominator = weighted
        ? totalSupport
        : SERVICE_OUTCOME_CLASSES.length;
      const value = (key: 'precision' | 'recall' | 'f1Score') =>
        this.round(
          SERVICE_OUTCOME_CLASSES.reduce(
            (sum, outcome) =>
              sum +
              metricsByClass[outcome][key] *
                (weighted ? metricsByClass[outcome].support : 1),
            0,
          ) / Math.max(denominator, 1),
        );
      return {
        precision: value('precision'),
        recall: value('recall'),
        f1Score: value('f1Score'),
      };
    };

    return {
      accuracy: this.round(this.safeDivide(correct, actual.length)),
      confusionMatrix,
      metricsByClass,
      macroAverage: average(false),
      weightedAverage: average(true),
    };
  }

  private majorityClass(distribution: Record<ServiceOutcomeClass, number>) {
    return SERVICE_OUTCOME_CLASSES.reduce((best, candidate) =>
      distribution[candidate] > distribution[best] ? candidate : best,
    );
  }

  private buildWarnings(
    discardedRows: number,
    distribution: Record<ServiceOutcomeClass, number>,
    featuresUsed: (keyof ServiceOutcomeFeatures)[],
  ) {
    const warnings: string[] = [];
    if (discardedRows > 0) {
      warnings.push(`Se descartaron ${discardedRows} filas no utilizables.`);
    }
    const counts = SERVICE_OUTCOME_CLASSES.map(
      (outcome) => distribution[outcome],
    );
    if (Math.max(...counts) >= Math.min(...counts) * 2) {
      warnings.push(
        'Las clases estan desbalanceadas; se aplicaron pesos inversos y deben revisarse las metricas por clase.',
      );
    }
    if (
      [...NUMERIC_FEATURES, ...CATEGORICAL_FEATURES].some(
        (feature) => !featuresUsed.includes(feature),
      )
    ) {
      warnings.push(
        'Las variables vacias, constantes o con al menos 99 % del mismo valor fueron omitidas del modelo.',
      );
    }
    return warnings;
  }

  private normalizeCategory(value?: string | null) {
    const normalized = (value ?? '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, ' ');
    return normalized || MISSING_CATEGORY;
  }

  private toFiniteNumber(value?: number | null) {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
  }

  private toIsoTimestamp(value?: string | null) {
    if (!value) return null;
    const timestamp = new Date(value);
    return Number.isNaN(timestamp.getTime()) ? null : timestamp.toISOString();
  }

  private softmax(scores: number[]) {
    const maximum = Math.max(...scores);
    const exponentials = scores.map((score) => Math.exp(score - maximum));
    const total = exponentials.reduce((sum, value) => sum + value, 0);
    return exponentials.map((value) => value / total);
  }

  private dot(left: number[], right: number[]) {
    return left.reduce(
      (total, value, index) => total + value * right[index],
      0,
    );
  }

  private safeDivide(numerator: number, denominator: number) {
    return denominator === 0 ? 0 : numerator / denominator;
  }

  private round(value: number) {
    return Math.round(value * 10_000) / 10_000;
  }

  private emptyClassRecord<T>(
    factory: (outcome: ServiceOutcomeClass) => T,
  ): Record<ServiceOutcomeClass, T> {
    return {
      completed_on_time: factory('completed_on_time'),
      delayed: factory('delayed'),
      cancelled: factory('cancelled'),
    };
  }
}
