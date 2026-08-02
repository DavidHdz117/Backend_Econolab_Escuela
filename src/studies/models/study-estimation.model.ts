import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import {
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { StudySampleType, StudyType } from '../entities/study.entity';

const STUDY_PRICE_ARTIFACT_RELATIVE_PATH =
  'ml/regression/artifacts/regression_price_model.json';
const NUMERIC_FEATURES = ['parameter_count', 'duration_minutes'] as const;
const CATEGORICAL_FEATURES = [
  'method',
  'sample_type',
  'requires_special_processing',
] as const;

type NumericFeatureName = (typeof NUMERIC_FEATURES)[number];
type CategoricalFeatureName = (typeof CATEGORICAL_FEATURES)[number];

export type StudyEstimationInput = {
  type: StudyType;
  parameterCount: number;
  durationMinutes?: number;
  method?: string;
  sampleType?: StudySampleType | string;
  requiresSpecialProcessing?: boolean | null;
};

type RegressionMetrics = {
  mae: number;
  rmse: number;
  r2: number;
};

type NumericFeatureConfig = {
  median: number;
  mean: number;
  scale: number;
  minimum: number;
  maximum: number;
};

type CategoricalFeatureConfig = {
  categories: string[];
  defaultValue: string;
};

type StudyPriceArtifact = {
  schemaVersion: number;
  modelName: string;
  modelVersion: string;
  generatedAt: string;
  algorithm: 'ridge_regression';
  target: 'normal_price';
  randomSeed: number;
  dataset?: {
    audit?: {
      syntheticFraction?: number;
    };
  };
  split: {
    trainingSamples: number;
    testSamples: number;
  };
  features: {
    input: string[];
    orderedEncoded: string[];
    numeric: Record<NumericFeatureName, NumericFeatureConfig>;
    categorical: Record<CategoricalFeatureName, CategoricalFeatureConfig>;
  };
  coefficients: {
    intercept: number;
    values: number[];
  };
  metrics: {
    train: RegressionMetrics;
    test: RegressionMetrics;
    testByOrigin?: {
      real?: RegressionMetrics & { samples: number };
      synthetic?: RegressionMetrics & { samples: number };
    };
    baselineTest: RegressionMetrics;
  };
};

/**
 * PASO 5: modelo de regresion utilizado por la API.
 *
 * Esta clase NO entrena durante una peticion. Al iniciar Nest carga el JSON
 * generado previamente por el proceso offline de entrenamiento.
 */
@Injectable()
export class StudyEstimationModel {
  private artifact?: StudyPriceArtifact;
  private artifactProblem?: string;

  constructor() {
    this.loadArtifact();
  }

  predict(input: StudyEstimationInput) {
    if (input.type !== StudyType.STUDY) {
      throw new BadRequestException(
        'La estimacion de precio solo esta disponible para estudios individuales.',
      );
    }

    const artifact = this.getArtifactOrFail();
    const encodedInput = this.encodeInput(input, artifact);

    const rawPrice =
      artifact.coefficients.intercept +
      this.dot(encodedInput, artifact.coefficients.values);
    const suggestedNormalPrice = this.roundToStep(Math.max(0, rawPrice), 10);
    const priceMargin = Math.max(10, artifact.metrics.test.mae);

    return {
      suggestedNormalPrice,
      priceRange: {
        min: this.roundToStep(
          Math.max(0, suggestedNormalPrice - priceMargin),
          10,
        ),
        max: this.roundToStep(suggestedNormalPrice + priceMargin, 10),
      },
      model: {
        algorithm: artifact.algorithm,
        version: artifact.modelVersion,
        artifactGeneratedAt: artifact.generatedAt,
        randomSeed: artifact.randomSeed,
        trainingSamples: artifact.split.trainingSamples,
        testSamples: artifact.split.testSamples,
        priceMeanAbsoluteError: artifact.metrics.test.mae,
        priceRootMeanSquaredError: artifact.metrics.test.rmse,
        priceR2: artifact.metrics.test.r2,
        baselineMeanAbsoluteError: artifact.metrics.baselineTest.mae,
        featuresUsed: [
          'numero_parametros',
          'duracion_minutos',
          'metodo',
          'tipo_muestra',
          'procesamiento_especial',
        ],
      },
      warnings: this.buildWarnings(input, artifact),
    };
  }

  private loadArtifact() {
    const artifactPath = this.resolveArtifactPath();

    try {
      const candidate: unknown = JSON.parse(readFileSync(artifactPath, 'utf8'));
      this.assertValidArtifact(candidate);
      this.artifact = candidate;
    } catch (error) {
      this.artifact = undefined;
      this.artifactProblem =
        error instanceof Error ? error.message : 'contenido no valido';
    }
  }

  private resolveArtifactPath() {
    const configuredPath = process.env.STUDY_PRICE_MODEL_PATH?.trim();
    if (configuredPath) {
      return isAbsolute(configuredPath)
        ? configuredPath
        : resolve(process.cwd(), configuredPath);
    }

    const candidates = [
      resolve(process.cwd(), STUDY_PRICE_ARTIFACT_RELATIVE_PATH),
      resolve(
        __dirname,
        '../../../',
        STUDY_PRICE_ARTIFACT_RELATIVE_PATH,
      ),
      resolve(__dirname, '../../../ml-artifacts/regression_price_model.json'),
    ];
    return (
      candidates.find((candidate) => existsSync(candidate)) ?? candidates[0]
    );
  }

  private getArtifactOrFail() {
    if (!this.artifact) {
      throw new ServiceUnavailableException(
        'El modelo de precio no esta disponible porque falta o es invalido el ' +
          `artefacto JSON (${this.artifactProblem ?? 'sin detalle'}). ` +
          'Ejecute: npm run regression:export y npm run regression:train o la libreta de regresion.',
      );
    }

    return this.artifact;
  }

  private assertValidArtifact(
    value: unknown,
  ): asserts value is StudyPriceArtifact {
    const artifact = value as Partial<StudyPriceArtifact> | null;
    const numeric = artifact?.features?.numeric;
    const categorical = artifact?.features?.categorical;
    const coefficients = artifact?.coefficients?.values;
    const expectedCoefficientCount =
      NUMERIC_FEATURES.length +
      CATEGORICAL_FEATURES.reduce(
        (total, feature) =>
          total + (categorical?.[feature]?.categories?.length ?? 0),
        0,
      );

    if (
      !artifact ||
      artifact.schemaVersion !== 2 ||
      typeof artifact.modelName !== 'string' ||
      typeof artifact.modelVersion !== 'string' ||
      typeof artifact.generatedAt !== 'string' ||
      artifact.algorithm !== 'ridge_regression' ||
      artifact.target !== 'normal_price' ||
      !Number.isInteger(artifact.randomSeed) ||
      !Array.isArray(artifact.features?.input) ||
      !NUMERIC_FEATURES.every((feature) =>
        artifact.features?.input?.includes(feature),
      ) ||
      !CATEGORICAL_FEATURES.every((feature) =>
        artifact.features?.input?.includes(feature),
      ) ||
      !numeric ||
      !categorical ||
      !NUMERIC_FEATURES.every((feature) =>
        this.isValidNumericFeatureConfig(numeric[feature]),
      ) ||
      !CATEGORICAL_FEATURES.every((feature) =>
        this.isValidCategoricalFeatureConfig(categorical[feature]),
      ) ||
      !this.isFiniteNumber(artifact.coefficients?.intercept) ||
      !Array.isArray(coefficients) ||
      coefficients.length !== expectedCoefficientCount ||
      !coefficients.every((coefficient) => this.isFiniteNumber(coefficient)) ||
      !this.isValidMetrics(artifact.metrics?.test) ||
      !this.isValidMetrics(artifact.metrics?.baselineTest) ||
      !Number.isInteger(artifact.split?.trainingSamples) ||
      (artifact.split?.trainingSamples ?? 0) < 1 ||
      !Number.isInteger(artifact.split?.testSamples) ||
      (artifact.split?.testSamples ?? 0) < 1
    ) {
      throw new Error('la estructura o los coeficientes no son validos');
    }
  }

  private encodeInput(
    input: StudyEstimationInput,
    artifact: StudyPriceArtifact,
  ) {
    const parameterConfig = artifact.features.numeric.parameter_count;
    const durationConfig = artifact.features.numeric.duration_minutes;
    const methodConfig = artifact.features.categorical.method;
    const sampleTypeConfig = artifact.features.categorical.sample_type;
    const specialProcessingConfig =
      artifact.features.categorical.requires_special_processing;

    const parameterCount = this.normalizeNumericInput(
      input.parameterCount,
      parameterConfig.median,
    );
    const durationMinutes = this.normalizeNumericInput(
      input.durationMinutes,
      durationConfig.median,
    );
    const normalizedMethod = this.normalizeCategory(
      input.method,
      methodConfig.defaultValue,
    );
    const normalizedSampleType = this.normalizeCategory(
      input.sampleType,
      sampleTypeConfig.defaultValue,
    );
    const normalizedSpecialProcessing = this.normalizeBooleanCategory(
      input.requiresSpecialProcessing,
      specialProcessingConfig.defaultValue,
    );

    return [
      (parameterCount - parameterConfig.mean) / parameterConfig.scale,
      (durationMinutes - durationConfig.mean) / durationConfig.scale,
      ...methodConfig.categories.map((category) =>
        normalizedMethod === category ? 1 : 0,
      ),
      ...sampleTypeConfig.categories.map((category) =>
        normalizedSampleType === category ? 1 : 0,
      ),
      ...specialProcessingConfig.categories.map((category) =>
        normalizedSpecialProcessing === category ? 1 : 0,
      ),
    ];
  }

  private buildWarnings(
    input: StudyEstimationInput,
    artifact: StudyPriceArtifact,
  ) {
    const warnings: string[] = [];
    const parameterConfig = artifact.features.numeric.parameter_count;
    const durationConfig = artifact.features.numeric.duration_minutes;
    const methodConfig = artifact.features.categorical.method;
    const sampleTypeConfig = artifact.features.categorical.sample_type;
    const specialProcessingConfig =
      artifact.features.categorical.requires_special_processing;

    const syntheticFraction = artifact.dataset?.audit?.syntheticFraction;
    const realMetrics = artifact.metrics.testByOrigin?.real;
    if (typeof syntheticFraction === 'number' && syntheticFraction >= 0.8) {
      const realEvaluation = realMetrics
        ? ` En ${realMetrics.samples} estudios reales de prueba, el MAE fue $${realMetrics.mae.toFixed(2)} MXN.`
        : '';
      warnings.push(
        `Prototipo academico: ${(syntheticFraction * 100).toFixed(2)} % del dataset es demostrativo.${realEvaluation} Confirma el precio antes de guardar.`,
      );
    }

    const method = this.normalizeCategory(input.method, methodConfig.defaultValue);
    if (input.method && !methodConfig.categories.includes(method)) {
      warnings.push(
        'El metodo no aparecio en entrenamiento; se calculo con la referencia general.',
      );
    }

    const sampleType = this.normalizeCategory(
      input.sampleType,
      sampleTypeConfig.defaultValue,
    );
    if (input.sampleType && !sampleTypeConfig.categories.includes(sampleType)) {
      warnings.push(
        'El tipo de muestra no aparecio en entrenamiento; se calculo con la referencia general.',
      );
    }

    const specialProcessing = this.normalizeBooleanCategory(
      input.requiresSpecialProcessing,
      specialProcessingConfig.defaultValue,
    );
    if (
      input.requiresSpecialProcessing != null &&
      !specialProcessingConfig.categories.includes(specialProcessing)
    ) {
      warnings.push(
        'La combinacion de procesamiento especial no aparecio en entrenamiento; se calculo con la referencia general.',
      );
    }

    if (
      input.parameterCount < parameterConfig.minimum ||
      input.parameterCount > parameterConfig.maximum
    ) {
      warnings.push(
        `El numero de parametros esta fuera del rango entrenado (${parameterConfig.minimum}-${parameterConfig.maximum}).`,
      );
    }

    if (
      this.isFiniteNumber(input.durationMinutes) &&
      (input.durationMinutes < durationConfig.minimum ||
        input.durationMinutes > durationConfig.maximum)
    ) {
      warnings.push(
        `La duracion esta fuera del rango entrenado (${durationConfig.minimum}-${durationConfig.maximum} minutos).`,
      );
    }

    return warnings;
  }

  private normalizeCategory(
    value: string | StudySampleType | undefined,
    fallback: string,
  ) {
    const normalized = String(value ?? '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, ' ');
    return normalized || fallback;
  }

  private normalizeBooleanCategory(
    value: boolean | null | undefined,
    fallback: string,
  ) {
    if (value === true) return 'true';
    if (value === false) return 'false';
    return fallback;
  }

  private normalizeNumericInput(value: unknown, fallback: number) {
    return this.isFiniteNumber(value) ? value : fallback;
  }

  private isValidMetrics(value: unknown): value is RegressionMetrics {
    const metrics = value as Partial<RegressionMetrics> | null;
    return Boolean(
      metrics &&
        this.isFiniteNumber(metrics.mae) &&
        this.isFiniteNumber(metrics.rmse) &&
        this.isFiniteNumber(metrics.r2),
    );
  }

  private isValidNumericFeatureConfig(
    value: unknown,
  ): value is NumericFeatureConfig {
    const feature = value as Partial<NumericFeatureConfig> | null;
    return Boolean(
      feature &&
        this.isFiniteNumber(feature.median) &&
        this.isFiniteNumber(feature.mean) &&
        this.isFiniteNumber(feature.scale) &&
        feature.scale > 0 &&
        this.isFiniteNumber(feature.minimum) &&
        this.isFiniteNumber(feature.maximum) &&
        feature.minimum <= feature.maximum,
    );
  }

  private isValidCategoricalFeatureConfig(
    value: unknown,
  ): value is CategoricalFeatureConfig {
    const feature = value as Partial<CategoricalFeatureConfig> | null;
    return Boolean(
      feature &&
        typeof feature.defaultValue === 'string' &&
        Array.isArray(feature.categories) &&
        feature.categories.length > 0 &&
        feature.categories.every((category) => typeof category === 'string'),
    );
  }

  private isFiniteNumber(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value);
  }

  private dot(left: number[], right: number[]) {
    return left.reduce(
      (total, value, index) => total + value * right[index],
      0,
    );
  }

  private roundToStep(value: number, step: number) {
    return Math.round(value / step) * step;
  }
}
