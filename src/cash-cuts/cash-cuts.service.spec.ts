import { BadRequestException } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import {
  CashCutsService,
  cutMoney,
  validateCutPeriod,
} from './cash-cuts.service';
import { CashCutQueryDto } from './dto/cash-cut-query.dto';

const totals = {
  totalCount: 3,
  serviceCount: 2,
  cancelledCount: 1,
  subtotalAmount: '300.10',
  discountAmount: '10.00',
  totalAmount: '290.10',
  cancelledAmount: '50.00',
};

describe('Cortes con importes reales, sin duplicar órdenes por sus estudios', () => {
  it.each([
    '2026-02-29',
    '2026-04-31',
    '2026-1-02',
    'invalid',
    '',
    '0000-01-01',
  ])(
    'rechaza la fecha inexistente o mal formada %s antes de consultar SQL',
    (date) => {
      expect(() => validateCutPeriod(date, date)).toThrow(BadRequestException);
    },
  );
  it('acepta un día y los 366 días de un año bisiesto, sin admitir rangos invertidos o excesivos', () => {
    expect(() => validateCutPeriod('2024-02-29', '2024-02-29')).not.toThrow();
    expect(() => validateCutPeriod('2024-01-01', '2024-12-31')).not.toThrow();
    expect(() => validateCutPeriod('2026-10-21', '2026-10-20')).toThrow(
      BadRequestException,
    );
    expect(() => validateCutPeriod('2024-01-01', '2025-01-01')).toThrow(
      BadRequestException,
    );
  });
  it('preserva los centavos como decimales exactos, incluso en importes grandes', () => {
    expect(cutMoney('90071992547409.91')).toBe('90071992547409.91');
    expect(cutMoney('0')).toBe('0.00');
    expect(cutMoney('0.1')).toBe('0.10');
    for (const value of [null, undefined, '', '-1.00', '1.234', 'NaN'])
      expect(() => cutMoney(value)).toThrow();
  });

  function setup() {
    const builders: Record<string, jest.Mock>[] = [];
    const results = [
      totals,
      [{ ...totals, date: '2026-10-20' }],
      [
        {
          id: 7,
          folio: 'ECO-7',
          date: '2026-10-20',
          branchName: 'Centro',
          status: 'completed',
          subtotalAmount: '20.10',
          discountAmount: '0.00',
          totalAmount: '20.10',
          patient: 'private',
          notes: 'private',
        },
      ],
    ];
    const createQueryBuilder = jest.fn(() => {
      const row: Record<string, jest.Mock> = {};
      for (const method of [
        'where',
        'andWhere',
        'select',
        'addSelect',
        'setParameter',
        'groupBy',
        'orderBy',
        'addOrderBy',
        'offset',
        'limit',
      ])
        row[method] = jest.fn(() => row);
      const result = results[builders.length];
      row.getRawOne = jest.fn().mockResolvedValue(result);
      row.getRawMany = jest.fn().mockResolvedValue(result);
      builders.push(row);
      return row;
    });
    const manager = { getRepository: jest.fn(() => ({ createQueryBuilder })) };
    const transaction = jest.fn(
      (_isolation: string, fn: (manager: EntityManager) => unknown) =>
        fn(manager as unknown as EntityManager),
    );
    return {
      builders,
      transaction,
      service: new CashCutsService({ transaction } as unknown as DataSource),
    };
  }

  it('calcula el resumen de todo el periodo antes de paginar, usando una única instantánea', async () => {
    const { service, transaction, builders } = setup();
    const report = await service.getReport({
      fromDate: '2026-10-20',
      toDate: '2026-10-20',
      page: 2,
      limit: 20,
      branchName: ' Centro ',
    });
    expect(transaction).toHaveBeenCalledWith(
      'REPEATABLE READ',
      expect.any(Function),
    );
    expect(report.summary).toEqual(totals);
    expect(report.meta).toEqual({ page: 2, limit: 20, total: 3 });
    expect(builders[0].offset).not.toHaveBeenCalled();
    expect(builders[2].offset).toHaveBeenCalledWith(20);
    expect(builders[2].limit).toHaveBeenCalledWith(20);
    for (const qb of builders) {
      expect(qb.where).toHaveBeenCalledWith('s."isActive" = :active', {
        active: true,
      });
      expect(qb.andWhere).toHaveBeenCalledWith(
        expect.stringContaining('>= '),
        expect.objectContaining({
          fromDate: '2026-10-20',
          zone: 'America/Mexico_City',
        }),
      );
      expect(qb.andWhere).toHaveBeenCalledWith(expect.stringContaining('< '), {
        toDate: '2026-10-20',
      });
      expect(qb.andWhere).toHaveBeenCalledWith('s."branchName" = :branch', {
        branch: 'Centro',
      });
      expect(qb.setParameter).toHaveBeenCalledWith('cancelled', 'cancelled');
    }
    expect(builders[0].addSelect).toHaveBeenCalledWith(
      expect.stringContaining('FILTER (WHERE s.status <> :cancelled)'),
      'totalAmount',
    );
    expect(Object.keys(report.data[0]).sort()).toEqual(
      [
        'branchName',
        'date',
        'discountAmount',
        'folio',
        'id',
        'status',
        'subtotalAmount',
        'totalAmount',
      ].sort(),
    );
    expect(report.accounting).toEqual({
      basis: 'service-registration',
      paymentsTracked: false,
    });
  });

  it('no abre transacción si el periodo es inválido', async () => {
    const { service, transaction } = setup();
    await expect(
      service.getReport({
        fromDate: '2026-02-30',
        toDate: '2026-03-01',
      } as CashCutQueryDto),
    ).rejects.toThrow(BadRequestException);
    expect(transaction).not.toHaveBeenCalled();
  });
});
