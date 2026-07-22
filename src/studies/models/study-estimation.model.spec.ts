import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { StudyType } from '../entities/study.entity';
import { StudyEstimationModel } from './study-estimation.model';

const VALID_ARTIFACT = {
  schemaVersion: 1,
  modelName: 'test_price_model',
  modelVersion: '2.0.0-test',
  generatedAt: '2026-07-21T00:00:00.000Z',
  algorithm: 'ridge_regression',
  target: 'normal_price',
  randomSeed: 42,
  split: { trainingSamples: 80, testSamples: 20 },
  features: {
    input: ['parameter_count', 'method'],
    orderedEncoded: [
      'parameter_count_scaled',
      'method=elisa',
      'method=pcr',
    ],
    numeric: {
      parameter_count: { mean: 10, scale: 2, minimum: 1, maximum: 30 },
    },
    categorical: {
      method: ['elisa', 'pcr'],
    },
  },
  coefficients: {
    intercept: 100,
    values: [20, 10, -10],
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
      method: 'ELISA',
    });

    expect(result.suggestedNormalPrice).toBeGreaterThan(0);
    expect(result.model.trainingSamples).toBeGreaterThan(0);
    expect(result.model.testSamples).toBeGreaterThan(0);
    expect(Number.isFinite(result.model.priceR2)).toBe(true);
  });

  it('carga el artefacto y usa sus coeficientes sin reentrenar', () => {
    const artifactPath = join(temporaryDirectory, 'valid-model.json');
    writeFileSync(artifactPath, JSON.stringify(VALID_ARTIFACT), 'utf8');
    const model = modelUsing(artifactPath);

    // Si intentara leer/reentrenar en cada predict, este cambio lo romperia.
    writeFileSync(artifactPath, '{ contenido cambiado }', 'utf8');
    const result = model.predict({
      type: StudyType.STUDY,
      parameterCount: 12,
      method: 'ÉLISA',
    });

    expect(result.suggestedNormalPrice).toBe(130);
    expect(result.model.algorithm).toBe('ridge_regression');
    expect(result.model.trainingSamples).toBe(80);
    expect(result.model.testSamples).toBe(20);
    expect(result.model.priceMeanAbsoluteError).toBe(15);
    expect(result.model.priceRootMeanSquaredError).toBe(22);
    expect(result.model.priceR2).toBe(0.85);
    expect(result.model.baselineMeanAbsoluteError).toBe(50);
    expect(result.warnings).toEqual([]);
  });

  it('avisa cuando la entrada esta fuera de las categorias y rango entrenados', () => {
    const artifactPath = join(temporaryDirectory, 'warnings-model.json');
    writeFileSync(artifactPath, JSON.stringify(VALID_ARTIFACT), 'utf8');
    const model = modelUsing(artifactPath);

    const result = model.predict({
      type: StudyType.STUDY,
      parameterCount: 40,
      method: 'Metodo nuevo',
    });

    expect(result.warnings).toHaveLength(2);
    expect(result.warnings[0]).toContain('no aparecio');
    expect(result.warnings[1]).toContain('1-30');
  });

  it('rechaza paquetes porque el modelo se entreno para estudios individuales', () => {
    const artifactPath = join(temporaryDirectory, 'study-only-model.json');
    writeFileSync(artifactPath, JSON.stringify(VALID_ARTIFACT), 'utf8');
    const model = modelUsing(artifactPath);

    expect(() =>
      model.predict({
        type: StudyType.PACKAGE,
        parameterCount: 8,
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
        method: 'ELISA',
      }),
    ).toThrow(ServiceUnavailableException);
  });

  it('rechaza un artefacto JSON con estructura invalida', () => {
    const artifactPath = join(temporaryDirectory, 'invalid-model.json');
    writeFileSync(artifactPath, JSON.stringify({ schemaVersion: 1 }), 'utf8');
    const model = modelUsing(artifactPath);

    expect(() =>
      model.predict({
        type: StudyType.STUDY,
        parameterCount: 5,
        method: 'ELISA',
      }),
    ).toThrow('artefacto JSON');
  });
});
