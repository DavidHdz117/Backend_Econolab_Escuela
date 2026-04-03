import { BadRequestException } from '@nestjs/common';

export type HistoricalLossPoint = {
  period: number;
  quantityLoss: number;
  label: string;
  date: string;
};

export type ExponentialLossModel = {
  y0: number;
  k: number;
  basePoint: HistoricalLossPoint;
  comparisonPoint: HistoricalLossPoint;
};

export function buildExponentialLossModel(
  history: HistoricalLossPoint[],
): ExponentialLossModel {
  if (history.length < 2) {
    throw new BadRequestException(
      'Se requieren al menos 2 periodos con perdidas registradas para calcular la prediccion exponencial.',
    );
  }

  const basePoint = history[0];
  const comparisonPoint = history[history.length - 1];

  if (history.some((point) => point.quantityLoss == null)) {
    throw new BadRequestException(
      'Los periodos historicos deben incluir la cantidad de perdida.',
    );
  }

  if (history.some((point) => point.quantityLoss <= 0)) {
    throw new BadRequestException(
      'Las perdidas historicas deben ser mayores a cero para calcular la prediccion exponencial.',
    );
  }

  const logPoints = history.map((point) => ({
    period: point.period,
    logQuantityLoss: Math.log(point.quantityLoss),
  }));
  const meanPeriod =
    logPoints.reduce((total, point) => total + point.period, 0) / logPoints.length;
  const meanLogQuantityLoss =
    logPoints.reduce((total, point) => total + point.logQuantityLoss, 0) /
    logPoints.length;

  const numerator = logPoints.reduce(
    (total, point) =>
      total + (point.period - meanPeriod) * (point.logQuantityLoss - meanLogQuantityLoss),
    0,
  );
  const denominator = logPoints.reduce(
    (total, point) => total + (point.period - meanPeriod) ** 2,
    0,
  );

  if (denominator === 0) {
    throw new BadRequestException(
      'No se puede calcular la tasa exponencial cuando todos los puntos pertenecen al mismo periodo.',
    );
  }

  const k = numerator / denominator;
  const intercept = meanLogQuantityLoss - k * meanPeriod;
  const y0 = Math.exp(intercept + k * basePoint.period);

  if (!Number.isFinite(k) || !Number.isFinite(y0) || y0 <= 0) {
    throw new BadRequestException(
      'No fue posible calcular una tasa exponencial valida con los datos historicos proporcionados.',
    );
  }

  return {
    y0,
    k,
    basePoint,
    comparisonPoint,
  };
}

export function predictExponentialLoss(
  model: ExponentialLossModel,
  period: number,
) {
  const offset = period - model.basePoint.period;
  return model.y0 * Math.exp(model.k * offset);
}
