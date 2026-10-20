import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import type { ExecutionContext } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { CashCutsController } from '../cash-cuts.controller';
import { CashCutQueryDto } from './cash-cut-query.dto';

const valid = { fromDate: '2026-10-20', toDate: '2026-10-20' };
const errors = (value: unknown) =>
  validate(plainToInstance(CashCutQueryDto, value), {
    whitelist: true,
    forbidNonWhitelisted: true,
  });

describe('Contrato y permisos de cortes', () => {
  it('aplica paginación por defecto y convierte los query params numéricos', async () => {
    const query = plainToInstance(CashCutQueryDto, valid);
    expect(query.page).toBe(1);
    expect(query.limit).toBe(20);
    expect(await errors({ ...valid, page: '2', limit: '20' })).toHaveLength(0);
  });
  it.each([
    { page: 0 },
    { page: 1.2 },
    { limit: 101 },
    { limit: 0 },
    { page: 'NaN' },
    { branchName: 'x'.repeat(151) },
    { rol: 'admin' },
    { fromDate: '2026-10-20T00:00:00Z' },
  ])('rechaza consultas inválidas o campos extra %p', async (invalid) => {
    expect((await errors({ ...valid, ...invalid })).length).toBeGreaterThan(0);
  });
  it('no admite fechas ausentes', async () => {
    expect((await errors({})).length).toBeGreaterThan(0);
  });
  it('exige JWT y rol de administrador, también en el backend', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, CashCutsController)).toEqual([
      JwtAuthGuard,
      RolesGuard,
    ]);
    const guard = new RolesGuard(new Reflector());
    const handler = Reflect.get(
      CashCutsController.prototype,
      'getReport',
    ) as () => unknown;
    const context = (rol?: string) =>
      ({
        getHandler: () => handler,
        getClass: () => CashCutsController,
        switchToHttp: () => ({
          getRequest: () => ({ user: rol ? { rol } : undefined }),
        }),
      }) as unknown as ExecutionContext;
    expect(guard.canActivate(context('admin'))).toBe(true);
    expect(() => guard.canActivate(context('recepcionista'))).toThrow();
    expect(() => guard.canActivate(context())).toThrow();
  });
});
