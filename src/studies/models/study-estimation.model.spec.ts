import { StudyType } from '../entities/study.entity';
import { StudyEstimationModel } from './study-estimation.model';

describe('StudyEstimationModel', () => {
  it('estima un precio usando el dataset recibido', () => {
    const model = new StudyEstimationModel();
    const rows = [
      {
        type: StudyType.STUDY,
        parameterCount: 2,
        method: 'ELISA',
        normalPrice: 160,
      },
      {
        type: StudyType.STUDY,
        parameterCount: 5,
        method: 'ELISA',
        normalPrice: 260,
      },
      {
        type: StudyType.STUDY,
        parameterCount: 10,
        method: 'Quimica seca',
        normalPrice: 430,
      },
      {
        type: StudyType.OTHER,
        parameterCount: 8,
        method: undefined,
        normalPrice: 390,
      },
      {
        type: StudyType.PACKAGE,
        parameterCount: 18,
        method: undefined,
        normalPrice: 850,
      },
    ];

    const result = model.predict(
      { type: StudyType.STUDY, parameterCount: 7, method: 'ELISA' },
      rows,
    );

    expect(result.suggestedNormalPrice).toBeGreaterThan(0);
    expect(result.model.trainingSamples).toBe(rows.length);
    expect(result.model.algorithm).toBe('linear_regression');
    expect(result.model.featuresUsed).toContain('numero_parametros');
  });

  it('ignora numero de parametros cuando el catalogo no tiene datos suficientes', () => {
    const model = new StudyEstimationModel();
    const rows = [
      {
        type: StudyType.STUDY,
        parameterCount: 0,
        method: 'ELISA',
        normalPrice: 150,
      },
      {
        type: StudyType.STUDY,
        parameterCount: 0,
        method: 'ELISA',
        normalPrice: 190,
      },
      {
        type: StudyType.STUDY,
        parameterCount: 3,
        method: 'ELISA',
        normalPrice: 230,
      },
    ];

    const withoutParameters = model.predict(
      { type: StudyType.STUDY, parameterCount: 0, method: 'ELISA' },
      rows,
    );
    const withParameters = model.predict(
      { type: StudyType.STUDY, parameterCount: 20, method: 'ELISA' },
      rows,
    );

    expect(withParameters.suggestedNormalPrice).toBe(
      withoutParameters.suggestedNormalPrice,
    );
    expect(withParameters.model.featuresUsed).not.toContain(
      'numero_parametros',
    );
    expect(withParameters.warnings[0]).toContain('5 estudios');
  });
});
