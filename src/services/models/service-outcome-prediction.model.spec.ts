import {
  SERVICE_OUTCOME_CLASSES,
  SERVICE_OUTCOME_MODEL_VERSION,
  ServiceOutcomeClass,
  ServiceOutcomeFeatures,
  ServiceOutcomeModelUnavailableError,
  ServiceOutcomePredictionModel,
  ServiceOutcomeTrainingRow,
} from './service-outcome-prediction.model';

const buildRows = (samplesPerClass = 10): ServiceOutcomeTrainingRow[] => {
  const rows: ServiceOutcomeTrainingRow[] = [];
  let orderId = 1;

  const addClass = (
    outcome: ServiceOutcomeClass,
    featureFactory: (index: number) => ServiceOutcomeFeatures,
  ) => {
    for (let index = 0; index < samplesPerClass; index += 1) {
      rows.push({
        orderId,
        sourceCreatedAt: new Date(
          Date.UTC(2026, 0, 1 + index, 12, 0, 0),
        ).toISOString(),
        outcome,
        ...featureFactory(index),
      });
      orderId += 1;
    }
  };

  addClass('completed_on_time', (index) => ({
    promisedLeadHours: 36 + index,
    registrationHour: 8 + (index % 3),
    registrationWeekday: index % 5,
    itemCount: 1 + (index % 2),
    totalQuantity: 1 + (index % 2),
    distinctStudyCount: 1 + (index % 2),
    packageComponentCount: 0,
    subtotalAmount: 140 + index * 3,
    courtesyPercent: 0,
    discountAmount: 0,
    totalAmount: 140 + index * 3,
    branchName: 'Sucursal Centro',
    dominantPriceType: 'normal',
  }));

  addClass('delayed', (index) => ({
    promisedLeadHours: 2 + index * 0.2,
    registrationHour: 17 + (index % 3),
    registrationWeekday: 1 + (index % 5),
    itemCount: 5 + (index % 2),
    totalQuantity: 6 + (index % 2),
    distinctStudyCount: 5 + (index % 2),
    packageComponentCount: 2,
    subtotalAmount: 700 + index * 5,
    courtesyPercent: 0,
    discountAmount: 0,
    totalAmount: 700 + index * 5,
    branchName: 'Sucursal Norte',
    dominantPriceType: 'hospital',
  }));

  addClass('cancelled', (index) => ({
    promisedLeadHours: 14 + index * 0.4,
    registrationHour: 12 + (index % 2),
    registrationWeekday: 2 + (index % 3),
    itemCount: 2 + (index % 2),
    totalQuantity: 2 + (index % 2),
    distinctStudyCount: 2 + (index % 2),
    packageComponentCount: 0,
    subtotalAmount: 320 + index * 4,
    courtesyPercent: 10,
    discountAmount: 32 + index * 0.4,
    totalAmount: 288 + index * 3.6,
    branchName: 'Sucursal Sur',
    dominantPriceType: 'dif',
  }));

  return rows;
};

describe('ServiceOutcomePredictionModel', () => {
  it('devuelve probabilidades validas para las tres clases', () => {
    const model = new ServiceOutcomePredictionModel();
    const result = model.predictMany(
      [
        {
          promisedLeadHours: 40,
          registrationHour: 9,
          registrationWeekday: 2,
          itemCount: 1,
          totalQuantity: 1,
          distinctStudyCount: 1,
          subtotalAmount: 155,
          totalAmount: 155,
          branchName: 'Sucursal Centro',
          dominantPriceType: 'normal',
        },
        {
          promisedLeadHours: 2,
          registrationHour: 18,
          registrationWeekday: 3,
          itemCount: 6,
          totalQuantity: 7,
          distinctStudyCount: 6,
          packageComponentCount: 2,
          subtotalAmount: 730,
          totalAmount: 730,
          branchName: 'Sucursal Norte',
          dominantPriceType: 'hospital',
        },
      ],
      buildRows(),
    );

    expect(result.predictions).toHaveLength(2);
    expect(result.predictions[0].outcome).toBe('completed_on_time');
    expect(result.predictions[1].outcome).toBe('delayed');

    for (const prediction of result.predictions) {
      const probabilityTotal = SERVICE_OUTCOME_CLASSES.reduce(
        (total, outcome) => total + prediction.probabilities[outcome],
        0,
      );
      expect(probabilityTotal).toBeCloseTo(1, 10);
      expect(prediction.probability).toBe(
        prediction.probabilities[prediction.outcome],
      );
      for (const outcome of SERVICE_OUTCOME_CLASSES) {
        expect(prediction.probabilities[outcome]).toBeGreaterThanOrEqual(0);
        expect(prediction.probabilities[outcome]).toBeLessThanOrEqual(1);
      }
    }

    expect(result.model.algorithm).toBe('multinomial_logistic_regression');
    expect(result.model.version).toBe(SERVICE_OUTCOME_MODEL_VERSION);
    expect(result.model.trainingSamples).toBe(24);
    expect(result.model.classDistribution).toEqual({
      completed_on_time: 10,
      delayed: 10,
      cancelled: 10,
    });
    expect(result.model.validationStrategy).toBe('temporal_holdout');
    expect(result.model.baselineAccuracy).toBeGreaterThanOrEqual(0);
  });

  it('reporta matriz de confusion y metricas por clase sobre un holdout temporal', () => {
    const model = new ServiceOutcomePredictionModel();
    const result = model.predictMany([], buildRows(10));

    expect(result.model.evaluationTrainingSamples).toBe(24);
    expect(result.model.evaluationTestSamples).toBe(6);
    expect(result.model.accuracy).toBeGreaterThanOrEqual(0.8);
    expect(result.model.macroAverage.f1Score).toBeGreaterThanOrEqual(0);
    expect(result.model.weightedAverage.f1Score).toBeGreaterThanOrEqual(0);
    expect(Date.parse(result.model.trainingPeriod.end)).toBeLessThanOrEqual(
      Date.parse(result.model.testPeriod.start),
    );

    for (const outcome of SERVICE_OUTCOME_CLASSES) {
      const matrixSupport = SERVICE_OUTCOME_CLASSES.reduce(
        (total, predicted) =>
          total + result.model.confusionMatrix[outcome][predicted],
        0,
      );
      const metrics = result.model.metricsByClass[outcome];

      expect(matrixSupport).toBe(2);
      expect(metrics.support).toBe(2);
      expect(metrics.precision).toBeGreaterThanOrEqual(0);
      expect(metrics.precision).toBeLessThanOrEqual(1);
      expect(metrics.recall).toBeGreaterThanOrEqual(0);
      expect(metrics.recall).toBeLessThanOrEqual(1);
      expect(metrics.f1Score).toBeGreaterThanOrEqual(0);
      expect(metrics.f1Score).toBeLessThanOrEqual(1);
    }
  });

  it('genera exactamente el mismo artefacto con los mismos datos y fechas', () => {
    const model = new ServiceOutcomePredictionModel();
    const provenance = {
      datasetSha256: 'sha256-repetible',
      sourceWatermark: '2026-07-21T00:00:00.000Z',
    };

    const first = model.trainArtifact(buildRows(8), provenance);
    const second = model.trainArtifact(buildRows(8), provenance);
    const split = model.createEvaluationSplit(buildRows(8));
    const repeatedSplit = model.createEvaluationSplit(buildRows(8));

    expect(second).toEqual(first);
    expect(repeatedSplit).toEqual(split);
    expect(split.trainingOrderIds).toHaveLength(19);
    expect(split.testOrderIds).toHaveLength(5);
    expect(
      split.trainingOrderIds.filter((id) => split.testOrderIds.includes(id)),
    ).toHaveLength(0);
    expect(first.model.classBalanceStrategy).toBe(
      'inverse_frequency_class_weights',
    );
    expect(first.evaluation.baseline.strategy).toBe('majority_class');
    expect(first.dataset.targetY).toBe('outcome');
    expect(first.dataset.predictorsX).not.toContain('orderId');
    expect(first.dataset.predictorsX).not.toContain('sourceCreatedAt');
    expect(first.model.validationStrategy).toBe('temporal_holdout');
  });

  it('ajusta preprocesamiento y pesos solo con el periodo de train', () => {
    const model = new ServiceOutcomePredictionModel();
    const rows = buildRows(10).map((row) =>
      Date.parse(row.sourceCreatedAt) >= Date.parse('2026-01-09T00:00:00.000Z')
        ? {
            ...row,
            subtotalAmount: 999_999,
            totalAmount: 999_999,
            branchName: 'Sucursal futura solo test',
          }
        : row,
    );

    const artifact = model.trainArtifact(rows, {
      datasetSha256: 'solo-train',
      sourceWatermark: '2026-01-10T12:00:00.000Z',
    });
    const subtotal = artifact.preprocessing.numeric.find(
      (feature) => feature.key === 'subtotalAmount',
    );
    const branches = artifact.preprocessing.categorical.find(
      (feature) => feature.key === 'branchName',
    );

    expect(subtotal?.mean).toBeLessThan(1_000);
    expect(branches?.categories).not.toContain('sucursal futura solo test');
    expect(artifact.dataset.trainingSamples).toBe(24);
    expect(artifact.dataset.evaluationTestSamples).toBe(6);
  });

  it('carga el artefacto JSON usado por el backend y lo conserva en memoria', () => {
    const model = new ServiceOutcomePredictionModel();
    const trainingSpy = jest.spyOn(model, 'trainArtifact');

    const first = model.predictUsingArtifact([
      {
        promisedLeadHours: 24,
        registrationHour: 9,
        registrationWeekday: 2,
        itemCount: 2,
        totalQuantity: 2,
        distinctStudyCount: 2,
        subtotalAmount: 300,
        totalAmount: 300,
        branchName: 'Matriz',
        dominantPriceType: 'normal',
      },
    ]);
    const loadedPath = model.getLoadedArtifactPath();
    const second = model.predictUsingArtifact([{}]);

    expect(first.predictions).toHaveLength(1);
    expect(second.predictions).toHaveLength(1);
    expect(loadedPath).toContain('classification_service_outcome_model.json');
    expect(model.getLoadedArtifactPath()).toBe(loadedPath);
    expect(first.model.artifactDatasetSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(trainingSpy).not.toHaveBeenCalled();
  });

  it('marca el modelo como no disponible cuando falta una clase', () => {
    const model = new ServiceOutcomePredictionModel();
    const rows = buildRows(5).filter((row) => row.outcome !== 'cancelled');

    expect(() => model.predictMany([{}], rows)).toThrow(
      ServiceOutcomeModelUnavailableError,
    );

    try {
      model.predictMany([{}], rows);
      throw new Error('La prueba esperaba un modelo no disponible.');
    } catch (error) {
      expect(error).toBeInstanceOf(ServiceOutcomeModelUnavailableError);
      const unavailable = error as ServiceOutcomeModelUnavailableError;
      expect(unavailable.code).toBe('SERVICE_OUTCOME_MODEL_UNAVAILABLE');
      expect(unavailable.details.minimumSamplesPerClass).toBe(5);
      expect(unavailable.details.classDistribution.cancelled).toBe(0);
    }
  });

  it('imputa datos incompletos y omite variables vacias o sin variacion', () => {
    const model = new ServiceOutcomePredictionModel();
    const rows = buildRows(8).map((row, index) => ({
      ...row,
      branchName: index % 4 === 0 ? undefined : row.branchName,
      subtotalAmount: index % 3 === 0 ? null : row.subtotalAmount,
      maxStudyDurationMinutes: undefined,
      averageStudyDurationMinutes: undefined,
      totalParameterCount: undefined,
      specialProcessingCount: undefined,
      dominantSampleType: undefined,
      dominantAnalysisMethod: undefined,
    }));

    const result = model.predictMany(
      [
        {
          promisedLeadHours: 30,
          branchName: undefined,
          subtotalAmount: null,
        },
        {},
      ],
      rows,
    );

    expect(result.predictions).toHaveLength(2);
    for (const prediction of result.predictions) {
      expect(Number.isFinite(prediction.probability)).toBe(true);
      expect(
        SERVICE_OUTCOME_CLASSES.reduce(
          (total, outcome) => total + prediction.probabilities[outcome],
          0,
        ),
      ).toBeCloseTo(1, 10);
    }

    expect(result.model.featuresUsed).not.toContain('maxStudyDurationMinutes');
    expect(result.model.featuresUsed).not.toContain('totalParameterCount');
    expect(result.model.featuresUsed).not.toContain('dominantSampleType');
    expect(result.warnings).toContain(
      'Las variables vacias, constantes o con al menos 99 % del mismo valor fueron omitidas del modelo.',
    );
  });
});
