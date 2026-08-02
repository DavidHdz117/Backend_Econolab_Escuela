import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { StudyType } from '../entities/study.entity';
import { StudyEstimationModel } from './study-estimation.model';

const VALID_ARTIFACT = {
  schemaVersion: 2,
  modelName: 'test_price_model',
  modelVersion: '3.0.0-test',
  generatedAt: '2026-08-02T00:00:00.000Z',
  algorithm: 'ridge_regression',
  target: 'normal_price',
  randomSeed: 42,
  split: { trainingSamples: 80, testSamples: 20 },
  features: {
    input: [
      'parameter_count',
      'duration_minutes',
      'method',
      'sample_type',
      'requires_special_processing',
    ],
    orderedEncoded: [
      'parameter_count_scaled',
      'duration_minutes_scaled',
      'method=elisa',
      'method=pcr',
      'sample_type=blood',
      'sample_type=urine',
      'requires_special_processing=false',
      'requires_special_processing=true',
    ],
    numeric: {
      parameter_count: {
        median: 10,
        mean: 10,
        scale: 2,
        minimum: 1,
        maximum: 30,
      },
      duration_minutes: {
        median: 60,
        mean: 60,
        scale: 30,
        minimum: 15,
        maximum: 180,
      },
    },
    categorical: {
      method: {
        categories: ['elisa', 'pcr'],
        defaultValue: 'elisa',
      },
      sample_type: {
        categories: ['blood', 'urine'],
        defaultValue: 'blood',
      },
      requires_special_processing: {
        categories: ['false', 'true'],
        defaultValue: 'false',
      },
    },
  },
  coefficients: {
    intercept: 100,
    values: [20, 15, 10, -10, 5, -5, 4, -4],
  },
  metrics: {
    train: { mae: 12, rmse: 18, r2: 0.9 },
    test: { mae: 15, rmse: 22, r2: 0.85 },
    baselineTest: { mae: 50, rmse: 65, r2: -0.02 },
  },
};

describe('StudyEstimationModel', () => {
  const temporaryDirectory = mkdtempSync(
    join(tmpdir(), 'econolab-regression-'),
  );
  const originalPath = process.env.STUDY_PRICE_MODEL_PATH;

  afterAll(() => {
    if (originalPath === undefined) {
      delete process.env.STUDY_PRICE_MODEL_PATH;
    } else {
      process.env.STUDY_PRICE_MODEL_PATH = originalPath;
    }
    rmSync(temporaryDirectory, { recursive: true, force: true });
  });

  function modelUsing(path: string) {
    process.env.STUDY_PRICE_MODEL_PATH = path;
    return new StudyEstimationModel();
  }

  it('carga el artefacto real generado por el notebook', () => {
    const deploymentArtifact = resolve(
      __dirname,
      '../../../ml-artifacts/regression_price_model.json',
    );
    const model = modelUsing(deploymentArtifact);
    const result = model.predict({
      type: StudyType.STUDY,
      parameterCount: 8,
      durationMinutes: 60,
      method: 'ELISA',
      sampleType: 'blood',
      requiresSpecialProcessing: false,
    });

    expect(result.suggestedNormalPrice).toBeGreaterThan(0);
    expect(result.model.trainingSamples).toBeGreaterThan(0);
    expect(result.model.testSamples).toBeGreaterThan(0);
    expect(Number.isFinite(result.model.priceR2)).toBe(true);
    expect(result.model.featuresUsed).toHaveLength(5);
  });

  it('carga el artefacto y usa sus coeficientes sin reentrenar', () => {
    const artifactPath = join(temporaryDirectory, 'valid-model.json');
    writeFileSync(artifactPath, JSON.stringify(VALID_ARTIFACT), 'utf8');
    const model = modelUsing(artifactPath);

    writeFileSync(artifactPath, '{ contenido cambiado }', 'utf8');
    const result = model.predict({
      type: StudyType.STUDY,
      parameterCount: 12,
      durationMinutes: 90,
      method: 'ELISA',
      sampleType: 'blood',
      requiresSpecialProcessing: false,
    });

    expect(result.suggestedNormalPrice).toBe(150);
    expect(result.model.algorithm).toBe('ridge_regression');
    expect(result.model.trainingSamples).toBe(80);
    expect(result.model.testSamples).toBe(20);
    expect(result.model.priceMeanAbsoluteError).toBe(15);
    expect(result.model.priceRootMeanSquaredError).toBe(22);
    expect(result.model.priceR2).toBe(0.85);
    expect(result.model.baselineMeanAbsoluteError).toBe(50);
    expect(result.warnings).toEqual([]);
  });

  it('avisa cuando la entrada esta fuera de las categorias y rangos entrenados', () => {
    const artifactPath = join(temporaryDirectory, 'warnings-model.json');
    writeFileSync(artifactPath, JSON.stringify(VALID_ARTIFACT), 'utf8');
    const model = modelUsing(artifactPath);

    const result = model.predict({
      type: StudyType.STUDY,
      parameterCount: 40,
      durationMinutes: 500,
      method: 'Metodo nuevo',
      sampleType: 'other',
      requiresSpecialProcessing: true,
    });

    expect(result.warnings).toHaveLength(4);
    expect(result.warnings[0]).toContain('no aparecio');
    expect(result.warnings[1]).toContain('tipo de muestra');
    expect(result.warnings[2]).toContain('1-30');
    expect(result.warnings[3]).toContain('15-180');
  });

  it('rechaza paquetes porque el modelo se entreno para estudios individuales', () => {
    const artifactPath = join(temporaryDirectory, 'study-only-model.json');
    writeFileSync(artifactPath, JSON.stringify(VALID_ARTIFACT), 'utf8');
    const model = modelUsing(artifactPath);

    expect(() =>
      model.predict({
        type: StudyType.PACKAGE,
        parameterCount: 8,
        durationMinutes: 60,
        method: 'ELISA',
      }),
    ).toThrow(BadRequestException);
  });

  it('responde claramente cuando falta el artefacto', () => {
    const model = modelUsing(join(temporaryDirectory, 'missing.json'));

    expect(() =>
      model.predict({
        type: StudyType.STUDY,
        parameterCount: 5,
        durationMinutes: 60,
        method: 'ELISA',
      }),
    ).toThrow(ServiceUnavailableException);
  });

  it('rechaza un artefacto JSON con estructura invalida', () => {
    const artifactPath = join(temporaryDirectory, 'invalid-model.json');
    writeFileSync(artifactPath, JSON.stringify({ schemaVersion: 2 }), 'utf8');
    const model = modelUsing(artifactPath);

    expect(() =>
      model.predict({
        type: StudyType.STUDY,
        parameterCount: 5,
        durationMinutes: 60,
        method: 'ELISA',
      }),
    ).toThrow('artefacto JSON');
  });
});
