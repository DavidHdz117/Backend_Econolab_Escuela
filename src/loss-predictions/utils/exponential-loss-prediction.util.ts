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

  const [basePoint, comparisonPoint] = history;

  if (basePoint.quantityLoss == null || comparisonPoint.quantityLoss == null) {
    throw new BadRequestException(
      'Los periodos historicos deben incluir la cantidad de perdida.',
    );
  }

  if (basePoint.quantityLoss <= 0 || comparisonPoint.quantityLoss <= 0) {
    throw new BadRequestException(
      'Las perdidas historicas deben ser mayores a cero para calcular la prediccion exponencial.',
    );
  }

  const periodDelta = comparisonPoint.period - basePoint.period;
  if (periodDelta === 0) {
    throw new BadRequestException(
      'No se puede calcular la tasa exponencial cuando ambos puntos pertenecen al mismo periodo.',
    );
  }

  const k = Math.log(comparisonPoint.quantityLoss / basePoint.quantityLoss) / periodDelta;

  if (!Number.isFinite(k)) {
    throw new BadRequestException(
      'No fue posible calcular una tasa exponencial valida con los datos historicos proporcionados.',
    );
  }

  return {
    y0: basePoint.quantityLoss,
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
