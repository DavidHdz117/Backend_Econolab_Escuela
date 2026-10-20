import { BadRequestException, Injectable } from '@nestjs/common';
import { DataSource, EntityManager, SelectQueryBuilder } from 'typeorm';
import {
  ServiceOrder,
  ServiceStatus,
} from '../services/entities/service-order.entity';
import { CashCutQueryDto } from './dto/cash-cut-query.dto';

export const CUT_TIME_ZONE = 'America/Mexico_City';
const localDay = `(s."createdAt" AT TIME ZONE 'UTC' AT TIME ZONE '${CUT_TIME_ZONE}')::date`;

export function validateCutPeriod(fromDate: string, toDate: string) {
  const valid = (value: string) =>
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !value.startsWith('0000') &&
    Number.isFinite(Date.parse(`${value}T00:00:00Z`)) &&
    new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
  if (!valid(fromDate) || !valid(toDate))
    throw new BadRequestException(
      'Indica fechas válidas con formato AAAA-MM-DD.',
    );
  if (fromDate > toDate)
    throw new BadRequestException(
      'La fecha inicial debe ser anterior o igual a la final.',
    );
  if ((Date.parse(toDate) - Date.parse(fromDate)) / 86400000 > 365)
    throw new BadRequestException('El periodo máximo es de 366 días.');
}

export function cutMoney(value: unknown): string {
  const text = String(value);
  if (!/^\d+(?:\.\d{1,2})?$/.test(text))
    throw new Error('Importe del corte inválido.');
  const [whole, decimals = ''] = text.split('.');
  return `${whole}.${decimals.padEnd(2, '0')}`;
}

@Injectable()
export class CashCutsService {
  constructor(private readonly dataSource: DataSource) {}

  async getReport(query: CashCutQueryDto) {
    validateCutPeriod(query.fromDate, query.toDate);
    // Todos los totales, días y filas corresponden a la misma instantánea de BD.
    return this.dataSource.transaction('REPEATABLE READ', (manager) =>
      this.readReport(manager, query),
    );
  }

  private base(
    manager: EntityManager,
    query: CashCutQueryDto,
  ): SelectQueryBuilder<ServiceOrder> {
    const qb = manager
      .getRepository(ServiceOrder)
      .createQueryBuilder('s')
      .where('s."isActive" = :active', { active: true })
      // createdAt es timestamp sin zona y se almacena en UTC en el sistema existente.
      // Convertir los límites, en vez de la columna, permite usar su índice.
      .andWhere(
        `s."createdAt" >= ((CAST(:fromDate AS date)::timestamp AT TIME ZONE :zone) AT TIME ZONE 'UTC')`,
        { fromDate: query.fromDate, zone: CUT_TIME_ZONE },
      )
      .andWhere(
        `s."createdAt" < (((CAST(:toDate AS date) + 1)::timestamp AT TIME ZONE :zone) AT TIME ZONE 'UTC')`,
        { toDate: query.toDate },
      );
    if (query.branchName?.trim())
      qb.andWhere('s."branchName" = :branch', {
        branch: query.branchName.trim(),
      });
    return qb.setParameter('cancelled', ServiceStatus.CANCELLED);
  }

  private aggregate(qb: SelectQueryBuilder<ServiceOrder>) {
    return qb
      .select('COUNT(*)::int', 'totalCount')
      .addSelect(
        'COUNT(*) FILTER (WHERE s.status <> :cancelled)::int',
        'serviceCount',
      )
      .addSelect(
        'COUNT(*) FILTER (WHERE s.status = :cancelled)::int',
        'cancelledCount',
      )
      .addSelect(
        'COALESCE(SUM(s."subtotalAmount") FILTER (WHERE s.status <> :cancelled), 0)::text',
        'subtotalAmount',
      )
      .addSelect(
        'COALESCE(SUM(s."discountAmount") FILTER (WHERE s.status <> :cancelled), 0)::text',
        'discountAmount',
      )
      .addSelect(
        'COALESCE(SUM(s."totalAmount") FILTER (WHERE s.status <> :cancelled), 0)::text',
        'totalAmount',
      )
      .addSelect(
        'COALESCE(SUM(s."totalAmount") FILTER (WHERE s.status = :cancelled), 0)::text',
        'cancelledAmount',
      );
  }

  private amounts(row: Record<string, unknown>) {
    return {
      totalCount: Number(row.totalCount),
      serviceCount: Number(row.serviceCount),
      cancelledCount: Number(row.cancelledCount),
      subtotalAmount: cutMoney(row.subtotalAmount),
      discountAmount: cutMoney(row.discountAmount),
      totalAmount: cutMoney(row.totalAmount),
      cancelledAmount: cutMoney(row.cancelledAmount),
    };
  }

  private async readReport(manager: EntityManager, query: CashCutQueryDto) {
    const summary = this.amounts(
      (await this.aggregate(this.base(manager, query)).getRawOne())!,
    );
    const days: Record<string, unknown>[] = await this.aggregate(
      this.base(manager, query),
    )
      .addSelect(`(${localDay})::text`, 'date')
      .groupBy(localDay)
      .orderBy(localDay, 'ASC')
      .getRawMany();
    // Selección explícita: el corte no necesita expedientes, médicos ni resultados.
    const data: Record<string, unknown>[] = await this.base(manager, query)
      .select('s.id', 'id')
      .addSelect('s.folio', 'folio')
      .addSelect('s.status', 'status')
      .addSelect('s."branchName"', 'branchName')
      .addSelect(`(${localDay})::text`, 'date')
      .addSelect('s."subtotalAmount"::text', 'subtotalAmount')
      .addSelect('s."discountAmount"::text', 'discountAmount')
      .addSelect('s."totalAmount"::text', 'totalAmount')
      .orderBy('s."createdAt"', 'DESC')
      .addOrderBy('s.id', 'DESC')
      .offset((query.page - 1) * query.limit)
      .limit(query.limit)
      .getRawMany();
    return {
      period: {
        fromDate: query.fromDate,
        toDate: query.toDate,
        timeZone: CUT_TIME_ZONE,
      },
      accounting: { basis: 'service-registration', paymentsTracked: false },
      summary,
      daily: days.map((row) => ({ date: row.date, ...this.amounts(row) })),
      data: data.map((row) => ({
        id: Number(row.id),
        folio: row.folio,
        date: row.date,
        branchName: row.branchName ?? null,
        status: row.status,
        subtotalAmount: cutMoney(row.subtotalAmount),
        discountAmount: cutMoney(row.discountAmount),
        totalAmount: cutMoney(row.totalAmount),
      })),
      meta: { page: query.page, limit: query.limit, total: summary.totalCount },
    };
  }
}
