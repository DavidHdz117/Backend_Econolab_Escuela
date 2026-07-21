import {
  SERVICE_OUTCOME_CLASSES,
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
    expect(result.model.version).toBe('1.0');
    expect(result.model.trainingSamples).toBe(30);
    expect(result.model.classDistribution).toEqual({
      completed_on_time: 10,
      delayed: 10,
      cancelled: 10,
    });
  });

  it('reporta matriz de confusion y metricas por clase sobre un split estratificado', () => {
    const model = new ServiceOutcomePredictionModel();
    const result = model.predictMany([], buildRows(10));

    expect(result.model.evaluationTrainingSamples).toBe(24);
    expect(result.model.evaluationTestSamples).toBe(6);
    expect(result.model.accuracy).toBeGreaterThanOrEqual(0.8);

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
      'Las variables vacias o sin variacion fueron omitidas del modelo.',
    );
  });
});
