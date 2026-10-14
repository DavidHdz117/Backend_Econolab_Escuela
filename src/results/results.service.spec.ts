import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Repository } from 'typeorm';
import * as QRCode from 'qrcode';
import { ResultsService } from './results.service';
import { StudyResult, StudyResultValue } from './entities/study-result.entity';
import {
  ServiceOrder,
  ServiceOrderItem,
} from '../services/entities/service-order.entity';
import { StudyDetail } from '../studies/entities/study-detail.entity';
import { buildPwaQrValue } from '../common/utils/pwa-qr.util';

function fixture() {
  const items = [41, 42].map(
    (studyId, index) =>
      ({
        id: 101 + index,
        serviceOrderId: 73,
        studyId,
        studyNameSnapshot: `ESTUDIO DEMO ${studyId}`,
      }) as ServiceOrderItem,
  );
  const service = {
    id: 73,
    folio: 'QR-DEMO-73',
    branchName: 'DEMO',
    items,
    isActive: true,
    patient: { firstName: 'PACIENTE', lastName: 'DEMO', gender: 'other' },
    sampleAt: new Date('2026-10-13T12:00:00Z'),
    deliveryAt: new Date('2026-10-13T15:00:00Z'),
  } as ServiceOrder;
  const results = items.map(
    (item, index) =>
      ({
        id: 501 + index,
        serviceOrderId: service.id,
        serviceOrderItemId: item.id,
        serviceOrder: service,
        serviceOrderItem: item,
        isActive: true,
        isDraft: false,
        sampleAt: service.sampleAt,
        reportedAt: service.deliveryAt,
        values: [
          {
            id: index + 1,
            label: 'Parametro demo',
            value: 'DEMO',
            visible: true,
            sortOrder: 1,
          },
        ],
      }) as StudyResult,
  );
  const resultRepo = {
    findOne: jest.fn(
      ({ where }: { where: { id?: number; serviceOrderItemId?: number } }) =>
        Promise.resolve(
          results.find((result) =>
            where.id
              ? result.id === where.id
              : result.serviceOrderItemId === where.serviceOrderItemId,
          ),
        ),
    ),
  } as unknown as Repository<StudyResult>;
  const serviceRepo = {
    findOne: jest.fn(() => Promise.resolve(service)),
  } as unknown as Repository<ServiceOrder>;
  const itemRepo = {
    findOne: jest.fn(({ where }: { where: { id: number } }) =>
      Promise.resolve(items.find((item) => item.id === where.id)),
    ),
  } as unknown as Repository<ServiceOrderItem>;
  const detailRepo = {
    find: jest.fn(() => Promise.resolve([])),
  } as unknown as Repository<StudyDetail>;
  return {
    service: new ResultsService(
      resultRepo,
      {} as Repository<StudyResultValue>,
      serviceRepo,
      itemRepo,
      detailRepo,
    ),
    results,
  };
}

// Optional local evidence for PDF rendering checks, with fictitious data only.
function evidence(filename: string, buffer: Buffer) {
  const directory = process.env.ECONOLAB_QR_EVIDENCE_DIR;
  if (!directory) return;
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, filename), buffer);
}

describe('QR in actual result PDFs', () => {
  afterEach(() => jest.restoreAllMocks());

  it('always embeds a study QR without LAB_QR_URL and uses study id rather than result id', async () => {
    const qr = jest.spyOn(QRCode, 'toBuffer');
    const { service } = fixture();
    const pdf = await service.generatePdf(501);
    expect(qr).toHaveBeenCalledWith(
      'econolab:study:41',
      expect.objectContaining({ type: 'png', margin: 4 }),
    );
    expect(
      qr.mock.calls.some(
        ([payload]) => typeof payload === 'string' && payload.includes('501'),
      ),
    ).toBe(false);
    expect(pdf.subarray(0, 4).toString()).toBe('%PDF');
    expect(pdf.toString('latin1')).toContain('/Subtype /Image');
    evidence('resultado-individual.pdf', pdf);
  });

  it.each(['continuous', 'page-per-study'])(
    'includes every study QR plus its service QR in %s consolidated PDFs',
    async (studyLayout) => {
      const qr = jest.spyOn(QRCode, 'toBuffer');
      const { service } = fixture();
      const pdf = await service.generateServicePdf(73, {
        studyLayout,
        signature: 'without',
      });
      const payloads = qr.mock.calls.map(([payload]) => payload);
      expect(payloads).toEqual(
        expect.arrayContaining([
          'econolab:study:41',
          'econolab:study:42',
          'econolab:service:73',
        ]),
      );
      expect(pdf.subarray(0, 4).toString()).toBe('%PDF');
      evidence(`resultados-${studyLayout}.pdf`, pdf);
    },
  );

  it('rejects missing or malformed identifiers instead of silently outputting a fake QR', () => {
    for (const id of [0, -1, NaN, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => buildPwaQrValue('study', id)).toThrow();
    }
    expect(buildPwaQrValue('study', 41)).toBe('econolab:study:41');
    expect(buildPwaQrValue('service', 73)).toBe('econolab:service:73');
  });
});
