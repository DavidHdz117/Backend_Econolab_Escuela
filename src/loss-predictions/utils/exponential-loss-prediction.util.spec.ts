import {
  buildExponentialLossModel,
  predictExponentialLoss,
} from './exponential-loss-prediction.util';

describe('exponential-loss-prediction.util', () => {
  it('ajusta una curva exponencial con todo el historico mensual', () => {
    const baseLoss = 4.8;
    const growthRate = 0.061;
    const history = [
      { period: 0, quantityLoss: baseLoss * Math.exp(growthRate * 0), label: '2025-07', date: '2025-07-01T00:00:00.000Z' },
      { period: 1, quantityLoss: baseLoss * Math.exp(growthRate * 1), label: '2025-08', date: '2025-08-01T00:00:00.000Z' },
      { period: 2, quantityLoss: baseLoss * Math.exp(growthRate * 2), label: '2025-09', date: '2025-09-01T00:00:00.000Z' },
      { period: 3, quantityLoss: baseLoss * Math.exp(growthRate * 3), label: '2025-10', date: '2025-10-01T00:00:00.000Z' },
    ];

    const model = buildExponentialLossModel(history);

    expect(model.basePoint).toEqual(history[0]);
    expect(model.comparisonPoint).toEqual(history[history.length - 1]);
    expect(model.y0).toBeCloseTo(baseLoss, 4);
    expect(model.k).toBeCloseTo(growthRate, 4);
    expect(predictExponentialLoss(model, 4)).toBeCloseTo(
      baseLoss * Math.exp(growthRate * 4),
      4,
    );
  });

  it('con dos periodos consecutivos de 5 y 7 proyecta 9.8 para el siguiente periodo', () => {
    const history = [
      { period: 0, quantityLoss: 5, label: '2025-07', date: '2025-07-01T00:00:00.000Z' },
      { period: 1, quantityLoss: 7, label: '2025-08', date: '2025-08-01T00:00:00.000Z' },
    ];

    const model = buildExponentialLossModel(history);

    expect(model.k).toBeCloseTo(Math.log(7 / 5), 6);
    expect(predictExponentialLoss(model, 2)).toBeCloseTo(9.8, 6);
  });

  it('rechaza historicos con perdidas no positivas', () => {
    expect(() =>
      buildExponentialLossModel([
        { period: 0, quantityLoss: 4.8, label: '2025-07', date: '2025-07-01T00:00:00.000Z' },
        { period: 1, quantityLoss: 0, label: '2025-08', date: '2025-08-01T00:00:00.000Z' },
      ]),
    ).toThrow(
      'Las perdidas historicas deben ser mayores a cero para calcular la prediccion exponencial.',
    );
  });
});
