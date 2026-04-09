import { Injectable, NotFoundException, BadRequestException, } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import PDFDocument = require('pdfkit');
import * as fs from 'fs';
import * as QRCode from 'qrcode';
import {ServiceOrder,ServiceOrderItem,} from '../services/entities/service-order.entity';
import {
  StudyDetail,
  StudyDetailType,
} from '../studies/entities/study-detail.entity';
import { StudyResult, StudyResultValue } from './entities/study-result.entity';
import { CreateStudyResultDto } from './dto/create-study-result.dto';
import { UpdateStudyResultDto } from './dto/update-study-result.dto';
import { StudyResultValueDto } from './dto/study-result-value.dto';

type ResultPdfCategoryLayout = 'continuous' | 'page-per-category';
type ResultPdfStudyLayout = 'continuous' | 'page-per-study';

type ResultPdfOptions = {
  includeSignature: boolean;
  categoryLayout: ResultPdfCategoryLayout;
  studyLayout: ResultPdfStudyLayout;
};

type ResultValueGroup = {
  title?: string;
  rows: StudyResultValue[];
};

type ServicePdfSection = {
  result: StudyResult;
  item: ServiceOrderItem;
  studyDetails: StudyDetail[];
};

@Injectable()
export class ResultsService {
  constructor(
    @InjectRepository(StudyResult)
    private readonly resultRepo: Repository<StudyResult>,
    @InjectRepository(StudyResultValue)
    private readonly valueRepo: Repository<StudyResultValue>,
    @InjectRepository(ServiceOrder)
    private readonly serviceRepo: Repository<ServiceOrder>,
    @InjectRepository(ServiceOrderItem)
    private readonly itemRepo: Repository<ServiceOrderItem>,
    @InjectRepository(StudyDetail)
    private readonly detailRepo: Repository<StudyDetail>,
  ) { }

  // ---------- Helpers ----------

  private mapValueDtoToEntity(
    dto: StudyResultValueDto,
    studyDetail?: StudyDetail,
  ): StudyResultValue {
    // Si viene el detalle, usamos sus datos como snapshot por defecto
    const baseLabel = studyDetail ? studyDetail.name : dto.label;
    const baseUnit = studyDetail ? studyDetail.unit : dto.unit;
    const baseRef = studyDetail ? studyDetail.referenceValue : dto.referenceValue;

    return this.valueRepo.create({
      studyDetailId: dto.studyDetailId ?? studyDetail?.id,
      label: baseLabel,
      unit: baseUnit,
      referenceValue: baseRef,
      value: dto.value,
      sortOrder: dto.sortOrder,
      visible: dto.visible,
    });
  }

  private async buildQrBuffer(result: StudyResult): Promise<Buffer | null> {
    const template = process.env.LAB_QR_URL ?? '';
    const base = process.env.LAB_QR_BASE_URL ?? '';
    const path =
      process.env.LAB_QR_PATH ?? `/results/${result.id}`;

    let url = template;
    if (!url && base) {
      url = `${base.replace(/\/$/, '')}${path}`;
    }
    if (!url) return null;

    const finalUrl = url.includes('{id}')
      ? url.replace('{id}', String(result.id))
      : url;

    try {
      return await QRCode.toBuffer(finalUrl, {
        type: 'png',
        width: 140,
        margin: 1,
      });
    } catch {
      return null;
    }
  }

  private normalizePdfOptions(
    rawOptions?: Record<string, string | string[] | undefined>,
  ): ResultPdfOptions {
    const read = (value?: string | string[]) =>
      (Array.isArray(value) ? value[0] : value)?.trim().toLowerCase();

    const signature = read(rawOptions?.signature);
    const categoryLayout = read(rawOptions?.categoryLayout);
    const studyLayout = read(rawOptions?.studyLayout);

    return {
      includeSignature: !['without', 'false', '0', 'sin'].includes(
        signature ?? '',
      ),
      categoryLayout:
        categoryLayout === 'page-per-category'
          ? 'page-per-category'
          : 'continuous',
      studyLayout:
        studyLayout === 'page-per-study' ? 'page-per-study' : 'continuous',
    };
  }

  private groupResultValues(
    values: StudyResultValue[],
    studyDetails: StudyDetail[],
  ): ResultValueGroup[] {
    const visibleValues = (values ?? [])
      .filter((value) => value.visible !== false)
      .slice()
      .sort((a, b) => a.sortOrder - b.sortOrder);

    if (visibleValues.length === 0) {
      return [];
    }

    const detailById = new Map(
      studyDetails.map((detail) => [detail.id, detail] as const),
    );
    const groupedValueIds = new Set<number>();
    const groups: ResultValueGroup[] = [];

    const categories = studyDetails
      .filter(
        (detail) =>
          detail.dataType === StudyDetailType.CATEGORY &&
          detail.isActive !== false,
      )
      .sort((a, b) => a.sortOrder - b.sortOrder);

    for (const category of categories) {
      const rows = visibleValues.filter((value) => {
        const detail = detailById.get(value.studyDetailId ?? -1);
        return detail?.parentId === category.id;
      });

      if (rows.length === 0) {
        continue;
      }

      rows.forEach((row) => groupedValueIds.add(row.id));
      groups.push({ title: category.name, rows });
    }

    const uncategorizedRows = visibleValues.filter(
      (value) => !groupedValueIds.has(value.id),
    );

    if (uncategorizedRows.length > 0 || groups.length === 0) {
      groups.push({
        title:
          uncategorizedRows.length > 0 && groups.length > 0
            ? 'Sin categoria'
            : undefined,
        rows: uncategorizedRows.length > 0 ? uncategorizedRows : visibleValues,
      });
    }

    return groups.filter((group) => group.rows.length > 0);
  }

  private async getStudyDetailsMap(studyIds: number[]) {
    const uniqueStudyIds = [...new Set(studyIds)];
    const entries = await Promise.all(
      uniqueStudyIds.map(async (studyId) => {
        const details = await this.detailRepo.find({
          where: { studyId, isActive: true },
          order: { sortOrder: 'ASC' },
        });

        return [studyId, details] as const;
      }),
    );

    return new Map<number, StudyDetail[]>(entries);
  }

  private buildPersonName(
    person?:
      | {
          firstName?: string | null;
          lastName?: string | null;
          middleName?: string | null;
        }
      | null,
  ) {
    if (!person) return 'N/D';

    const fullName = [
      person.firstName?.trim(),
      person.lastName?.trim(),
      person.middleName?.trim(),
    ]
      .filter((part): part is string => Boolean(part))
      .join(' ')
      .trim();

    return fullName || 'N/D';
  }

  private formatGenderLabel(gender?: string | null) {
    switch ((gender ?? '').toLowerCase()) {
      case 'male':
        return 'Masculino';
      case 'female':
        return 'Femenino';
      case 'other':
        return 'Otro';
      default:
        return gender ? `${gender.charAt(0).toUpperCase()}${gender.slice(1)}` : 'N/D';
    }
  }

  private formatPdfDate(value?: Date | string | null) {
    if (!value) return 'N/D';
    try {
      return new Date(value).toLocaleString('es-MX');
    } catch {
      return String(value);
    }
  }

  private formatPdfDateShort(value?: Date | string | null) {
    if (!value) return 'N/D';
    try {
      return new Date(value).toLocaleDateString('es-MX');
    } catch {
      return String(value);
    }
  }

  private calcAgeLabel(birthDate?: string | null) {
    if (!birthDate) return 'N/D';

    const birth = new Date(`${birthDate}T00:00:00`);
    if (Number.isNaN(birth.getTime())) return 'N/D';

    const today = new Date();
    let age = today.getFullYear() - birth.getFullYear();
    const monthDiff = today.getMonth() - birth.getMonth();
    if (
      monthDiff < 0 ||
      (monthDiff === 0 && today.getDate() < birth.getDate())
    ) {
      age -= 1;
    }

    return `${age} anos`;
  }

  private drawPdfLogo(
    doc: any,
    logoPath: string,
    x: number,
    y: number,
    width: number,
    height: number,
  ) {
    if (logoPath && fs.existsSync(logoPath)) {
      doc.image(logoPath, x, y, {
        fit: [width, height],
        align: 'center',
        valign: 'center',
      });
      return;
    }

    doc.rect(x, y, width, height).strokeColor('#c8ced6').stroke();
    doc
      .font('Helvetica')
      .fontSize(8)
      .fillColor('#7a7a7a')
      .text('LOGO', x, y + height / 2 - 4, {
        width,
        align: 'center',
      })
      .fillColor('black');
  }

  private drawDetailBlock(
    doc: any,
    title: string,
    lines: string[],
    x: number,
    y: number,
    width: number,
  ) {
    doc.font('Helvetica-Bold').fontSize(10.5).text(title, x, y, { width });

    let cursorY = y + 18;
    doc.font('Helvetica').fontSize(9.1);
    for (const line of lines) {
      doc.text(line, x, cursorY, { width });
      cursorY += 18;
    }

    return cursorY;
  }

  private drawResultHeader(
    doc: any,
    options: {
      labName: string;
      labSubtitle: string;
      labAddress: string;
      labAddress2: string;
      labPhone: string;
      logoPath: string;
      branchName?: string | null;
      folio?: string | null;
    },
  ) {
    const left = 48;
    const right = doc.page.width - 48;
    const top = 42;

    this.drawPdfLogo(doc, options.logoPath, left, top, 90, 50);

    doc
      .font('Helvetica-Bold')
      .fontSize(18)
      .text(options.labName, 150, top - 2, {
        width: 240,
        align: 'center',
      });
    doc
      .font('Helvetica-Bold')
      .fontSize(9)
      .text(options.labSubtitle, 150, top + 24, {
        width: 240,
        align: 'center',
      });
    doc
      .font('Helvetica')
      .fontSize(8.3)
      .text(options.labAddress, 150, top + 38, {
        width: 240,
        align: 'center',
      });
    if (options.labAddress2) {
      doc.text(options.labAddress2, 150, top + 50, {
        width: 240,
        align: 'center',
      });
    }
    if (options.labPhone) {
      doc
        .font('Helvetica-Bold')
        .fontSize(8)
        .text(`TEL. ${options.labPhone}`, 150, top + 62, {
          width: 240,
          align: 'center',
        });
    }

    doc
      .font('Helvetica-Bold')
      .fontSize(12)
      .text(`SUC: ${options.branchName ?? 'N/D'}`, right - 165, top, {
        width: 165,
        align: 'right',
      })
      .text(`FOLIO: ${options.folio ?? 'N/D'}`, right - 210, top + 22, {
        width: 210,
        align: 'right',
      });

    const dividerY = top + 104;
    doc.moveTo(left, dividerY).lineTo(right, dividerY).strokeColor('#c8ced6').stroke();
    doc.y = dividerY + 16;
  }

  private drawResultInfoSection(
    doc: any,
    service: ServiceOrder | undefined,
    sampleAt?: Date | null,
    deliveredAt?: Date | null,
  ) {
    const left = 48;
    const right = doc.page.width - 48;
    const top = doc.y;
    const patient = service?.patient;
    const doctor = service?.doctor;

    const patientBottom = this.drawDetailBlock(
      doc,
      'PACIENTE',
      [
        `Nombre: ${this.buildPersonName(patient)}`,
        `Fecha nac.: ${this.formatPdfDateShort(patient?.birthDate)}`,
        `Edad: ${this.calcAgeLabel(patient?.birthDate)}`,
        `Tel: ${patient?.phone ?? 'N/D'}`,
        `Sexo: ${this.formatGenderLabel(patient?.gender)}`,
        `Direccion: ${patient?.addressLine ?? 'N/D'}`,
        `Entre calles: ${patient?.addressBetween ?? 'N/D'}`,
      ],
      left,
      top,
      220,
    );

    const doctorBottom = this.drawDetailBlock(
      doc,
      'MEDICO',
      [
        `Doctor(a): ${this.buildPersonName(doctor)}`,
        `Cedula: ${doctor?.licenseNumber ?? 'N/D'}`,
        `Especialidad: ${doctor?.specialty ?? 'N/D'}`,
        `Fecha de toma de muestra: ${this.formatPdfDate(sampleAt ?? service?.sampleAt)}`,
        `Fecha de entrega de resultado: ${this.formatPdfDate(deliveredAt ?? service?.deliveryAt)}`,
      ],
      300,
      top,
      247,
    );

    const dividerY = Math.max(patientBottom, doctorBottom) + 8;
    doc.moveTo(left, dividerY).lineTo(right, dividerY).strokeColor('#c8ced6').stroke();
    doc.y = dividerY + 16;
  }

  private drawResultsFooter(
    doc: any,
    qrBuffer: Buffer | null,
    options: {
      includeSignature: boolean;
      labSchedule: string;
      labSampleSchedule: string;
      labEmail: string;
      labPhone: string;
      signaturePath: string;
      responsibleName: string;
      responsibleLicense: string;
    },
  ) {
    const left = 48;
    const right = doc.page.width - 48;
    const top = doc.y + 4;

    doc.moveTo(left, top).lineTo(right, top).strokeColor('#c8ced6').stroke();

    const blockTop = top + 12;
    if (qrBuffer) {
      doc.image(qrBuffer, left, blockTop, { width: 68, height: 68 });
    } else {
      doc.rect(left, blockTop, 68, 68).strokeColor('#c8ced6').stroke();
      doc
        .font('Helvetica')
        .fontSize(7)
        .fillColor('#7a7a7a')
        .text('QR', left, blockTop + 26, {
          width: 68,
          align: 'center',
        })
        .fillColor('black');
    }

    doc
      .font('Helvetica')
      .fontSize(7)
      .text('Escanea para validar', left, blockTop + 56, {
        width: 68,
        align: 'center',
      });

    doc
      .font('Helvetica')
      .fontSize(8)
      .text(options.labSchedule, 130, blockTop + 2, { width: 170 })
      .text(options.labSampleSchedule, 130, blockTop + 16, { width: 170 })
      .text(`Correo: ${options.labEmail}`, 130, blockTop + 30, { width: 170 })
      .text(`Telefono: ${options.labPhone}`, 130, blockTop + 44, {
        width: 170,
      });

    if (options.includeSignature) {
      doc
        .font('Helvetica')
        .fontSize(9)
        .text('ATENTAMENTE', 360, blockTop + 4, {
          width: 160,
          align: 'right',
        });

      if (options.signaturePath && fs.existsSync(options.signaturePath)) {
        doc.image(options.signaturePath, 360, blockTop + 14, {
          fit: [160, 42],
          align: 'right',
        });
      }

      doc
        .font('Helvetica')
        .fontSize(8.7)
        .text('______________________________', 360, blockTop + 44, {
          width: 160,
          align: 'right',
        })
        .text(options.responsibleName, 360, blockTop + 58, {
          width: 160,
          align: 'right',
        });

      if (options.responsibleLicense) {
        doc.text(`Ced. Prof. ${options.responsibleLicense}`, 360, blockTop + 70, {
          width: 160,
          align: 'right',
        });
      }
    } else {
      doc
        .font('Helvetica')
        .fontSize(9)
        .text('Documento emitido sin firma.', 360, blockTop + 28, {
          width: 160,
          align: 'right',
        });
    }

    doc
      .font('Helvetica')
      .fontSize(7.5)
      .fillColor('#555555')
      .text(
        'Este resultado es confidencial y forma parte del expediente clinico.',
        left,
        blockTop + 86,
        { width: right - left },
      )
      .fillColor('black');

    doc.y = blockTop + 98;
  }

  private async buildPdfBufferLegacy(result: StudyResult): Promise<Buffer> {
    const qrBuffer = await this.buildQrBuffer(result);
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ margin: 48, size: 'A4' });
      const chunks: Buffer[] = [];

      doc.on('data', (chunk) => chunks.push(chunk));
      doc.on('error', (err) => reject(err));
      doc.on('end', () => resolve(Buffer.concat(chunks)));

      const labName = process.env.LAB_NAME ?? 'ECONOLAB';
      const labSubtitle =
        process.env.LAB_SUBTITLE ?? 'LABORATORIO DE ANÁLISIS CLÍNICOS';
      const labAddress = process.env.LAB_ADDRESS ?? 'Dirección no configurada';
      const labAddress2 = process.env.LAB_ADDRESS_2 ?? '';
      const labPhone = process.env.LAB_PHONE ?? 'Teléfono no configurado';
      const labEmail = process.env.LAB_EMAIL ?? 'Correo no configurado';
      const labSchedule = process.env.LAB_SCHEDULE ?? 'Horario no configurado';
      const labSampleSchedule =
        process.env.LAB_SAMPLE_SCHEDULE ?? 'Horario de toma no configurado';
      const logoPath = process.env.LAB_LOGO_PATH ?? '';
      const signaturePath = process.env.LAB_SIGNATURE_PATH ?? '';
      const responsibleName =
        process.env.LAB_RESPONSIBLE_NAME ?? 'Responsable Sanitario';
      const responsibleLicense =
        process.env.LAB_RESPONSIBLE_LICENSE ?? '';

      const service = result.serviceOrder;
      const patient = service?.patient;
      const doctor = service?.doctor;

      const studyName =
        result.serviceOrderItem?.studyNameSnapshot ?? 'Estudio';

      const formatDate = (value?: Date) => {
        if (!value) return 'N/D';
        try {
          return new Date(value).toLocaleString('es-MX');
        } catch {
          return new Date(value).toISOString();
        }
      };

      const calcAge = (birthDate?: string) => {
        if (!birthDate) return 'N/D';
        const birth = new Date(birthDate);
        if (Number.isNaN(birth.getTime())) return 'N/D';
        const today = new Date();
        let age = today.getFullYear() - birth.getFullYear();
        const m = today.getMonth() - birth.getMonth();
        if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) {
          age -= 1;
        }
        return `${age} años`;
      };

      // Header (logo + lab info + folio/sucursal)
      const headerTop = doc.y;
      const logoBox = { x: 48, y: headerTop, w: 90, h: 50 };
      if (logoPath && fs.existsSync(logoPath)) {
        doc.image(logoPath, logoBox.x, logoBox.y, {
          fit: [logoBox.w, logoBox.h],
        });
      } else {
        doc
          .rect(logoBox.x, logoBox.y, logoBox.w, logoBox.h)
          .strokeColor('#cccccc')
          .stroke();
        doc
          .font('Helvetica')
          .fontSize(8)
          .fillColor('#666666')
          .text('LOGO', logoBox.x, logoBox.y + 18, {
            width: logoBox.w,
            align: 'center',
          })
          .fillColor('black');
      }

      doc
        .font('Helvetica-Bold')
        .fontSize(14)
        .text(labName, 150, headerTop, { align: 'center' });
      doc
        .font('Helvetica')
        .fontSize(9)
        .text(labSubtitle, 150, headerTop + 16, { align: 'center' })
        .text(labAddress, 150, headerTop + 28, { align: 'center' })
        .text(labAddress2, 150, headerTop + 38, { align: 'center' });

      doc
        .font('Helvetica-Bold')
        .fontSize(9)
        .text(`SUC: ${service?.branchName ?? 'N/D'}`, 380, headerTop, {
          align: 'right',
        })
        .text(`FOLIO: ${service?.folio ?? 'N/D'}`, 380, headerTop + 14, {
          align: 'right',
        });

      doc.moveDown(3.6);
      doc
        .moveTo(48, doc.y)
        .lineTo(547, doc.y)
        .strokeColor('#bbbbbb')
        .stroke();
      doc.moveDown(0.8);

      // Patient / Order info
      doc.font('Helvetica-Bold').fontSize(9).text('PACIENTE', 48, doc.y);
      doc.font('Helvetica').fontSize(9);
      doc.text(
        `Nombre: ${patient ? `${patient.firstName} ${patient.lastName} ${patient.middleName ?? ''}`.trim() : 'N/D'}`,
        48,
        doc.y + 12,
      );
      doc.text(`Edad: ${calcAge(patient?.birthDate)}`, 48, doc.y + 24);
      doc.text(`Sexo: ${patient?.gender ?? 'N/D'}`, 48, doc.y + 36);
      doc.text(
        `Dirección: ${patient?.addressLine ?? 'N/D'}`,
        48,
        doc.y + 48,
      );

      doc.font('Helvetica-Bold').fontSize(9).text('MÉDICO', 300, doc.y - 60);
      doc.font('Helvetica').fontSize(9);
      doc.text(
        `Nombre: ${doctor ? `${doctor.firstName} ${doctor.lastName} ${doctor.middleName ?? ''}`.trim() : 'N/D'}`,
        300,
        doc.y - 48,
      );
      doc.text(
        `Cédula: ${doctor?.licenseNumber ?? 'N/D'}`,
        300,
        doc.y - 36,
      );
      doc.text(
        `Especialidad: ${doctor?.specialty ?? 'N/D'}`,
        300,
        doc.y - 24,
      );
      doc.text(
        `Fecha de toma: ${formatDate(result.sampleAt ?? service?.sampleAt)}`,
        300,
        doc.y - 12,
      );
      doc.text(`Fecha de entrega: ${formatDate(result.reportedAt)}`, 300);

      doc.moveDown(2.4);
      doc
        .moveTo(48, doc.y)
        .lineTo(547, doc.y)
        .strokeColor('#bbbbbb')
        .stroke();
      doc.moveDown(0.6);

      doc
        .font('Helvetica-Bold')
        .fontSize(10)
        .text(`ESTUDIO: ${studyName}`, { align: 'center' });
      doc.moveDown(0.2);
      if (result.method) {
        doc
          .font('Helvetica')
          .fontSize(9)
          .text(`Método: ${result.method}`, { align: 'center' });
      }
      if (result.observations) {
        doc
          .font('Helvetica')
          .fontSize(9)
          .text(`Observaciones: ${result.observations}`, { align: 'center' });
      }
      doc.moveDown(0.8);

      // Table header
      const tableStartY = doc.y;
      const colX = { label: 48, value: 280, unit: 380, ref: 460 };

      const drawTableHeader = () => {
        doc
          .font('Helvetica-Bold')
          .fontSize(10)
          .text('Parámetro', colX.label, doc.y)
          .text('Resultado', colX.value, doc.y)
          .text('Unidad', colX.unit, doc.y)
          .text('Referencia', colX.ref, doc.y);
        doc.moveDown(0.4);
        doc
          .moveTo(48, doc.y)
          .lineTo(547, doc.y)
          .strokeColor('#cccccc')
          .stroke();
        doc.moveDown(0.3);
      };

      const ensureSpace = (needed: number) => {
        if (doc.y + needed > 760) {
          doc.addPage();
          drawTableHeader();
        }
      };

      drawTableHeader();

      const values = (result.values ?? []).slice().sort((a, b) => a.sortOrder - b.sortOrder);
      doc.font('Helvetica').fontSize(10);
      for (const v of values) {
        ensureSpace(18);
        doc.text(v.label ?? 'N/D', colX.label, doc.y, { width: 220 });
        doc.text(v.value ?? '', colX.value, doc.y, { width: 90 });
        doc.text(v.unit ?? '', colX.unit, doc.y, { width: 70 });
        doc.text(v.referenceValue ?? '', colX.ref, doc.y, { width: 90 });
        doc.moveDown(0.6);
      }

      // Footer / signature
      doc.moveDown(1.2);
      const footerY = doc.y;

      // QR area
      if (qrBuffer) {
        doc.image(qrBuffer, 48, footerY, { width: 70, height: 70 });
      } else {
        doc
          .rect(48, footerY, 70, 70)
          .strokeColor('#cccccc')
          .stroke();
        doc
          .font('Helvetica')
          .fontSize(7)
          .fillColor('#666666')
          .text('QR', 48, footerY + 28, { width: 70, align: 'center' })
          .fillColor('black');
      }
      doc
        .font('Helvetica')
        .fontSize(7)
        .text('Escanea para validar', 48, footerY + 56, {
          width: 70,
          align: 'center',
        });

      // Contact info
      doc
        .font('Helvetica')
        .fontSize(8)
        .text(labSchedule, 130, footerY + 4)
        .text(labSampleSchedule, 130, footerY + 16)
        .text(`Email: ${labEmail}`, 130, footerY + 28)
        .text(`Tel: ${labPhone}`, 130, footerY + 40);

      // Signature area
      doc
        .font('Helvetica')
        .fontSize(9)
        .text('ATENTAMENTE', 360, footerY + 6, { align: 'right' });

      if (signaturePath && fs.existsSync(signaturePath)) {
        doc.image(signaturePath, 360, footerY + 14, {
          fit: [160, 50],
          align: 'right',
        });
      }

      doc
        .font('Helvetica')
        .fontSize(9)
        .text('______________________________', 360, footerY + 38, {
          align: 'right',
        })
        .text(responsibleName, 360, footerY + 52, {
          align: 'right',
        });

      if (responsibleLicense) {
        doc
          .font('Helvetica')
          .fontSize(9)
          .text(`Céd. Prof. ${responsibleLicense}`, 360, footerY + 64, {
            align: 'right',
          });
      }

      doc.moveDown(5);
      doc
        .font('Helvetica')
        .fontSize(8)
        .text('Este resultado es confidencial y forma parte del expediente clínico.');

      doc.end();
    });
  }

  private async buildServicePdfBufferLegacy(
    service: ServiceOrder,
    sections: ServicePdfSection[],
    options: ResultPdfOptions,
  ): Promise<Buffer> {
    const qrBuffer = sections[0]
      ? await this.buildQrBuffer(sections[0].result)
      : null;

    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ margin: 48, size: 'A4' });
      const chunks: Buffer[] = [];

      doc.on('data', (chunk) => chunks.push(chunk));
      doc.on('error', (err) => reject(err));
      doc.on('end', () => resolve(Buffer.concat(chunks)));

      const labName = process.env.LAB_NAME ?? 'ECONOLAB';
      const labSubtitle =
        process.env.LAB_SUBTITLE ?? 'LABORATORIO DE ANALISIS CLINICOS';
      const labAddress = process.env.LAB_ADDRESS ?? 'Direccion no configurada';
      const labAddress2 = process.env.LAB_ADDRESS_2 ?? '';
      const labPhone = process.env.LAB_PHONE ?? 'Telefono no configurado';
      const labEmail = process.env.LAB_EMAIL ?? 'Correo no configurado';
      const labSchedule = process.env.LAB_SCHEDULE ?? 'Horario no configurado';
      const labSampleSchedule =
        process.env.LAB_SAMPLE_SCHEDULE ?? 'Horario de toma no configurado';
      const logoPath = process.env.LAB_LOGO_PATH ?? '';
      const signaturePath = process.env.LAB_SIGNATURE_PATH ?? '';
      const responsibleName =
        process.env.LAB_RESPONSIBLE_NAME ?? 'Responsable Sanitario';
      const responsibleLicense =
        process.env.LAB_RESPONSIBLE_LICENSE ?? '';

      const patient = service.patient;
      const doctor = service.doctor;

      const formatDate = (value?: Date) => {
        if (!value) return 'N/D';
        try {
          return new Date(value).toLocaleString('es-MX');
        } catch {
          return new Date(value).toISOString();
        }
      };

      const calcAge = (birthDate?: string) => {
        if (!birthDate) return 'N/D';
        const birth = new Date(`${birthDate}T00:00:00`);
        if (Number.isNaN(birth.getTime())) return 'N/D';
        const today = new Date();
        let age = today.getFullYear() - birth.getFullYear();
        const monthDelta = today.getMonth() - birth.getMonth();
        if (
          monthDelta < 0 ||
          (monthDelta === 0 && today.getDate() < birth.getDate())
        ) {
          age -= 1;
        }
        return `${age} anos`;
      };

      const pageBottom = 760;
      const colX = { label: 48, value: 280, unit: 380, ref: 460 };

      const drawTableHeader = () => {
        doc
          .font('Helvetica-Bold')
          .fontSize(10)
          .text('Parametro', colX.label, doc.y)
          .text('Resultado', colX.value, doc.y)
          .text('Unidad', colX.unit, doc.y)
          .text('Referencia', colX.ref, doc.y);
        doc.moveDown(0.4);
        doc
          .moveTo(48, doc.y)
          .lineTo(547, doc.y)
          .strokeColor('#cccccc')
          .stroke();
        doc.moveDown(0.3);
      };

      const drawStudyHeader = (section: ServicePdfSection) => {
        const packageLabel = section.item.sourcePackageNameSnapshot
          ? `${section.item.sourcePackageNameSnapshot} / `
          : '';

        doc
          .font('Helvetica-Bold')
          .fontSize(10)
          .text(`ESTUDIO: ${packageLabel}${section.item.studyNameSnapshot}`, {
            align: 'center',
          });
        if (section.result.method) {
          doc
            .font('Helvetica')
            .fontSize(9)
            .text(`Metodo: ${section.result.method}`, { align: 'center' });
        }
        if (section.result.observations) {
          doc
            .font('Helvetica')
            .fontSize(9)
            .text(`Observaciones: ${section.result.observations}`, {
              align: 'center',
            });
        }
        doc.moveDown(0.8);
        drawTableHeader();
      };

      const addContinuationPage = (
        section: ServicePdfSection,
        groupTitle?: string,
      ) => {
        doc.addPage();
        drawStudyHeader(section);
        if (groupTitle) {
          doc
            .font('Helvetica-Bold')
            .fontSize(10)
            .fillColor('#356e93')
            .text(groupTitle)
            .fillColor('black');
          doc.moveDown(0.3);
        }
      };

      const ensureSpace = (
        needed: number,
        section: ServicePdfSection,
        groupTitle?: string,
      ) => {
        if (doc.y + needed > pageBottom) {
          addContinuationPage(section, groupTitle);
        }
      };

      const headerTop = doc.y;
      const logoBox = { x: 48, y: headerTop, w: 90, h: 50 };
      if (logoPath && fs.existsSync(logoPath)) {
        doc.image(logoPath, logoBox.x, logoBox.y, {
          fit: [logoBox.w, logoBox.h],
        });
      } else {
        doc
          .rect(logoBox.x, logoBox.y, logoBox.w, logoBox.h)
          .strokeColor('#cccccc')
          .stroke();
        doc
          .font('Helvetica')
          .fontSize(8)
          .fillColor('#666666')
          .text('LOGO', logoBox.x, logoBox.y + 18, {
            width: logoBox.w,
            align: 'center',
          })
          .fillColor('black');
      }

      doc
        .font('Helvetica-Bold')
        .fontSize(14)
        .text(labName, 150, headerTop, { align: 'center' });
      doc
        .font('Helvetica')
        .fontSize(9)
        .text(labSubtitle, 150, headerTop + 16, { align: 'center' })
        .text(labAddress, 150, headerTop + 28, { align: 'center' })
        .text(labAddress2, 150, headerTop + 38, { align: 'center' });

      doc
        .font('Helvetica-Bold')
        .fontSize(9)
        .text(`SUC: ${service.branchName ?? 'N/D'}`, 380, headerTop, {
          align: 'right',
        })
        .text(`FOLIO: ${service.folio ?? 'N/D'}`, 380, headerTop + 14, {
          align: 'right',
        });

      doc.moveDown(3.6);
      doc
        .moveTo(48, doc.y)
        .lineTo(547, doc.y)
        .strokeColor('#bbbbbb')
        .stroke();
      doc.moveDown(0.8);

      doc.font('Helvetica-Bold').fontSize(9).text('PACIENTE', 48, doc.y);
      doc.font('Helvetica').fontSize(9);
      doc.text(
        `Nombre: ${patient ? `${patient.firstName} ${patient.lastName} ${patient.middleName ?? ''}`.trim() : 'N/D'}`,
        48,
        doc.y + 12,
      );
      doc.text(`Edad: ${calcAge(patient?.birthDate)}`, 48, doc.y + 24);
      doc.text(`Sexo: ${patient?.gender ?? 'N/D'}`, 48, doc.y + 36);
      doc.text(`Direccion: ${patient?.addressLine ?? 'N/D'}`, 48, doc.y + 48);

      doc.font('Helvetica-Bold').fontSize(9).text('MEDICO', 300, doc.y - 60);
      doc.font('Helvetica').fontSize(9);
      doc.text(
        `Nombre: ${doctor ? `${doctor.firstName} ${doctor.lastName} ${doctor.middleName ?? ''}`.trim() : 'N/D'}`,
        300,
        doc.y - 48,
      );
      doc.text(`Cedula: ${doctor?.licenseNumber ?? 'N/D'}`, 300, doc.y - 36);
      doc.text(`Especialidad: ${doctor?.specialty ?? 'N/D'}`, 300, doc.y - 24);
      doc.text(`Fecha de toma: ${formatDate(service.sampleAt)}`, 300, doc.y - 12);
      doc.text(`Fecha de entrega: ${formatDate(service.deliveryAt)}`, 300);

      doc.moveDown(2.4);
      doc
        .moveTo(48, doc.y)
        .lineTo(547, doc.y)
        .strokeColor('#bbbbbb')
        .stroke();
      doc.moveDown(0.6);

      doc
        .font('Helvetica-Bold')
        .fontSize(11)
        .text('RESULTADOS CONSOLIDADOS', { align: 'center' });
      doc.moveDown(0.8);

      sections.forEach((section, sectionIndex) => {
        if (sectionIndex > 0) {
          if (options.studyLayout === 'page-per-study') {
            doc.addPage();
          } else {
            ensureSpace(40, section);
          }
        }

        drawStudyHeader(section);

        const groups = this.groupResultValues(
          section.result.values ?? [],
          section.studyDetails,
        );

        if (groups.length === 0) {
          ensureSpace(18, section);
          doc
            .font('Helvetica')
            .fontSize(10)
            .text('Sin parametros visibles para mostrar.');
          doc.moveDown(0.8);
          return;
        }

        groups.forEach((group, groupIndex) => {
          if (options.categoryLayout === 'page-per-category' && groupIndex > 0) {
            doc.addPage();
            drawStudyHeader(section);
          } else {
            ensureSpace(28, section, group.title);
          }

          if (group.title) {
            doc
              .font('Helvetica-Bold')
              .fontSize(10)
              .fillColor('#356e93')
              .text(group.title)
              .fillColor('black');
            doc.moveDown(0.3);
          }

          doc.font('Helvetica').fontSize(10);
          for (const value of group.rows) {
            ensureSpace(18, section, group.title);
            doc.text(value.label ?? 'N/D', colX.label, doc.y, { width: 220 });
            doc.text(value.value ?? '', colX.value, doc.y, { width: 90 });
            doc.text(value.unit ?? '', colX.unit, doc.y, { width: 70 });
            doc.text(value.referenceValue ?? '', colX.ref, doc.y, { width: 90 });
            doc.moveDown(0.6);
          }

          doc.moveDown(0.6);
        });
      });

      if (doc.y + 120 > pageBottom) {
        doc.addPage();
      }

      doc.moveDown(1.2);
      const footerY = doc.y;

      if (qrBuffer) {
        doc.image(qrBuffer, 48, footerY, { width: 70, height: 70 });
      } else {
        doc
          .rect(48, footerY, 70, 70)
          .strokeColor('#cccccc')
          .stroke();
      }

      doc
        .font('Helvetica')
        .fontSize(7)
        .text('Escanea para validar', 48, footerY + 56, {
          width: 70,
          align: 'center',
        });

      doc
        .font('Helvetica')
        .fontSize(8)
        .text(labSchedule, 130, footerY + 4)
        .text(labSampleSchedule, 130, footerY + 16)
        .text(`Email: ${labEmail}`, 130, footerY + 28)
        .text(`Tel: ${labPhone}`, 130, footerY + 40);

      doc.font('Helvetica').fontSize(9);
      if (options.includeSignature) {
        doc.text('ATENTAMENTE', 360, footerY + 6, { align: 'right' });
        if (signaturePath && fs.existsSync(signaturePath)) {
          doc.image(signaturePath, 360, footerY + 14, {
            fit: [160, 50],
            align: 'right',
          });
        }
        doc
          .text('______________________________', 360, footerY + 38, {
            align: 'right',
          })
          .text(responsibleName, 360, footerY + 52, {
            align: 'right',
          });

        if (responsibleLicense) {
          doc.text(`Ced. Prof. ${responsibleLicense}`, 360, footerY + 64, {
            align: 'right',
          });
        }
      } else {
        doc.text('Documento emitido sin firma.', 360, footerY + 18, {
          align: 'right',
        });
      }

      doc.moveDown(5);
      doc
        .font('Helvetica')
        .fontSize(8)
        .text('Este resultado es confidencial y forma parte del expediente clinico.');

      doc.end();
    });
  }

  private async buildPdfBuffer(result: StudyResult): Promise<Buffer> {
    const studyDetails = result.serviceOrderItem?.studyId
      ? await this.detailRepo.find({
          where: {
            studyId: result.serviceOrderItem.studyId,
            isActive: true,
          },
          order: { sortOrder: 'ASC' },
        })
      : [];
    const qrBuffer = await this.buildQrBuffer(result);

    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ margin: 48, size: 'A4' });
      const chunks: Buffer[] = [];

      doc.on('data', (chunk) => chunks.push(chunk));
      doc.on('error', (err) => reject(err));
      doc.on('end', () => resolve(Buffer.concat(chunks)));

      const labName = process.env.LAB_NAME ?? 'ECONOLAB';
      const labSubtitle =
        process.env.LAB_SUBTITLE ?? 'LABORATORIO DE ANALISIS CLINICOS';
      const labAddress = process.env.LAB_ADDRESS ?? 'Direccion no configurada';
      const labAddress2 = process.env.LAB_ADDRESS_2 ?? '';
      const labPhone = process.env.LAB_PHONE ?? 'Telefono no configurado';
      const labEmail = process.env.LAB_EMAIL ?? 'Correo no configurado';
      const labSchedule = process.env.LAB_SCHEDULE ?? 'Horario no configurado';
      const labSampleSchedule =
        process.env.LAB_SAMPLE_SCHEDULE ?? 'Horario de toma no configurado';
      const logoPath = process.env.LAB_LOGO_PATH ?? '';
      const signaturePath = process.env.LAB_SIGNATURE_PATH ?? '';
      const responsibleName =
        process.env.LAB_RESPONSIBLE_NAME ?? 'Responsable Sanitario';
      const responsibleLicense =
        process.env.LAB_RESPONSIBLE_LICENSE ?? '';

      const service = result.serviceOrder;
      const studyName =
        result.serviceOrderItem?.studyNameSnapshot ?? 'Estudio';

      const left = 48;
      const right = doc.page.width - 48;
      const bottomLimit = doc.page.height - 150;
      const colX = { label: left, value: 305, unit: 414, ref: 478 };
      const colWidth = { label: 225, value: 90, unit: 48, ref: 70 };

      this.drawResultHeader(doc, {
        labName,
        labSubtitle,
        labAddress,
        labAddress2,
        labPhone,
        logoPath,
        branchName: service?.branchName,
        folio: service?.folio,
      });
      this.drawResultInfoSection(
        doc,
        service,
        result.sampleAt ?? service?.sampleAt,
        result.reportedAt ?? service?.deliveryAt,
      );

      doc
        .font('Helvetica-Bold')
        .fontSize(12.5)
        .fillColor('#3b6f9c')
        .text(studyName.toUpperCase(), left, doc.y, {
          width: right - left,
          align: 'center',
        })
        .fillColor('black');

      if (result.method) {
        doc
          .font('Helvetica')
          .fontSize(8.8)
          .text(`Metodo: ${result.method}`, {
            width: right - left,
            align: 'center',
          });
      }
      if (result.observations) {
        doc
          .font('Helvetica')
          .fontSize(8.8)
          .text(`Observaciones: ${result.observations}`, {
            width: right - left,
            align: 'center',
          });
      }

      let cursorY = doc.y + 10;

      const drawTableHeader = () => {
        doc.moveTo(left, cursorY).lineTo(right, cursorY).strokeColor('#c8ced6').stroke();
        cursorY += 8;
        doc
          .font('Helvetica-Bold')
          .fontSize(9.4)
          .text('Parametro', colX.label, cursorY, { width: colWidth.label })
          .text('Resultado', colX.value, cursorY, { width: colWidth.value })
          .text('Unidad', colX.unit, cursorY, { width: colWidth.unit })
          .text('Referencia', colX.ref, cursorY, { width: colWidth.ref });
        cursorY += 16;
        doc.moveTo(left, cursorY).lineTo(right, cursorY).strokeColor('#c8ced6').stroke();
        cursorY += 10;
      };

      const addContinuationPage = () => {
        doc.addPage();
        cursorY = 56;
        doc
          .font('Helvetica-Bold')
          .fontSize(12.5)
          .fillColor('#3b6f9c')
          .text(studyName.toUpperCase(), left, cursorY, {
            width: right - left,
            align: 'center',
          })
          .fillColor('black');
        cursorY += 24;
        drawTableHeader();
      };

      const ensureSpace = (needed: number) => {
        if (cursorY + needed > bottomLimit) {
          addContinuationPage();
        }
      };

      drawTableHeader();

      const groups = this.groupResultValues(result.values ?? [], studyDetails);
      if (groups.length === 0) {
        ensureSpace(18);
        doc
          .font('Helvetica')
          .fontSize(9.5)
          .text('Sin parametros visibles para mostrar.', left, cursorY, {
            width: right - left,
          });
        cursorY += 18;
      } else {
        for (const group of groups) {
          if (group.title) {
            ensureSpace(24);
            doc
              .font('Helvetica-Bold')
              .fontSize(10)
              .fillColor('#3b6f9c')
              .text(group.title.toUpperCase(), left, cursorY, {
                width: right - left,
              })
              .fillColor('black');
            cursorY += 18;
          }

          for (const value of group.rows) {
            doc.font('Helvetica').fontSize(9.4);
            const rowHeight =
              Math.max(
                doc.heightOfString(value.label ?? 'N/D', {
                  width: colWidth.label,
                }),
                doc.heightOfString(value.value ?? '', {
                  width: colWidth.value,
                }),
                doc.heightOfString(value.unit ?? '', {
                  width: colWidth.unit,
                }),
                doc.heightOfString(value.referenceValue ?? '', {
                  width: colWidth.ref,
                }),
                12,
              ) + 4;

            ensureSpace(rowHeight + 8);
            doc.text(value.label ?? 'N/D', colX.label, cursorY, {
              width: colWidth.label,
            });
            doc.text(value.value ?? '', colX.value, cursorY, {
              width: colWidth.value,
            });
            doc.text(value.unit ?? '', colX.unit, cursorY, {
              width: colWidth.unit,
            });
            doc.text(value.referenceValue ?? '', colX.ref, cursorY, {
              width: colWidth.ref,
            });

            cursorY += rowHeight;
            doc.moveTo(left, cursorY).lineTo(right, cursorY).strokeColor('#eef2f6').stroke();
            cursorY += 6;
          }

          cursorY += 4;
        }
      }

      doc.y = cursorY;
      if (doc.y + 130 > doc.page.height - 40) {
        doc.addPage();
        doc.y = 56;
      }

      this.drawResultsFooter(doc, qrBuffer, {
        includeSignature: true,
        labSchedule,
        labSampleSchedule,
        labEmail,
        labPhone,
        signaturePath,
        responsibleName,
        responsibleLicense,
      });

      doc.end();
    });
  }

  private async buildServicePdfBuffer(
    service: ServiceOrder,
    sections: ServicePdfSection[],
    options: ResultPdfOptions,
  ): Promise<Buffer> {
    const qrBuffer = sections[0]
      ? await this.buildQrBuffer(sections[0].result)
      : null;

    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ margin: 48, size: 'A4' });
      const chunks: Buffer[] = [];

      doc.on('data', (chunk) => chunks.push(chunk));
      doc.on('error', (err) => reject(err));
      doc.on('end', () => resolve(Buffer.concat(chunks)));

      const labName = process.env.LAB_NAME ?? 'ECONOLAB';
      const labSubtitle =
        process.env.LAB_SUBTITLE ?? 'LABORATORIO DE ANALISIS CLINICOS';
      const labAddress = process.env.LAB_ADDRESS ?? 'Direccion no configurada';
      const labAddress2 = process.env.LAB_ADDRESS_2 ?? '';
      const labPhone = process.env.LAB_PHONE ?? 'Telefono no configurado';
      const labEmail = process.env.LAB_EMAIL ?? 'Correo no configurado';
      const labSchedule = process.env.LAB_SCHEDULE ?? 'Horario no configurado';
      const labSampleSchedule =
        process.env.LAB_SAMPLE_SCHEDULE ?? 'Horario de toma no configurado';
      const logoPath = process.env.LAB_LOGO_PATH ?? '';
      const signaturePath = process.env.LAB_SIGNATURE_PATH ?? '';
      const responsibleName =
        process.env.LAB_RESPONSIBLE_NAME ?? 'Responsable Sanitario';
      const responsibleLicense =
        process.env.LAB_RESPONSIBLE_LICENSE ?? '';

      const left = 48;
      const right = doc.page.width - 48;
      const bottomLimit = doc.page.height - 150;
      const colX = { label: left, value: 305, unit: 414, ref: 478 };
      const colWidth = { label: 225, value: 90, unit: 48, ref: 70 };
      const studySummary = sections
        .map((section) => section.item.studyNameSnapshot)
        .join(', ');

      this.drawResultHeader(doc, {
        labName,
        labSubtitle,
        labAddress,
        labAddress2,
        labPhone,
        logoPath,
        branchName: service.branchName,
        folio: service.folio,
      });
      this.drawResultInfoSection(doc, service, service.sampleAt, service.deliveryAt);

      doc
        .font('Helvetica-Bold')
        .fontSize(11.4)
        .fillColor('#3b6f9c')
        .text(studySummary.toUpperCase(), left, doc.y, {
          width: right - left,
          align: 'center',
        })
        .fillColor('black');

      let cursorY = doc.y + 10;

      const drawTableHeader = () => {
        doc.moveTo(left, cursorY).lineTo(right, cursorY).strokeColor('#c8ced6').stroke();
        cursorY += 8;
        doc
          .font('Helvetica-Bold')
          .fontSize(9.4)
          .text('Parametro', colX.label, cursorY, { width: colWidth.label })
          .text('Resultado', colX.value, cursorY, { width: colWidth.value })
          .text('Unidad', colX.unit, cursorY, { width: colWidth.unit })
          .text('Referencia', colX.ref, cursorY, { width: colWidth.ref });
        cursorY += 16;
        doc.moveTo(left, cursorY).lineTo(right, cursorY).strokeColor('#c8ced6').stroke();
        cursorY += 10;
      };

      const drawStudyHeader = (section: ServicePdfSection) => {
        const studyTitle = section.item.studyNameSnapshot.toUpperCase();
        doc
          .font('Helvetica-Bold')
          .fontSize(12)
          .text(studyTitle, left, cursorY, {
            width: right - left,
            align: 'center',
          });
        cursorY += 18;

        if (section.result.method) {
          doc
            .font('Helvetica')
            .fontSize(8.8)
            .text(`Metodo: ${section.result.method}`, left, cursorY, {
              width: right - left,
              align: 'center',
            });
          cursorY += 14;
        }
        if (section.result.observations) {
          doc
            .font('Helvetica')
            .fontSize(8.8)
            .text(`Observaciones: ${section.result.observations}`, left, cursorY, {
              width: right - left,
              align: 'center',
            });
          cursorY += 14;
        }

        drawTableHeader();
      };

      const addContinuationPage = (section: ServicePdfSection) => {
        doc.addPage();
        cursorY = 56;
        drawStudyHeader(section);
      };

      const ensureSpace = (needed: number, section: ServicePdfSection) => {
        if (cursorY + needed > bottomLimit) {
          addContinuationPage(section);
        }
      };

      sections.forEach((section, sectionIndex) => {
        if (sectionIndex > 0) {
          if (options.studyLayout === 'page-per-study') {
            doc.addPage();
            cursorY = 56;
          } else {
            ensureSpace(42, section);
          }
        }

        drawStudyHeader(section);

        const groups = this.groupResultValues(
          section.result.values ?? [],
          section.studyDetails,
        );

        if (groups.length === 0) {
          ensureSpace(20, section);
          doc
            .font('Helvetica')
            .fontSize(9.5)
            .text('Sin parametros visibles para mostrar.', left, cursorY, {
              width: right - left,
            });
          cursorY += 20;
          return;
        }

        groups.forEach((group, groupIndex) => {
          if (options.categoryLayout === 'page-per-category' && groupIndex > 0) {
            doc.addPage();
            cursorY = 56;
            drawStudyHeader(section);
          } else if (group.title) {
            ensureSpace(26, section);
          }

          if (group.title) {
            doc
              .font('Helvetica-Bold')
              .fontSize(10)
              .fillColor('#3b6f9c')
              .text(group.title.toUpperCase(), left, cursorY, {
                width: right - left,
              })
              .fillColor('black');
            cursorY += 18;
          }

          for (const value of group.rows) {
            doc.font('Helvetica').fontSize(9.4);
            const rowHeight =
              Math.max(
                doc.heightOfString(value.label ?? 'N/D', {
                  width: colWidth.label,
                }),
                doc.heightOfString(value.value ?? '', {
                  width: colWidth.value,
                }),
                doc.heightOfString(value.unit ?? '', {
                  width: colWidth.unit,
                }),
                doc.heightOfString(value.referenceValue ?? '', {
                  width: colWidth.ref,
                }),
                12,
              ) + 4;

            ensureSpace(rowHeight + 8, section);
            doc.text(value.label ?? 'N/D', colX.label, cursorY, {
              width: colWidth.label,
            });
            doc.text(value.value ?? '', colX.value, cursorY, {
              width: colWidth.value,
            });
            doc.text(value.unit ?? '', colX.unit, cursorY, {
              width: colWidth.unit,
            });
            doc.text(value.referenceValue ?? '', colX.ref, cursorY, {
              width: colWidth.ref,
            });

            cursorY += rowHeight;
            doc.moveTo(left, cursorY).lineTo(right, cursorY).strokeColor('#eef2f6').stroke();
            cursorY += 6;
          }

          cursorY += 4;
        });
      });

      doc.y = cursorY;
      if (doc.y + 130 > doc.page.height - 40) {
        doc.addPage();
        doc.y = 56;
      }

      this.drawResultsFooter(doc, qrBuffer, {
        includeSignature: options.includeSignature,
        labSchedule,
        labSampleSchedule,
        labEmail,
        labPhone,
        signaturePath,
        responsibleName,
        responsibleLicense,
      });

      doc.end();
    });
  }

  // ---------- Plantilla / borrador ----------

  /**
   * Devuelve un resultado de estudio para un item de servicio.
   * Si no existe aún, crea un borrador vacío tomando los StudyDetail
   * del estudio configurado, para que el front solo llene los RESULTADO.
   *
   * Ideal para la pantalla a la que llegas desde "Acciones -> Resultados".
   */
  async getOrCreateDraftByServiceItem(serviceOrderItemId: number) {
    let existing = await this.resultRepo.findOne({
      where: { serviceOrderItemId, isActive: true },
    });
    if (existing) return existing;

    const item = await this.itemRepo.findOne({
      where: { id: serviceOrderItemId },
      relations: ['serviceOrder'],
    });

    if (!item || !item.serviceOrder || !item.serviceOrder.isActive) {
      throw new NotFoundException(
        'No se encontró el estudio dentro del servicio.',
      );
    }

    // Traemos los detalles configurados del estudio.
    const details = await this.detailRepo.find({
      where: { studyId: item.studyId, isActive: true },
      order: { sortOrder: 'ASC' },
    });

    const activeCategoryIds = new Set(
      details
        .filter((detail) => detail.dataType === StudyDetailType.CATEGORY)
        .map((detail) => detail.id),
    );

    const parameters = details.filter(
      (detail) =>
        detail.dataType === StudyDetailType.PARAMETER &&
        (!detail.parentId || activeCategoryIds.has(detail.parentId)),
    );

    const values = parameters.map((d) =>
      this.valueRepo.create({
        studyDetailId: d.id,
        label: d.name,
        unit: d.unit,
        referenceValue: d.referenceValue,
        sortOrder: d.sortOrder,
        visible: true,
      }),
    );

    const draft = this.resultRepo.create({
      serviceOrderId: item.serviceOrderId,
      serviceOrderItemId,
      sampleAt: item.serviceOrder.sampleAt,
      isDraft: true,
      isActive: true,
      values,
    });

    return this.resultRepo.save(draft);
  }

  // ---------- CRUD ----------

  async findOne(id: number) {
    const result = await this.resultRepo.findOne({
      where: { id, isActive: true },
    });
    if (!result) {
      throw new NotFoundException('Resultado de estudio no encontrado.');
    }
    return result;
  }

  async generatePdf(
    id: number,
    _rawOptions?: Record<string, string | string[] | undefined>,
  ) {
    const result = await this.resultRepo.findOne({
      where: { id, isActive: true },
      relations: {
        serviceOrder: { patient: true, doctor: true, items: true },
        serviceOrderItem: true,
        values: true,
      },
    });
    if (!result) {
      throw new NotFoundException('Resultado de estudio no encontrado.');
    }
    return this.buildPdfBuffer(result);
  }

  async generateServicePdf(
    serviceOrderId: number,
    rawOptions?: Record<string, string | string[] | undefined>,
  ) {
    const service = await this.serviceRepo.findOne({
      where: { id: serviceOrderId, isActive: true },
      relations: {
        patient: true,
        doctor: true,
        items: true,
      },
    });

    if (!service) {
      throw new NotFoundException('Servicio no encontrado.');
    }

    const orderedItems = [...(service.items ?? [])].sort((a, b) => a.id - b.id);
    if (orderedItems.length === 0) {
      throw new NotFoundException(
        'Este servicio no tiene estudios asociados para generar resultados.',
      );
    }

    const detailMap = await this.getStudyDetailsMap(
      orderedItems.map((item) => item.studyId),
    );
    const sections: ServicePdfSection[] = [];

    for (const item of orderedItems) {
      const result = await this.getOrCreateDraftByServiceItem(item.id);
      sections.push({
        result,
        item,
        studyDetails: detailMap.get(item.studyId) ?? [],
      });
    }

    return this.buildServicePdfBuffer(
      service,
      sections,
      this.normalizePdfOptions(rawOptions),
    );
  }

  async findByServiceItem(serviceOrderItemId: number) {
    const result = await this.resultRepo.findOne({
      where: { serviceOrderItemId, isActive: true },
    });
    if (!result) {
      throw new NotFoundException('Resultado de estudio no encontrado.');
    }
    return result;
  }

  async create(dto: CreateStudyResultDto) {
    const service = await this.serviceRepo.findOne({
      where: { id: dto.serviceOrderId, isActive: true },
    });
    if (!service) {
      throw new NotFoundException('El servicio clínico no existe o está inactivo.');
    }

    const item = await this.itemRepo.findOne({
      where: {
        id: dto.serviceOrderItemId,
        serviceOrderId: dto.serviceOrderId,
      },
    });
    if (!item) {
      throw new NotFoundException(
        'El estudio indicado no pertenece a este servicio.',
      );
    }

    const existing = await this.resultRepo.findOne({
      where: { serviceOrderItemId: dto.serviceOrderItemId, isActive: true },
    });
    if (existing) {
      throw new BadRequestException(
        'Ya existen resultados registrados para este estudio. Utiliza la edición.',
      );
    }

    const values: StudyResultValue[] = [];

    for (const valueDto of dto.values) {
      let detail: StudyDetail | undefined;
      if (valueDto.studyDetailId) {
        const foundDetail = await this.detailRepo.findOne({
          where: { id: valueDto.studyDetailId },
        });
        detail = foundDetail || undefined;
      }
      values.push(this.mapValueDtoToEntity(valueDto, detail));
    }

    const entity = this.resultRepo.create({
      serviceOrderId: dto.serviceOrderId,
      serviceOrderItemId: dto.serviceOrderItemId,
      sampleAt: dto.sampleAt ? new Date(dto.sampleAt) : service.sampleAt,
      reportedAt: dto.reportedAt ? new Date(dto.reportedAt) : undefined,
      method: dto.method,
      observations: dto.observations,
      isDraft: dto.isDraft ?? true,
      isActive: true,
      values,
    });

    return this.resultRepo.save(entity);
  }

  async update(id: number, dto: UpdateStudyResultDto) {
    const result = await this.findOne(id);

    if (
      dto.serviceOrderId &&
      dto.serviceOrderId !== result.serviceOrderId
    ) {
      throw new BadRequestException(
        'No se puede cambiar el servicio clínico de un resultado.',
      );
    }

    if (
      dto.serviceOrderItemId &&
      dto.serviceOrderItemId !== result.serviceOrderItemId
    ) {
      throw new BadRequestException(
        'No se puede cambiar el estudio asociado al resultado.',
      );
    }

    // Si vienen values, borramos los actuales y creamos nuevos
    if (dto.values && dto.values.length > 0) {
      await this.valueRepo.delete({ studyResultId: id });

      const newValues: StudyResultValue[] = [];
      for (const valueDto of dto.values) {
        let detail: StudyDetail | undefined;
        if (valueDto.studyDetailId) {
          const foundDetail = await this.detailRepo.findOne({
            where: { id: valueDto.studyDetailId },
          });
          detail = foundDetail || undefined;
        }
        newValues.push(this.mapValueDtoToEntity(valueDto, detail));
      }
      result.values = newValues;
    }

    if (dto.sampleAt) {
      result.sampleAt = new Date(dto.sampleAt);
    }
    if (dto.reportedAt) {
      result.reportedAt = new Date(dto.reportedAt);
    }

    if (dto.method !== undefined) {
      result.method = dto.method;
    }
    if (dto.observations !== undefined) {
      result.observations = dto.observations;
    }
    if (dto.isDraft !== undefined) {
      result.isDraft = dto.isDraft;
    }

    return this.resultRepo.save(result);
  }

  async softDelete(id: number) {
    const result = await this.findOne(id);
    result.isActive = false;
    await this.resultRepo.save(result);
    return { message: 'Resultado desactivado correctamente.' };
  }

  async hardDelete(id: number) {
    const res = await this.resultRepo.delete({ id });
    if (res.affected === 0) {
      throw new NotFoundException('Resultado de estudio no encontrado.');
    }
    return { message: 'Resultado eliminado definitivamente.' };
  }
}
