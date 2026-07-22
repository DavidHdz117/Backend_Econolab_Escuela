import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import {
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { StudyType } from '../entities/study.entity';

const STUDY_PRICE_ARTIFACT_RELATIVE_PATH =
  'ml/regression/artifacts/regression_price_model.json';

export type StudyEstimationInput = {
  type: StudyType;
  parameterCount: number;
  method?: string;
};

type RegressionMetrics = {
  mae: number;
  rmse: number;
  r2: number;
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
    numeric: {
      parameter_count: {
        mean: number;
        scale: number;
        minimum: number;
        maximum: number;
      };
    };
    categorical: {
      method: string[];
    };
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
 * generado previamente por 06_Notebooks/02_regresion_precio_estudios.ipynb.
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

    // PASO 6A: aplicar exactamente la misma transformacion aprendida en train.
    const encodedInput = this.encodeInput(input, artifact);

    // PASO 6B: aqui se USA el modelo: intercepto + X por coeficientes.
    // No hay fit/reentrenamiento ni consulta a BD dentro de esta peticion.
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
        featuresUsed: ['metodo', 'numero_parametros'],
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

    // Primero busca el artefacto academico generado por la libreta; si no existe,
    // conserva compatibilidad con la copia historica de `ml-artifacts`.
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
    const numeric = artifact?.features?.numeric?.parameter_count;
    const methodCategories = artifact?.features?.categorical?.method;
    const coefficients = artifact?.coefficients?.values;
    const expectedCoefficientCount = 1 + (methodCategories?.length ?? 0);

    if (
      !artifact ||
      artifact.schemaVersion !== 1 ||
      typeof artifact.modelName !== 'string' ||
      typeof artifact.modelVersion !== 'string' ||
      typeof artifact.generatedAt !== 'string' ||
      artifact.algorithm !== 'ridge_regression' ||
      artifact.target !== 'normal_price' ||
      !Number.isInteger(artifact.randomSeed) ||
      !numeric ||
      !this.isFiniteNumber(numeric.mean) ||
      !this.isFiniteNumber(numeric.scale) ||
      numeric.scale <= 0 ||
      !this.isFiniteNumber(numeric.minimum) ||
      !this.isFiniteNumber(numeric.maximum) ||
      numeric.minimum > numeric.maximum ||
      !Array.isArray(methodCategories) ||
      methodCategories.length === 0 ||
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
    const numeric = artifact.features.numeric.parameter_count;
    const normalizedMethod = this.normalizeCategory(input.method, 'sin_metodo');

    return [
      (input.parameterCount - numeric.mean) / numeric.scale,
      ...artifact.features.categorical.method.map((category) =>
        normalizedMethod === category ? 1 : 0,
      ),
    ];
  }

  private buildWarnings(
    input: StudyEstimationInput,
    artifact: StudyPriceArtifact,
  ) {
    const warnings: string[] = [];
    const numeric = artifact.features.numeric.parameter_count;
    const method = this.normalizeCategory(input.method, 'sin_metodo');

    const syntheticFraction = artifact.dataset?.audit?.syntheticFraction;
    const realMetrics = artifact.metrics.testByOrigin?.real;
    if (
      typeof syntheticFraction === 'number' &&
      syntheticFraction >= 0.8
    ) {
      const realEvaluation = realMetrics
        ? ` En ${realMetrics.samples} estudios reales de prueba, el MAE fue $${realMetrics.mae.toFixed(2)} MXN.`
        : '';
      warnings.push(
        `Prototipo académico: ${(syntheticFraction * 100).toFixed(2)} % del dataset es demostrativo.${realEvaluation} Confirma el precio antes de guardar.`,
      );
    }

    if (!artifact.features.categorical.method.includes(method)) {
      warnings.push(
        'El metodo no aparecio en entrenamiento; se calculo con la referencia general.',
      );
    }

    if (
      input.parameterCount < numeric.minimum ||
      input.parameterCount > numeric.maximum
    ) {
      warnings.push(
        `El numero de parametros esta fuera del rango entrenado (${numeric.minimum}-${numeric.maximum}).`,
      );
    }

    return warnings;
  }

  private normalizeCategory(value: string | undefined, fallback: string) {
    const normalized = (value ?? '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, ' ');
    return normalized || fallback;
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
