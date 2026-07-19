import { BadRequestException, Injectable } from '@nestjs/common';
import { StudyType } from '../entities/study.entity';

export type StudyEstimationTrainingRow = {
  type: StudyType;
  parameterCount: number;
  method?: string;
  normalPrice: number;
  durationMinutes: number;
};

export type StudyEstimationInput = {
  type: StudyType;
  parameterCount: number;
  method?: string;
};

type RegressionModel = {
  coefficients: number[];
  meanAbsoluteError: number;
};

const RIDGE_PENALTY = 0.1;
const MIN_ROWS_WITH_PARAMETERS = 5;
const MAX_METHOD_CATEGORIES = 8;

type FeatureConfig = {
  useParameterCount: boolean;
  methodCategories: string[];
};

/**
 * Modelo de regresion lineal de ECONOLAB.
 *
 * Se entrenan dos regresiones con el catalogo real:
 * una para precio normal y otra para duracion en minutos.
 */
@Injectable()
export class StudyEstimationModel {
  predict(input: StudyEstimationInput, rows: StudyEstimationTrainingRow[]) {
    const trainingRows = rows.filter(
      (row) =>
        Number.isFinite(row.normalPrice) &&
        row.normalPrice > 0 &&
        Number.isFinite(row.durationMinutes) &&
        row.durationMinutes > 0,
    );

    if (trainingRows.length < 3) {
      throw new BadRequestException(
        'Se necesitan al menos 3 estudios con precio y duracion para entrenar el modelo.',
      );
    }

    const featureConfig = this.buildFeatureConfig(trainingRows);
    const features = trainingRows.map((row) =>
      this.toFeatures(row, featureConfig),
    );
    const priceModel = this.fit(
      features,
      trainingRows.map((row) => row.normalPrice),
    );
    const durationModel = this.fit(
      features,
      trainingRows.map((row) => row.durationMinutes),
    );
    const inputFeatures = this.toFeatures(input, featureConfig);

    const rawPrice = this.dot(inputFeatures, priceModel.coefficients);
    const rawDuration = this.dot(inputFeatures, durationModel.coefficients);
    const suggestedNormalPrice = this.roundToStep(Math.max(0, rawPrice), 10);
    const suggestedDurationMinutes = this.roundToStep(
      Math.max(15, rawDuration),
      15,
    );
    const priceMargin = Math.max(10, priceModel.meanAbsoluteError);
    const durationMargin = Math.max(15, durationModel.meanAbsoluteError);

    return {
      suggestedNormalPrice,
      suggestedDurationMinutes,
      priceRange: {
        min: this.roundToStep(
          Math.max(0, suggestedNormalPrice - priceMargin),
          10,
        ),
        max: this.roundToStep(suggestedNormalPrice + priceMargin, 10),
      },
      durationRangeMinutes: {
        min: this.roundToStep(
          Math.max(15, suggestedDurationMinutes - durationMargin),
          15,
        ),
        max: this.roundToStep(suggestedDurationMinutes + durationMargin, 15),
      },
      model: {
        algorithm: 'linear_regression',
        version: '1.0',
        trainingSamples: trainingRows.length,
        priceMeanAbsoluteError: this.round(priceModel.meanAbsoluteError),
        durationMeanAbsoluteError: this.round(durationModel.meanAbsoluteError),
        featuresUsed: [
          'tipo',
          ...(featureConfig.methodCategories.length > 0 ? ['metodo'] : []),
          ...(featureConfig.useParameterCount ? ['numero_parametros'] : []),
        ],
      },
      warnings: this.buildWarnings(input, trainingRows, featureConfig),
    };
  }

  private buildFeatureConfig(
    rows: StudyEstimationTrainingRow[],
  ): FeatureConfig {
    const rowsWithParameters = rows.filter((row) => row.parameterCount > 0);
    const differentParameterCounts = new Set(
      rowsWithParameters.map((row) => row.parameterCount),
    );
    const methodFrequency = new Map<string, number>();

    for (const row of rows) {
      const method = this.normalizeMethod(row.method);
      if (method) {
        methodFrequency.set(method, (methodFrequency.get(method) ?? 0) + 1);
      }
    }

    const methodCategories = [...methodFrequency.entries()]
      .filter(([, count]) => count >= 2)
      .sort((left, right) => right[1] - left[1])
      .slice(0, MAX_METHOD_CATEGORIES)
      .map(([method]) => method);

    return {
      useParameterCount:
        rowsWithParameters.length >= MIN_ROWS_WITH_PARAMETERS &&
        differentParameterCounts.size >= 2,
      methodCategories,
    };
  }

  private toFeatures(
    input: {
      type: StudyType;
      parameterCount: number;
      method?: string;
    },
    config: FeatureConfig,
  ) {
    const method = this.normalizeMethod(input.method);

    return [
      1,
      input.type === StudyType.PACKAGE ? 1 : 0,
      input.type === StudyType.OTHER ? 1 : 0,
      ...(config.useParameterCount ? [input.parameterCount] : []),
      ...config.methodCategories.map((category) =>
        method === category ? 1 : 0,
      ),
    ];
  }

  private fit(features: number[][], targets: number[]): RegressionModel {
    const featureCount = features[0].length;
    const matrix = Array.from({ length: featureCount }, () =>
      Array(featureCount).fill(0),
    );
    const vector = Array(featureCount).fill(0);

    for (let row = 0; row < features.length; row += 1) {
      for (let i = 0; i < featureCount; i += 1) {
        vector[i] += features[row][i] * targets[row];
        for (let j = 0; j < featureCount; j += 1) {
          matrix[i][j] += features[row][i] * features[row][j];
        }
      }
    }

    // Una penalizacion pequena evita errores cuando una columna tiene pocos datos.
    for (let i = 1; i < featureCount; i += 1) {
      matrix[i][i] += RIDGE_PENALTY;
    }

    const coefficients = this.solve(matrix, vector);
    const meanAbsoluteError =
      features.reduce(
        (total, row, index) =>
          total + Math.abs(targets[index] - this.dot(row, coefficients)),
        0,
      ) / features.length;

    return { coefficients, meanAbsoluteError };
  }

  /** Resuelve el sistema de ecuaciones del modelo con eliminacion de Gauss. */
  private solve(matrix: number[][], vector: number[]) {
    const featureCount = matrix.length;
    const augmented = matrix.map((row, index) => [...row, vector[index]]);

    for (let column = 0; column < featureCount; column += 1) {
      let pivotRow = column;
      for (let row = column + 1; row < featureCount; row += 1) {
        if (
          Math.abs(augmented[row][column]) >
          Math.abs(augmented[pivotRow][column])
        ) {
          pivotRow = row;
        }
      }

      [augmented[column], augmented[pivotRow]] = [
        augmented[pivotRow],
        augmented[column],
      ];

      const pivot = augmented[column][column] || Number.EPSILON;
      for (let value = column; value <= featureCount; value += 1) {
        augmented[column][value] /= pivot;
      }

      for (let row = 0; row < featureCount; row += 1) {
        if (row === column) continue;
        const factor = augmented[row][column];
        for (let value = column; value <= featureCount; value += 1) {
          augmented[row][value] -= factor * augmented[column][value];
        }
      }
    }

    return augmented.map((row) => row[featureCount]);
  }

  private normalizeMethod(value?: string) {
    return (value ?? '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, ' ');
  }

  private buildWarnings(
    input: StudyEstimationInput,
    rows: StudyEstimationTrainingRow[],
    config: FeatureConfig,
  ) {
    const warnings: string[] = [];

    if (!config.useParameterCount) {
      warnings.push(
        'El numero de parametros se activara cuando existan al menos 5 estudios con parametros capturados.',
      );
    }

    if (!rows.some((row) => row.type === input.type)) {
      warnings.push(
        'No existen ejemplos historicos de este tipo; la estimacion usa el promedio disponible.',
      );
    }

    const normalizedInputMethod = this.normalizeMethod(input.method);
    if (
      normalizedInputMethod &&
      !config.methodCategories.includes(normalizedInputMethod)
    ) {
      warnings.push(
        'El metodo capturado tiene pocos ejemplos historicos; se uso la referencia general del catalogo.',
      );
    }

    return warnings;
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

  private round(value: number) {
    return Math.round(value * 100) / 100;
  }
}
