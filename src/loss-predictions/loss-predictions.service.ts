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
            'Se requieren al menos 2 meses con perdidas registradas para calcular la prediccion.',
          p0: monthlyHistory[0]?.quantityLoss ?? null,
          r: null,
          dataPointsUsed: monthlyHistory.length,
          monthsAhead,
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
        },
      };
    }

    const firstPoint = monthlyHistory[0];
    const p0 = firstPoint.quantityLoss;

    if (p0 <= 0) {
      throw new BadRequestException(
        'La primera perdida registrada debe ser mayor a cero para aplicar el modelo exponencial.',
      );
    }

    let numerator = 0;
    let denominator = 0;

    for (const point of monthlyHistory.slice(1)) {
      if (point.quantityLoss <= 0) {
        throw new BadRequestException(
          'Todas las perdidas historicas deben ser mayores a cero para calcular la prediccion exponencial.',
        );
      }

      const monthOffset = this.diffInMonths(firstPoint.monthDate, point.monthDate);
      if (monthOffset <= 0) {
        continue;
      }

      const transformed = Math.log(point.quantityLoss / p0);
      numerator += monthOffset * transformed;
      denominator += monthOffset * monthOffset;
    }

    if (denominator === 0) {
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
            'No hay suficiente variacion temporal entre los datos historicos para calcular la tasa.',
          p0,
          r: null,
          dataPointsUsed: monthlyHistory.length,
          monthsAhead,
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
        },
      };
    }

    const r = numerator / denominator;
    const lastHistoricalPoint = monthlyHistory[monthlyHistory.length - 1];
    const totalHistoricalMonths = this.diffInMonths(
      firstPoint.monthDate,
      lastHistoricalPoint.monthDate,
    );
    const chartSeries: LossChartPoint[] = [];

    for (let offset = 0; offset <= totalHistoricalMonths + monthsAhead; offset += 1) {
      const currentMonth = this.addMonths(firstPoint.monthDate, offset);
      const monthKey = this.formatMonthKey(currentMonth);
      const historicalPoint = monthlyHistory.find(
        (point) => point.monthKey === monthKey,
      );

      chartSeries.push({
        monthKey,
        date: currentMonth.toISOString(),
        historicalLoss: historicalPoint?.quantityLoss ?? null,
        predictedLoss: this.roundValue(p0 * Math.exp(r * offset)),
        isForecast: offset > totalHistoricalMonths,
      });
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
      chartSeries,
      model: {
        hasEnoughData: true,
        reason: null,
        p0: this.roundValue(p0),
        r: Number(r.toFixed(6)),
        dataPointsUsed: monthlyHistory.length,
        monthsAhead,
      },
      summary: {
        totalHistoricalLoss,
        averageMonthlyLoss: this.roundValue(
          totalHistoricalLoss / monthlyHistory.length,
        ),
        lastRecordedLoss: lastHistoricalPoint.quantityLoss,
        monthsWithHistory: monthlyHistory.length,
        recordsCount: mappedRecords.length,
      },
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
}
