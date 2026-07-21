import { Injectable } from '@nestjs/common';

export const SERVICE_OUTCOME_CLASSES = [
  'completed_on_time',
  'delayed',
  'cancelled',
] as const;

export const SERVICE_OUTCOME_MODEL_VERSION = '1.0';
export const SERVICE_OUTCOME_MINIMUM_SAMPLES_PER_CLASS = 5;

export type ServiceOutcomeClass = (typeof SERVICE_OUTCOME_CLASSES)[number];

/**
 * Variables conocidas al registrar una orden o consultar una orden activa.
 * Todos los campos son opcionales para que la prediccion no dependa de datos
 * que el formulario todavia no tenga capturados.
 */
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
  orderId: number;
  outcome: ServiceOutcomeClass;
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

export type ServiceOutcomeConfusionMatrix = Record<
  ServiceOutcomeClass,
  Record<ServiceOutcomeClass, number>
>;

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
    confusionMatrix: ServiceOutcomeConfusionMatrix;
    metricsByClass: Record<ServiceOutcomeClass, ServiceOutcomeClassMetrics>;
    featuresUsed: (keyof ServiceOutcomeFeatures)[];
    discardedRows: number;
  };
  warnings: string[];
};

export type ServiceOutcomeModelUnavailableDetails = {
  minimumSamplesPerClass: number;
  validSamples: number;
  discardedRows: number;
  classDistribution: Record<ServiceOutcomeClass, number>;
};

/** Error de dominio que el servicio puede convertir en una respuesta no bloqueante. */
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

type NumericFeatureConfig = {
  key: NumericFeatureName;
  mean: number;
  standardDeviation: number;
};

type CategoricalFeatureConfig = {
  key: CategoricalFeatureName;
  categories: string[];
};

type PreprocessingConfig = {
  numeric: NumericFeatureConfig[];
  categorical: CategoricalFeatureConfig[];
};

type FittedClassifier = {
  preprocessing: PreprocessingConfig;
  weights: number[][];
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

const TEST_FRACTION = 0.2;
const MAX_EPOCHS = 1_200;
const LEARNING_RATE = 0.08;
const L2_PENALTY = 0.01;
const EARLY_STOPPING_PATIENCE = 40;
const MINIMUM_LOSS_IMPROVEMENT = 1e-8;
const MINIMUM_STANDARD_DEVIATION = 1e-9;
const MISSING_CATEGORY = '__missing__';
const OTHER_CATEGORY = '__other__';

/**
 * Clasificador multinomial sencillo para el resultado probable de una orden.
 *
 * 1. Separa el historial de forma estratificada y determinista.
 * 2. Aprende imputacion, estandarizacion y categorias solo con train.
 * 3. Evalua el modelo contra test.
 * 4. Reentrena con todo el historial valido para realizar la inferencia.
 */
@Injectable()
export class ServiceOutcomePredictionModel {
  predictMany(
    inputs: ServiceOutcomeFeatures[],
    rows: ServiceOutcomeTrainingRow[],
  ): ServiceOutcomePredictionResult {
    const cleaned = this.cleanTrainingRows(rows);
    const classDistribution = this.countClasses(cleaned.rows);
    const unavailableDetails: ServiceOutcomeModelUnavailableDetails = {
      minimumSamplesPerClass: SERVICE_OUTCOME_MINIMUM_SAMPLES_PER_CLASS,
      validSamples: cleaned.rows.length,
      discardedRows: cleaned.discardedRows,
      classDistribution,
    };

    const insufficientClass = SERVICE_OUTCOME_CLASSES.find(
      (outcome) =>
        classDistribution[outcome] < SERVICE_OUTCOME_MINIMUM_SAMPLES_PER_CLASS,
    );

    if (insufficientClass) {
      throw new ServiceOutcomeModelUnavailableError(
        `Se requieren al menos ${SERVICE_OUTCOME_MINIMUM_SAMPLES_PER_CLASS} ordenes validas de cada resultado para entrenar el modelo.`,
        unavailableDetails,
      );
    }

    const split = this.stratifiedSplit(cleaned.rows);
    const evaluationClassifier = this.fitClassifier(split.training);
    const evaluationPredictions = split.test.map((row) =>
      this.predictOne(row, evaluationClassifier),
    );
    const evaluation = this.evaluate(
      split.test.map((row) => row.outcome),
      evaluationPredictions.map((prediction) => prediction.outcome),
    );

    // La evaluacion anterior permanece intacta. Para inferencia se aprovecha
    // despues todo el historial valido y se vuelven a aprender transformaciones.
    const inferenceClassifier = this.fitClassifier(cleaned.rows);
    const predictions = inputs.map((input) =>
      this.predictOne(input, inferenceClassifier),
    );
    const featuresUsed = this.getFeaturesUsed(
      inferenceClassifier.preprocessing,
    );

    return {
      predictions,
      model: {
        algorithm: 'multinomial_logistic_regression',
        version: SERVICE_OUTCOME_MODEL_VERSION,
        trainingSamples: cleaned.rows.length,
        evaluationTrainingSamples: split.training.length,
        evaluationTestSamples: split.test.length,
        minimumSamplesPerClass: SERVICE_OUTCOME_MINIMUM_SAMPLES_PER_CLASS,
        classDistribution,
        accuracy: this.round(evaluation.accuracy),
        confusionMatrix: evaluation.confusionMatrix,
        metricsByClass: evaluation.metricsByClass,
        featuresUsed,
        discardedRows: cleaned.discardedRows,
      },
      warnings: this.buildWarnings(
        cleaned.discardedRows,
        classDistribution,
        featuresUsed,
      ),
    };
  }

  private cleanTrainingRows(
    rows: ServiceOutcomeTrainingRow[],
  ): CleanTrainingRows {
    const cleaned: ServiceOutcomeTrainingRow[] = [];
    const seenOrderIds = new Set<number>();
    let discardedRows = 0;

    for (const row of rows) {
      const validOrderId =
        Number.isInteger(row?.orderId) && Number(row.orderId) > 0;
      const validOutcome = this.isOutcomeClass(row?.outcome);
      const hasFeature = row ? this.hasAtLeastOneFeature(row) : false;

      if (
        !validOrderId ||
        !validOutcome ||
        !hasFeature ||
        seenOrderIds.has(row.orderId)
      ) {
        discardedRows += 1;
        continue;
      }

      seenOrderIds.add(row.orderId);
      cleaned.push(row);
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
    const distribution = this.emptyClassRecord<number>(() => 0);
    for (const row of rows) {
      distribution[row.outcome] += 1;
    }
    return distribution;
  }

  private stratifiedSplit(rows: ServiceOutcomeTrainingRow[]) {
    const training: ServiceOutcomeTrainingRow[] = [];
    const test: ServiceOutcomeTrainingRow[] = [];

    for (const outcome of SERVICE_OUTCOME_CLASSES) {
      const classRows = rows
        .filter((row) => row.outcome === outcome)
        .sort((left, right) => {
          const scoreDifference =
            this.deterministicScore(left) - this.deterministicScore(right);
          return scoreDifference || left.orderId - right.orderId;
        });
      const testSize = Math.max(
        1,
        Math.min(
          classRows.length - 1,
          Math.round(classRows.length * TEST_FRACTION),
        ),
      );

      test.push(...classRows.slice(0, testSize));
      training.push(...classRows.slice(testSize));
    }

    return { training, test };
  }

  /** Hash estable: permite repetir exactamente la misma evaluacion. */
  private deterministicScore(row: ServiceOutcomeTrainingRow) {
    const value = `${row.outcome}:${row.orderId}`;
    let hash = 2_166_136_261;

    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 16_777_619);
    }

    return hash >>> 0;
  }

  private fitClassifier(rows: ServiceOutcomeTrainingRow[]): FittedClassifier {
    const preprocessing = this.buildPreprocessing(rows);
    const featureCount = this.getFeatureCount(preprocessing);

    if (featureCount === 1) {
      const distribution = this.countClasses(rows);
      throw new ServiceOutcomeModelUnavailableError(
        'Las ordenes historicas no tienen variables con suficiente variacion para entrenar el modelo.',
        {
          minimumSamplesPerClass: SERVICE_OUTCOME_MINIMUM_SAMPLES_PER_CLASS,
          validSamples: rows.length,
          discardedRows: 0,
          classDistribution: distribution,
        },
      );
    }

    const features = rows.map((row) =>
      this.toFeatureVector(row, preprocessing),
    );
    const targets = rows.map((row) =>
      SERVICE_OUTCOME_CLASSES.indexOf(row.outcome),
    );
    const weights = this.fitLogisticRegression(features, targets, featureCount);

    return { preprocessing, weights };
  }

  private buildPreprocessing(
    rows: ServiceOutcomeTrainingRow[],
  ): PreprocessingConfig {
    const numeric: NumericFeatureConfig[] = [];
    const categorical: CategoricalFeatureConfig[] = [];

    for (const key of NUMERIC_FEATURES) {
      const values = rows
        .map((row) => this.toFiniteNumber(row[key]))
        .filter((value): value is number => value !== null);

      if (values.length < 2) continue;

      const mean =
        values.reduce((total, value) => total + value, 0) / values.length;
      const variance =
        values.reduce((total, value) => total + Math.pow(value - mean, 2), 0) /
        values.length;
      const standardDeviation = Math.sqrt(variance);

      if (standardDeviation <= MINIMUM_STANDARD_DEVIATION) continue;
      numeric.push({ key, mean, standardDeviation });
    }

    for (const key of CATEGORICAL_FEATURES) {
      const observedCategories = [
        ...new Set(rows.map((row) => this.normalizeCategory(row[key]))),
      ].sort();

      if (observedCategories.length < 2) continue;
      categorical.push({
        key,
        categories: [...observedCategories, OTHER_CATEGORY],
      });
    }

    return { numeric, categorical };
  }

  private getFeatureCount(config: PreprocessingConfig) {
    return (
      1 +
      config.numeric.length +
      config.categorical.reduce(
        (total, feature) => total + feature.categories.length,
        0,
      )
    );
  }

  private getFeaturesUsed(config: PreprocessingConfig) {
    return [
      ...config.numeric.map((feature) => feature.key),
      ...config.categorical.map((feature) => feature.key),
    ];
  }

  private toFeatureVector(
    input: ServiceOutcomeFeatures,
    config: PreprocessingConfig,
  ) {
    const vector = [1];

    for (const feature of config.numeric) {
      const value = this.toFiniteNumber(input[feature.key]) ?? feature.mean;
      vector.push((value - feature.mean) / feature.standardDeviation);
    }

    for (const feature of config.categorical) {
      const normalizedValue = this.normalizeCategory(input[feature.key]);
      const category = feature.categories.includes(normalizedValue)
        ? normalizedValue
        : OTHER_CATEGORY;

      for (const configuredCategory of feature.categories) {
        vector.push(category === configuredCategory ? 1 : 0);
      }
    }

    return vector;
  }

  private fitLogisticRegression(
    features: number[][],
    targets: number[],
    featureCount: number,
  ) {
    const weights = SERVICE_OUTCOME_CLASSES.map(
      () => Array(featureCount).fill(0) as number[],
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
        const probabilities = this.softmax(
          weights.map((classWeights) => this.dot(row, classWeights)),
        );
        const target = targets[rowIndex];
        loss -= Math.log(Math.max(probabilities[target], Number.EPSILON));

        for (
          let classIndex = 0;
          classIndex < SERVICE_OUTCOME_CLASSES.length;
          classIndex += 1
        ) {
          const error =
            probabilities[classIndex] - (target === classIndex ? 1 : 0);
          for (
            let featureIndex = 0;
            featureIndex < featureCount;
            featureIndex += 1
          ) {
            gradients[classIndex][featureIndex] += error * row[featureIndex];
          }
        }
      }

      loss /= features.length;
      const epochLearningRate = LEARNING_RATE / Math.sqrt(1 + epoch * 0.01);

      for (
        let classIndex = 0;
        classIndex < SERVICE_OUTCOME_CLASSES.length;
        classIndex += 1
      ) {
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
            gradients[classIndex][featureIndex] / features.length;
          weights[classIndex][featureIndex] -=
            epochLearningRate * (gradient + regularization);
        }
      }

      if (bestLoss - loss > MINIMUM_LOSS_IMPROVEMENT) {
        bestLoss = loss;
        epochsWithoutImprovement = 0;
      } else {
        epochsWithoutImprovement += 1;
        if (epochsWithoutImprovement >= EARLY_STOPPING_PATIENCE) break;
      }
    }

    return weights;
  }

  private predictOne(
    input: ServiceOutcomeFeatures,
    classifier: FittedClassifier,
  ): ServiceOutcomePrediction {
    const features = this.toFeatureVector(input, classifier.preprocessing);
    const values = this.softmax(
      classifier.weights.map((weights) => this.dot(features, weights)),
    );
    const probabilities = this.emptyClassRecord<number>(
      (outcome) => values[SERVICE_OUTCOME_CLASSES.indexOf(outcome)],
    );
    const outcome = SERVICE_OUTCOME_CLASSES.reduce((best, candidate) =>
      probabilities[candidate] > probabilities[best] ? candidate : best,
    );

    return {
      outcome,
      probability: probabilities[outcome],
      probabilities,
    };
  }

  private evaluate(
    actual: ServiceOutcomeClass[],
    predicted: ServiceOutcomeClass[],
  ) {
    const confusionMatrix = this.emptyClassRecord<
      Record<ServiceOutcomeClass, number>
    >(() => this.emptyClassRecord<number>(() => 0));

    for (let index = 0; index < actual.length; index += 1) {
      confusionMatrix[actual[index]][predicted[index]] += 1;
    }

    const metricsByClass = this.emptyClassRecord<ServiceOutcomeClassMetrics>(
      (outcome) => {
        const truePositives = confusionMatrix[outcome][outcome];
        const falsePositives = SERVICE_OUTCOME_CLASSES.reduce(
          (total, actualOutcome) =>
            actualOutcome === outcome
              ? total
              : total + confusionMatrix[actualOutcome][outcome],
          0,
        );
        const falseNegatives = SERVICE_OUTCOME_CLASSES.reduce(
          (total, predictedOutcome) =>
            predictedOutcome === outcome
              ? total
              : total + confusionMatrix[outcome][predictedOutcome],
          0,
        );
        const support = SERVICE_OUTCOME_CLASSES.reduce(
          (total, predictedOutcome) =>
            total + confusionMatrix[outcome][predictedOutcome],
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
        const f1Score = this.safeDivide(
          2 * precision * recall,
          precision + recall,
        );

        return {
          precision: this.round(precision),
          recall: this.round(recall),
          f1Score: this.round(f1Score),
          support,
        };
      },
    );
    const correct = SERVICE_OUTCOME_CLASSES.reduce(
      (total, outcome) => total + confusionMatrix[outcome][outcome],
      0,
    );

    return {
      accuracy: this.safeDivide(correct, actual.length),
      confusionMatrix,
      metricsByClass,
    };
  }

  private buildWarnings(
    discardedRows: number,
    distribution: Record<ServiceOutcomeClass, number>,
    featuresUsed: (keyof ServiceOutcomeFeatures)[],
  ) {
    const warnings: string[] = [];

    if (discardedRows > 0) {
      warnings.push(
        `Se descartaron ${discardedRows} filas duplicadas o sin datos utilizables.`,
      );
    }

    const counts = SERVICE_OUTCOME_CLASSES.map(
      (outcome) => distribution[outcome],
    );
    if (Math.max(...counts) >= Math.min(...counts) * 2) {
      warnings.push(
        'La distribucion de resultados esta desbalanceada; revisa las metricas de cada clase.',
      );
    }

    const omittedFeatures = [
      ...NUMERIC_FEATURES,
      ...CATEGORICAL_FEATURES,
    ].filter((feature) => !featuresUsed.includes(feature));
    if (omittedFeatures.length > 0) {
      warnings.push(
        'Las variables vacias o sin variacion fueron omitidas del modelo.',
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
