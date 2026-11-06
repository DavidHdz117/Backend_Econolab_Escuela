import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import {
  initialWorkspace,
  SCHOOL_NOTICE_VERSION,
  summarize,
  validDate,
  Workspace,
} from './domain';
import { SchoolService } from './school.service';
import { SchoolController } from './school.controller';
import { schoolNotice, schoolPage } from './school-notice';

function fixture() {
  const rows = new Map<string, Workspace>();
  const query = jest.fn((sql: string, parameters: unknown[] = []) => {
    const id = String(parameters[0]);
    if (sql.startsWith('INSERT') && !rows.has(id))
      rows.set(id, JSON.parse(String(parameters[1])) as Workspace);
    if (sql.startsWith('SELECT'))
      return [{ state: structuredClone(rows.get(id)) }];
    if (sql.startsWith('UPDATE'))
      rows.set(id, JSON.parse(String(parameters[1])) as Workspace);
    return [];
  });
  const db = {
    query,
    transaction: async (
      operation: (manager: { query: typeof query }) => Promise<unknown>,
    ) => operation({ query }),
  };
  return { service: new SchoolService(db as unknown as DataSource), query };
}

describe('Espacio de práctica administrativa', () => {
  it('comienza con ejemplos genéricos, sin actividades inventadas', () => {
    const state = initialWorkspace();
    expect(state.catalog.map((row) => row.name)).toEqual([
      'Impresión de documentos',
      'Encuadernado',
      'Asesoría de informática',
    ]);
    expect(state.activities).toEqual([]);
    expect(JSON.stringify(state)).not.toMatch(
      /sampleType|referenceValue|patient|diagnosis/,
    );
  });
  it('valida calendario, años y periodos inclusivos', () => {
    expect(validDate('2026-02-29')).toBe(false);
    expect(validDate('2028-02-29')).toBe(true);
    expect(validDate('1999-12-31')).toBe(false);
    expect(validDate('2026-13-01')).toBe(false);
    expect(validDate(undefined as unknown as string)).toBe(false);
  });
  it('suma centavos exactamente y excluye cancelaciones y otras fechas', () => {
    const row = {
      id: 1,
      itemId: 1,
      itemName: 'Ejercicio',
      quantity: 1,
      totalCents: 101,
      date: '2026-11-06',
      cancelled: false,
    };
    const result = summarize(
      [
        row,
        { ...row, id: 2, totalCents: 202 },
        { ...row, id: 3, cancelled: true },
        { ...row, id: 4, date: '2026-11-05' },
      ],
      '2026-11-06',
      '2026-11-06',
    );
    expect(result).toMatchObject({
      count: 2,
      cancelledCount: 1,
      totalCents: 303,
    });
  });
  it('separa datos por usuario y captura el precio histórico del registro', async () => {
    const { service, query } = fixture();
    await service.addItem('11', {
      name: 'Mi ejercicio',
      description: '',
      priceCents: 1234,
    });
    const saved = await service.addActivity('11', {
      itemId: 4,
      quantity: 3,
      date: '2026-11-06',
    });
    expect(saved.activities[0].totalCents).toBe(3702);
    expect((await service.workspace('22')).catalog).toHaveLength(3);
    expect((await service.workspace('22')).activities).toHaveLength(0);
    await expect(service.cancelActivity('22', 1)).rejects.toBeInstanceOf(Error);
    expect(
      query.mock.calls
        .filter(([sql]) => sql.startsWith('SELECT'))
        .every(([sql]) => sql.includes('WHERE user_id = $1 FOR UPDATE')),
    ).toBe(true);
  });
  it('rechaza servicios pausados y conserva el historial al cancelar', async () => {
    const { service } = fixture();
    await service.addActivity('11', {
      itemId: 1,
      quantity: 2,
      date: '2026-11-06',
    });
    await service.setActive('11', 1, false);
    await expect(
      service.addActivity('11', { itemId: 1, quantity: 1, date: '2026-11-06' }),
    ).rejects.toBeInstanceOf(Error);
    await service.cancelActivity('11', 1);
    expect(await service.cut('11', '2026-11-06', '2026-11-06')).toMatchObject({
      count: 0,
      cancelledCount: 1,
      totalCents: 0,
    });
  });
  it('reinicia sólo el espacio propio y conserva el consentimiento', async () => {
    const { service } = fixture();
    await service.updatePreferences('11', {
      consent: true,
      noticeVersion: SCHOOL_NOTICE_VERSION,
    });
    await service.addItem('11', {
      name: 'Temporal',
      description: '',
      priceCents: 50,
    });
    await service.addItem('22', {
      name: 'Ajeno',
      description: '',
      priceCents: 10,
    });
    await service.reset('11');
    expect((await service.workspace('11')).catalog).toHaveLength(3);
    expect((await service.workspace('22')).catalog).toHaveLength(4);
    expect((await service.preferences('11')).acceptedAt).not.toBeNull();
    expect(() =>
      service.updatePreferences('11', {
        consent: true,
        noticeVersion: 'laboratory',
      }),
    ).toThrow(BadRequestException);
  });
  it('protege cortes en el servidor y rechaza periodos inválidos', () => {
    const { service } = fixture();
    const controller = new SchoolController(service);
    expect(() =>
      controller.cut(
        { user: { id: '11', rol: 'recepcion' } },
        '2026-11-06',
        '2026-11-06',
      ),
    ).toThrow(ForbiddenException);
    expect(() => service.cut('11', '2026-02-30', '2026-11-06')).toThrow(
      BadRequestException,
    );
    expect(() => service.cut('11', '2026-11-06', '2026-11-05')).toThrow(
      BadRequestException,
    );
  });
  it('publica aviso y eliminación específicos de la edición', () => {
    expect(schoolNotice().version).toBe(SCHOOL_NOTICE_VERSION);
    expect(schoolPage()).toContain('20230009@uthh.edu.mx');
    expect(schoolPage(true)).toContain('Solicitar eliminación de cuenta');
    expect(schoolPage()).not.toMatch(/paciente|expediente|clínic|ensayo/);
  });
});
