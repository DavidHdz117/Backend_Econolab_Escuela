import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, FindOptionsWhere, ILike, In, LessThanOrEqual, MoreThanOrEqual, Repository } from 'typeorm';
import { Study, StudyStatus, StudyType } from 'src/studies/entities/study.entity';
import { CreateLossHistoryDto } from './dto/create-loss-history.dto';
import { PredictLossDto } from './dto/predict-loss.dto';
import { QueryLossHistoryDto } from './dto/query-loss-history.dto';
import { LossHistory } from './entities/loss-history.entity';
import {
  buildExponentialLossModel,
  predictExponentialLoss,
} from './utils/exponential-loss-prediction.util';

type LossRecordResponse = {
  id: number;
  date: string;
  studyId: number;
  studyName: string;
  studyType: StudyType;
  supplyName: string;
  quantityLoss: number;
  notes: string | null;
  createdAt: string;
};

type MonthlyLossPoint = {
  monthKey: string;
  monthDate: Date;
  quantityLoss: number;
  records: number;
};

type LossChartPoint = {
  monthKey: string;
  date: string;
  historicalLoss: number | null;
  predictedLoss: number | null;
  isForecast: boolean;
};

type LogisticsSuggestion = {
  level: 'high' | 'medium' | 'low' | 'unavailable';
  title: string;
  message: string;
  recommendedAction: string | null;
};

type SeedTemplate = {
  supplyName: string;
  baseLoss: number;
  growthRate: number;
};

@Injectable()
export class LossPredictionsService {
  constructor(
    @InjectRepository(LossHistory)
    private readonly lossHistoryRepo: Repository<LossHistory>,
    @InjectRepository(Study)
    private readonly studyRepo: Repository<Study>,
  ) {}

  async listStudies() {
    const studies = await this.studyRepo.find({
      where: {
        isActive: true,
        status: StudyStatus.ACTIVE,
        type: In([StudyType.STUDY, StudyType.PACKAGE]),
      },
      order: { name: 'ASC' },
    });

    return {
      data: studies.map((study) => ({
        id: study.id,
        name: study.name,
        code: study.code,
        type: study.type,
      })),
    };
  }

  async seedSampleHistory() {
    const studies = await this.studyRepo.find({
      where: {
        isActive: true,
        status: StudyStatus.ACTIVE,
        type: In([StudyType.STUDY, StudyType.PACKAGE]),
      },
      order: { id: 'ASC' },
      take: 4,
    });

    if (studies.length === 0) {
      throw new NotFoundException(
        'No hay servicios o paquetes activos para generar historial de perdidas.',
      );
    }

    const templates: SeedTemplate[] = [
      { supplyName: 'Guantes de nitrilo', baseLoss: 4.8, growthRate: 0.061 },
      { supplyName: 'Tubo vacutainer', baseLoss: 3.2, growthRate: 0.054 },
      { supplyName: 'Reactivo de control', baseLoss: 2.4, growthRate: 0.048 },
    ];

    const startMonth = new Date(Date.UTC(2025, 6, 1));
    const periods = 8;
    const entities: LossHistory[] = [];
    let skipped = 0;

    for (const study of studies) {
      for (const template of templates) {
        for (let period = 0; period < periods; period += 1) {
          const occurredAt = this.addMonths(startMonth, period);
          const existing = await this.lossHistoryRepo.findOne({
            where: {
              studyId: study.id,
              supplyName: template.supplyName,
              occurredAt,
            },
          });

          if (existing) {
            skipped += 1;
            continue;
          }

          const quantityLoss = this.roundValue(
            template.baseLoss * Math.exp(template.growthRate * period),
          );

          entities.push(
            this.lossHistoryRepo.create({
              occurredAt,
              studyId: study.id,
              studyNameSnapshot: study.name,
              studyTypeSnapshot: study.type,
              supplyName: template.supplyName,
              quantityLoss,
              notes: `Registro de referencia ${study.code}-${template.supplyName}-${period + 1}`,
            }),
          );
        }
      }
    }

    if (entities.length > 0) {
      await this.lossHistoryRepo.save(entities);
    }

    return {
      message:
        entities.length > 0
          ? 'Historico de perdidas cargado correctamente.'
          : 'No se insertaron registros nuevos porque el historico ya existia.',
      data: {
        studiesUsed: studies.map((study) => ({
          id: study.id,
          name: study.name,
          code: study.code,
          type: study.type,
        })),
        templatesUsed: templates.map((template) => template.supplyName),
        periodsGenerated: periods,
        inserted: entities.length,
        skipped,
      },
    };
  }

  async listSupplies(studyId?: number) {
    const qb = this.lossHistoryRepo
      .createQueryBuilder('loss')
      .select('DISTINCT loss.supplyName', 'supplyName')
      .orderBy('loss.supplyName', 'ASC');

    if (studyId) {
      await this.assertPredictableStudy(studyId);
      qb.where('loss.studyId = :studyId', { studyId });
    }

    const rows = await qb.getRawMany<{ supplyName: string }>();

    return {
      data: rows
        .map((row) => row.supplyName?.trim())
        .filter((value): value is string => Boolean(value)),
    };
  }

  async createHistory(dto: CreateLossHistoryDto) {
    const study = await this.assertPredictableStudy(dto.studyId);
    const occurredAt = this.parseInputDate(dto.date);
    const supplyName = this.normalizeSupplyName(dto.supplyName);

    const entity = this.lossHistoryRepo.create({
      occurredAt,
      studyId: study.id,
      studyNameSnapshot: study.name,
      studyTypeSnapshot: study.type,
      supplyName,
      quantityLoss: this.roundValue(dto.quantityLoss),
      notes: dto.notes?.trim() || null,
    });

    const saved = await this.lossHistoryRepo.save(entity);

    return {
      message: 'Perdida registrada correctamente.',
      data: this.toLossRecord(saved),
    };
  }

  async listHistory(query: QueryLossHistoryDto) {
    this.assertValidDateRange(query.fromDate, query.toDate);

    const records = await this.lossHistoryRepo.find({
      where: this.buildHistoryWhere(query),
      order: { occurredAt: 'DESC', id: 'DESC' },
    });

    const data = records.map((record) => this.toLossRecord(record));
    const totalQuantityLoss = this.roundValue(
      data.reduce((total, record) => total + record.quantityLoss, 0),
    );

    return {
      data,
      meta: {
        total: data.length,
        totalQuantityLoss,
      },
    };
  }

  async predict(query: PredictLossDto) {
    this.assertValidDateRange(query.fromDate, query.toDate);
    const study = await this.assertPredictableStudy(query.studyId);
    const supplyName = this.normalizeSupplyName(query.supplyName);
    const monthsAhead = query.monthsAhead ?? 6;

    const records = await this.lossHistoryRepo.find({
      where: this.buildHistoryWhere({
        studyId: study.id,
        supplyName,
        fromDate: query.fromDate,
        toDate: query.toDate,
      }),
      order: { occurredAt: 'ASC', id: 'ASC' },
    });

    const monthlyHistory = this.aggregateMonthlyLosses(records);
    const totalHistoricalLoss = this.roundValue(
      monthlyHistory.reduce((total, point) => total + point.quantityLoss, 0),
    );
    const mappedRecords = records.map((record) => this.toLossRecord(record));

    if (monthlyHistory.length < 2) {
      return {
        filters: {
          studyId: study.id,
          studyName: study.name,
          studyType: study.type,
          supplyName,
          monthsAhead,
          fromDate: query.fromDate ?? null,
          toDate: query.toDate ?? null,
        },
        historicalRecords: mappedRecords,
        chartSeries: monthlyHistory.map((point) => ({
          monthKey: point.monthKey,
          date: point.monthDate.toISOString(),
          historicalLoss: point.quantityLoss,
          predictedLoss: null,
          isForecast: false,
        })),
        model: {
          hasEnoughData: false,
          reason:
            'Se requieren al menos 2 periodos con perdidas registradas para calcular la prediccion.',
          p0: monthlyHistory[0]?.quantityLoss ?? null,
          y0: monthlyHistory[0]?.quantityLoss ?? null,
          r: null,
          k: null,
          dataPointsUsed: monthlyHistory.length,
          monthsAhead,
          basePoint: null,
          comparisonPoint: null,
        },
        summary: {
          totalHistoricalLoss,
          averageMonthlyLoss:
            monthlyHistory.length > 0
              ? this.roundValue(totalHistoricalLoss / monthlyHistory.length)
              : null,
          lastRecordedLoss:
            monthlyHistory.length > 0
              ? monthlyHistory[monthlyHistory.length - 1].quantityLoss
              : null,
          monthsWithHistory: monthlyHistory.length,
          recordsCount: mappedRecords.length,
          nextMonthPrediction: null,
          nextMonthLabel: null,
        },
        logisticsSuggestion: {
          level: 'unavailable',
          title: 'Sin recomendacion disponible',
          message:
            'Necesitas al menos dos periodos historicos para estimar la perdida del siguiente mes.',
          recommendedAction: null,
        },
      };
    }

    const firstPoint = monthlyHistory[0];
    const normalizedHistory = monthlyHistory.map((point) => ({
      period: this.diffInMonths(firstPoint.monthDate, point.monthDate),
      quantityLoss: point.quantityLoss,
      label: point.monthKey,
      date: point.monthDate.toISOString(),
    }));

    let model;
    try {
      model = buildExponentialLossModel(normalizedHistory);
    } catch (error) {
      if (!(error instanceof BadRequestException)) {
        throw error;
      }

      return {
        filters: {
          studyId: study.id,
          studyName: study.name,
          studyType: study.type,
          supplyName,
          monthsAhead,
          fromDate: query.fromDate ?? null,
          toDate: query.toDate ?? null,
        },
        historicalRecords: mappedRecords,
        chartSeries: monthlyHistory.map((point) => ({
          monthKey: point.monthKey,
          date: point.monthDate.toISOString(),
          historicalLoss: point.quantityLoss,
          predictedLoss: null,
          isForecast: false,
        })),
        model: {
          hasEnoughData: false,
          reason:
            error.message ||
            'No fue posible calcular la tasa exponencial con los datos historicos.',
          p0: firstPoint.quantityLoss,
          y0: firstPoint.quantityLoss,
          r: null,
          k: null,
          dataPointsUsed: monthlyHistory.length,
          monthsAhead,
          basePoint: null,
          comparisonPoint: null,
        },
        summary: {
          totalHistoricalLoss,
          averageMonthlyLoss: this.roundValue(
            totalHistoricalLoss / monthlyHistory.length,
          ),
          lastRecordedLoss:
            monthlyHistory[monthlyHistory.length - 1]?.quantityLoss ?? null,
          monthsWithHistory: monthlyHistory.length,
          recordsCount: mappedRecords.length,
          nextMonthPrediction: null,
          nextMonthLabel: null,
        },
        logisticsSuggestion: {
          level: 'unavailable',
          title: 'Sin recomendacion disponible',
          message:
            'No fue posible calcular una recomendacion porque la tasa exponencial no es valida con el historico actual.',
          recommendedAction: null,
        },
      };
    }

    const p0 = model.y0;
    const r = model.k;
    const lastHistoricalPoint = monthlyHistory[monthlyHistory.length - 1];
    const totalHistoricalMonths = this.diffInMonths(
      firstPoint.monthDate,
      lastHistoricalPoint.monthDate,
    );
    const chartSeries: LossChartPoint[] = [];
    const nextForecastOffset = totalHistoricalMonths + 1;

    for (let offset = 0; offset <= totalHistoricalMonths; offset += 1) {
      const currentMonth = this.addMonths(firstPoint.monthDate, offset);
      const monthKey = this.formatMonthKey(currentMonth);
      const historicalPoint = monthlyHistory.find(
        (point) => point.monthKey === monthKey,
      );

      chartSeries.push({
        monthKey,
        date: currentMonth.toISOString(),
        historicalLoss: historicalPoint?.quantityLoss ?? null,
        predictedLoss: this.roundValue(
          predictExponentialLoss(model, offset),
        ),
        isForecast: false,
      });
    }

    const nextForecastMonth = this.addMonths(firstPoint.monthDate, nextForecastOffset);
    const nextMonthPrediction = this.roundValue(
      predictExponentialLoss(model, nextForecastOffset),
    );
    chartSeries.push({
      monthKey: this.formatMonthKey(nextForecastMonth),
      date: nextForecastMonth.toISOString(),
      historicalLoss: null,
      predictedLoss: nextMonthPrediction,
      isForecast: true,
    });

    const logisticsSuggestion = this.buildLogisticsSuggestion({
      nextMonthPrediction,
      lastRecordedLoss: lastHistoricalPoint.quantityLoss,
      averageMonthlyLoss: this.roundValue(
        totalHistoricalLoss / monthlyHistory.length,
      ),
      supplyName,
    });

    return {
      filters: {
        studyId: study.id,
        studyName: study.name,
        studyType: study.type,
        supplyName,
        monthsAhead,
        fromDate: query.fromDate ?? null,
        toDate: query.toDate ?? null,
      },
      historicalRecords: mappedRecords,
      chartSeries,
      model: {
        hasEnoughData: true,
        reason: null,
        p0: this.roundValue(p0),
        y0: this.roundValue(p0),
        r: Number(r.toFixed(6)),
        k: Number(r.toFixed(6)),
        dataPointsUsed: monthlyHistory.length,
        monthsAhead,
        basePoint: {
          ...model.basePoint,
          quantityLoss: this.roundValue(model.basePoint.quantityLoss),
        },
        comparisonPoint: {
          ...model.comparisonPoint,
          quantityLoss: this.roundValue(model.comparisonPoint.quantityLoss),
        },
      },
      summary: {
        totalHistoricalLoss,
        averageMonthlyLoss: this.roundValue(
          totalHistoricalLoss / monthlyHistory.length,
        ),
        lastRecordedLoss: lastHistoricalPoint.quantityLoss,
        monthsWithHistory: monthlyHistory.length,
        recordsCount: mappedRecords.length,
        nextMonthPrediction,
        nextMonthLabel: this.formatMonthKey(nextForecastMonth),
      },
      logisticsSuggestion,
    };
  }

  private async assertPredictableStudy(studyId: number) {
    const study = await this.studyRepo.findOne({
      where: { id: studyId, isActive: true },
    });

    if (!study) {
      throw new NotFoundException('Servicio o paquete no encontrado.');
    }

    if (![StudyType.STUDY, StudyType.PACKAGE].includes(study.type)) {
      throw new BadRequestException(
        'Solo se pueden registrar perdidas para servicios o paquetes.',
      );
    }

    return study;
  }

  private buildHistoryWhere(query: QueryLossHistoryDto): FindOptionsWhere<LossHistory> {
    const where: FindOptionsWhere<LossHistory> = {};

    if (query.studyId) {
      where.studyId = query.studyId;
    }

    if (query.supplyName?.trim()) {
      where.supplyName = ILike(query.supplyName.trim());
    }

    if (query.fromDate && query.toDate) {
      where.occurredAt = Between(
        this.startOfDay(query.fromDate),
        this.endOfDay(query.toDate),
      );
    } else if (query.fromDate) {
      where.occurredAt = MoreThanOrEqual(this.startOfDay(query.fromDate));
    } else if (query.toDate) {
      where.occurredAt = LessThanOrEqual(this.endOfDay(query.toDate));
    }

    return where;
  }

  private toLossRecord(record: LossHistory): LossRecordResponse {
    return {
      id: record.id,
      date: record.occurredAt.toISOString(),
      studyId: record.studyId,
      studyName: record.studyNameSnapshot,
      studyType: record.studyTypeSnapshot,
      supplyName: record.supplyName,
      quantityLoss: this.roundValue(record.quantityLoss),
      notes: record.notes ?? null,
      createdAt: record.createdAt.toISOString(),
    };
  }

  private aggregateMonthlyLosses(records: LossHistory[]) {
    const monthlyMap = new Map<string, MonthlyLossPoint>();

    for (const record of records) {
      const monthDate = new Date(
        Date.UTC(
          record.occurredAt.getUTCFullYear(),
          record.occurredAt.getUTCMonth(),
          1,
        ),
      );
      const monthKey = this.formatMonthKey(monthDate);
      const existing = monthlyMap.get(monthKey);

      if (existing) {
        existing.quantityLoss = this.roundValue(
          existing.quantityLoss + record.quantityLoss,
        );
        existing.records += 1;
        continue;
      }

      monthlyMap.set(monthKey, {
        monthKey,
        monthDate,
        quantityLoss: this.roundValue(record.quantityLoss),
        records: 1,
      });
    }

    return Array.from(monthlyMap.values()).sort((a, b) =>
      a.monthDate.getTime() - b.monthDate.getTime(),
    );
  }

  private normalizeSupplyName(value: string) {
    return value.trim().replace(/\s+/g, ' ');
  }

  private parseInputDate(value: string) {
    const parsed = new Date(`${value}T00:00:00.000Z`);
    if (Number.isNaN(parsed.getTime())) {
      throw new BadRequestException('La fecha de perdida es invalida.');
    }
    return parsed;
  }

  private startOfDay(value: string) {
    return new Date(`${value}T00:00:00.000Z`);
  }

  private endOfDay(value: string) {
    return new Date(`${value}T23:59:59.999Z`);
  }

  private assertValidDateRange(fromDate?: string, toDate?: string) {
    if (!fromDate || !toDate) {
      return;
    }

    if (this.startOfDay(fromDate).getTime() > this.endOfDay(toDate).getTime()) {
      throw new BadRequestException(
        'fromDate no puede ser mayor que toDate.',
      );
    }
  }

  private diffInMonths(start: Date, end: Date) {
    return (
      (end.getUTCFullYear() - start.getUTCFullYear()) * 12 +
      (end.getUTCMonth() - start.getUTCMonth())
    );
  }

  private addMonths(date: Date, months: number) {
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1));
  }

  private formatMonthKey(date: Date) {
    const month = `${date.getUTCMonth() + 1}`.padStart(2, '0');
    return `${date.getUTCFullYear()}-${month}`;
  }

  private roundValue(value: number) {
    return Number(value.toFixed(4));
  }

  private buildLogisticsSuggestion(input: {
    nextMonthPrediction: number;
    lastRecordedLoss: number;
    averageMonthlyLoss: number;
    supplyName: string;
  }): LogisticsSuggestion {
    const { nextMonthPrediction, lastRecordedLoss, averageMonthlyLoss, supplyName } =
      input;

    if (nextMonthPrediction >= averageMonthlyLoss * 1.2) {
      return {
        level: 'high',
        title: 'Incrementa el stock preventivo',
        message: `La perdida estimada de ${supplyName} para el siguiente mes supera claramente el promedio reciente. Conviene reforzar existencias y revisar consumo operativo antes de que falte inventario.`,
        recommendedAction:
          'Compra mas inventario de seguridad y programa una reposicion anticipada.',
      };
    }

    if (nextMonthPrediction <= averageMonthlyLoss * 0.85) {
      return {
        level: 'low',
        title: 'Reduce compras y rota inventario actual',
        message: `La perdida estimada de ${supplyName} para el siguiente mes cae por debajo del promedio reciente. Puedes operar con una compra mas conservadora para evitar sobrestock.`,
        recommendedAction:
          'Compra menos que el promedio reciente y prioriza salida del inventario actual.',
      };
    }

    if (nextMonthPrediction > lastRecordedLoss) {
      return {
        level: 'medium',
        title: 'Manten una reposicion moderadamente mayor',
        message: `La perdida proyectada de ${supplyName} para el siguiente mes viene ligeramente arriba del ultimo registro. Vale la pena ajustar el pedido con un margen moderado.`,
        recommendedAction:
          'Compra un poco mas que el ultimo periodo y vigila el comportamiento semanal.',
      };
    }

    return {
      level: 'medium',
      title: 'Manten compras estables',
      message: `La perdida proyectada de ${supplyName} para el siguiente mes se mantiene cerca del comportamiento reciente. No se observa una señal fuerte de alza o baja.`,
      recommendedAction:
        'Compra en un rango similar al promedio reciente y monitorea desviaciones.',
    };
  }
}
