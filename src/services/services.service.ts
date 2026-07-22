import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, QueryFailedError, Repository } from 'typeorm';
import {
  ServiceOrder,
  ServiceOrderItem,
  ServiceItemPriceType,
  ServiceStatus,
} from './entities/service-order.entity';
import { CreateServiceDto } from './dto/create-service.dto';
import { UpdateServiceDto } from './dto/update-service.dto';
import { UpdateServiceStatusDto } from './dto/update-service-status.dto';
import { PredictServiceOutcomeDto } from './dto/predict-service-outcome.dto';
import { Patient } from '../patients/entities/patient.entity';
import { Doctor } from '../doctors/entities/doctor.entity';
import {
  Study,
  StudyStatus,
  StudyType,
} from '../studies/entities/study.entity';
import PDFDocument = require('pdfkit');
import * as fs from 'fs';
import * as bwipjs from 'bwip-js';
import { toCsv } from 'src/common/utils/csv.util';
import {
  DEFAULT_LAB_ADDRESS,
  DEFAULT_LAB_ADDRESS_2,
  DEFAULT_LAB_ADDRESS_3,
  DEFAULT_LAB_NAME,
  DEFAULT_LAB_PHONE,
  DEFAULT_LAB_SUBTITLE,
  resolveLabLogoPath,
} from 'src/common/utils/pdf-branding.util';
import {
  SERVICE_OUTCOME_MINIMUM_SAMPLES_PER_CLASS,
  SERVICE_OUTCOME_MODEL_VERSION,
  ServiceOutcomeModelUnavailableError,
  ServiceOutcomePredictionModel,
  type ServiceOutcomeClass,
  type ServiceOutcomeFeatures,
  type ServiceOutcomePredictionResult as ServiceOutcomeModelResult,
} from './models/service-outcome-prediction.model';

const AUTO_SERVICE_FOLIO_PREFIX = 'ECO';
const AUTO_SEQUENCE_PAD = 4;
const OUTCOME_LABELS: Record<ServiceOutcomeClass, string> = {
  completed_on_time: 'Conclusión en tiempo',
  delayed: 'Retraso',
  cancelled: 'Cancelación',
};

type ServiceOutcomeFeatureSource = {
  branchName?: string | null;
  sampleAt?: Date | string | null;
  deliveryAt?: Date | string | null;
  createdAt: Date | string;
  subtotalAmount: number;
  courtesyPercent: number;
  discountAmount: number;
  totalAmount: number;
  items: ServiceOrderItem[];
};

type PublicServiceOutcomePrediction =
  | {
      available: false;
      message: string;
      model: {
        version: string;
        trainingSamples: number;
        minimumSamplesPerClass: number;
        classDistribution: Record<ServiceOutcomeClass, number>;
      };
    }
  | {
      available: true;
      predictedOutcome: ServiceOutcomeClass;
      label: string;
      confidence: number;
      probabilities: Array<{
        outcome: ServiceOutcomeClass;
        label: string;
        probability: number;
      }>;
      model: ServiceOutcomeModelResult['model'];
    };

@Injectable()
export class ServicesService {
  private readonly logger = new Logger(ServicesService.name);

  constructor(
    @InjectRepository(ServiceOrder)
    private readonly serviceRepo: Repository<ServiceOrder>,
    @InjectRepository(ServiceOrderItem)
    private readonly itemRepo: Repository<ServiceOrderItem>,
    @InjectRepository(Patient)
    private readonly patientRepo: Repository<Patient>,
    @InjectRepository(Doctor)
    private readonly doctorRepo: Repository<Doctor>,
    @InjectRepository(Study)
    private readonly studyRepo: Repository<Study>,
    private readonly serviceOutcomePredictionModel: ServiceOutcomePredictionModel,
  ) {}

  private normalizeSearchValue(value: string) {
    return value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '');
  }

  private buildNormalizedSql(field: string) {
    return `regexp_replace(lower(translate(coalesce(${field}, ''), 'áéíóúäëïöüàèìòùÁÉÍÓÚÄËÏÖÜÀÈÌÒÙñÑ', 'aeiouaeiouaeiouAEIOUAEIOUAEIOUnN')), '[^a-z0-9]+', '', 'g')`;
  }

  private getPriceByType(study: Study, type: ServiceItemPriceType): number {
    switch (type) {
      case ServiceItemPriceType.DIF:
        return Number(study.difPrice);
      case ServiceItemPriceType.SPECIAL:
        return Number(study.specialPrice);
      case ServiceItemPriceType.HOSPITAL:
        return Number(study.hospitalPrice);
      case ServiceItemPriceType.OTHER:
        return Number(study.otherPrice);
      case ServiceItemPriceType.NORMAL:
      default:
        return Number(study.normalPrice);
    }
  }

  private formatDate(value?: Date | string | null) {
    if (!value) return 'N/D';
    try {
      return new Date(value).toLocaleString('es-MX');
    } catch {
      return String(value);
    }
  }

  private formatDateShort(value?: Date | string | null) {
    if (!value) return 'N/D';
    try {
      return new Date(value).toLocaleDateString('es-MX');
    } catch {
      return String(value);
    }
  }

  private calcAge(birthDate?: string) {
    if (!birthDate) return 'N/D';
    const birth = new Date(birthDate);
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

  private formatMoney(value: number) {
    if (Number.isNaN(value)) return '$0.00';
    return `$ ${value.toFixed(2)}`;
  }

  private mapPriceTypeLabel(type: ServiceItemPriceType) {
    switch (type) {
      case ServiceItemPriceType.DIF:
        return 'DIF';
      case ServiceItemPriceType.SPECIAL:
        return 'Especial';
      case ServiceItemPriceType.HOSPITAL:
        return 'Hospital';
      case ServiceItemPriceType.OTHER:
        return 'Otro';
      case ServiceItemPriceType.NORMAL:
      default:
        return 'Normal';
    }
  }

  private truncate(text: string, max = 40) {
    if (!text) return '';
    if (text.length <= max) return text;
    return `${text.slice(0, max - 3)}...`;
  }

  private formatBrandSubtitle(subtitle: string) {
    if (!subtitle) return '';
    return `${subtitle.charAt(0)}${subtitle.slice(1).toLowerCase()}`;
  }

  private buildPersonName(
    person?: {
      firstName?: string | null;
      lastName?: string | null;
      middleName?: string | null;
    } | null,
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
        return gender
          ? `${gender.charAt(0).toUpperCase()}${gender.slice(1)}`
          : 'N/D';
    }
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

  private sanitizeBarcodeToken(text: string, max = 10) {
    if (!text) return 'NA';
    const cleaned = text
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '')
      .slice(0, max);
    return cleaned || 'NA';
  }

  private async buildBarcodeBuffer(text: string, height = 10, scale = 2) {
    try {
      return await bwipjs.toBuffer({
        bcid: 'code128',
        text,
        scale,
        height,
        includetext: false,
      });
    } catch {
      return null;
    }
  }

  private buildAutoServiceFolio(sequence: number, date = new Date()) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${AUTO_SERVICE_FOLIO_PREFIX}${y}${m}${d}${String(sequence).padStart(AUTO_SEQUENCE_PAD, '0')}`;
  }

  private extractAutoSequenceValue(
    value: string | null | undefined,
    date = new Date(),
  ) {
    if (!value) return 0;

    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    const token = `${y}${m}${d}`;
    const match = new RegExp(
      `^${AUTO_SERVICE_FOLIO_PREFIX}${token}(\\d{${AUTO_SEQUENCE_PAD}})$`,
      'i',
    ).exec(value.trim());

    return match ? Number(match[1]) : 0;
  }

  private async getNextAutoServiceFolio(date = new Date()) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    const prefix = `${AUTO_SERVICE_FOLIO_PREFIX}${y}${m}${d}%`;

    const latest = await this.serviceRepo
      .createQueryBuilder('service')
      .where('service.folio LIKE :prefix', { prefix })
      .orderBy('service.folio', 'DESC')
      .getOne();

    const nextSequence = this.extractAutoSequenceValue(latest?.folio, date) + 1;
    return this.buildAutoServiceFolio(nextSequence, date);
  }

  private normalizeServiceFolio(folio?: string | null) {
    const normalized = folio?.trim().toUpperCase();
    return normalized ? normalized : null;
  }

  private calculateTotals(subtotal: number, courtesyPercent: number) {
    const discountAmount = subtotal * (courtesyPercent / 100);
    return {
      discountAmount,
      totalAmount: subtotal - discountAmount,
    };
  }

  private toValidDate(value?: Date | string | null) {
    if (!value) return null;
    const parsed = value instanceof Date ? value : new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  /**
   * PASO 2 - CREAR X (variables de entrada).
   * Convierte una orden de la BD o del formulario en las mismas variables
   * numéricas y categóricas que entiende el modelo de clasificación.
   */
  private buildOutcomeFeatures(
    source: ServiceOutcomeFeatureSource,
  ): ServiceOutcomeFeatures | null {
    const createdAt = this.toValidDate(source.createdAt);
    const deliveryAt = this.toValidDate(source.deliveryAt);
    const sampleAt = this.toValidDate(source.sampleAt);

    if (!createdAt || !deliveryAt) return null;

    const promisedStart = sampleAt ?? createdAt;
    const promisedLeadHours =
      (deliveryAt.getTime() - promisedStart.getTime()) / (60 * 60 * 1000);

    if (!Number.isFinite(promisedLeadHours) || promisedLeadHours <= 0) {
      return null;
    }

    const items = source.items ?? [];
    if (items.length === 0) return null;

    const priceTypeFrequency = new Map<string, number>();
    for (const item of items) {
      const quantity = Math.max(0, Number(item.quantity) || 0);
      priceTypeFrequency.set(
        item.priceType,
        (priceTypeFrequency.get(item.priceType) ?? 0) + quantity,
      );
    }

    const dominantPriceType = [...priceTypeFrequency.entries()].sort(
      (left, right) => right[1] - left[1] || left[0].localeCompare(right[0]),
    )[0]?.[0];

    return {
      promisedLeadHours,
      registrationHour: createdAt.getHours() + createdAt.getMinutes() / 60,
      registrationWeekday: createdAt.getDay(),
      itemCount: items.length,
      totalQuantity: items.reduce(
        (total, item) => total + Math.max(0, Number(item.quantity) || 0),
        0,
      ),
      distinctStudyCount: new Set(items.map((item) => item.studyId)).size,
      packageComponentCount: items.filter((item) => item.sourcePackageId)
        .length,
      subtotalAmount: Number(source.subtotalAmount),
      courtesyPercent: Number(source.courtesyPercent),
      discountAmount: Number(source.discountAmount),
      totalAmount: Number(source.totalAmount),
      branchName: source.branchName,
      dominantPriceType,

      // El catálogo no guarda snapshots históricos de estas variables; usar
      // su valor actual para una orden vieja introduciría inconsistencia.
      maxStudyDurationMinutes: undefined,
      averageStudyDurationMinutes: undefined,
      totalParameterCount: undefined,
      specialProcessingCount: undefined,
      dominantSampleType: undefined,
      dominantAnalysisMethod: undefined,
    };
  }

  private buildUnavailableOutcomePrediction(
    message = 'El artefacto de clasificación no está disponible. Ejecuta npm run classification:train.',
  ): PublicServiceOutcomePrediction {
    const metadata = this.serviceOutcomePredictionModel.getArtifactMetadata();

    return {
      available: false,
      message,
      model: {
        version: metadata?.version ?? SERVICE_OUTCOME_MODEL_VERSION,
        trainingSamples: metadata?.trainingSamples ?? 0,
        minimumSamplesPerClass:
          metadata?.minimumSamplesPerClass ??
          SERVICE_OUTCOME_MINIMUM_SAMPLES_PER_CLASS,
        classDistribution: metadata?.classDistribution ?? {
          completed_on_time: 0,
          delayed: 0,
          cancelled: 0,
        },
      },
    };
  }

  private runOutcomeModel(
    inputs: ServiceOutcomeFeatures[],
  ): PublicServiceOutcomePrediction[] {
    try {
      // AQUÍ SE USA EL MODELO YA ENTRENADO.
      // El JSON se lee una vez y NO se reentrena al atender la solicitud.
      const result =
        this.serviceOutcomePredictionModel.predictUsingArtifact(inputs);

      return result.predictions.map((prediction) => ({
        available: true,
        predictedOutcome: prediction.outcome,
        label: OUTCOME_LABELS[prediction.outcome],
        confidence: prediction.probability,
        probabilities: (
          Object.keys(OUTCOME_LABELS) as ServiceOutcomeClass[]
        ).map((outcome) => ({
          outcome,
          label: OUTCOME_LABELS[outcome],
          probability: prediction.probabilities[outcome],
        })),
        model: result.model,
      }));
    } catch (error) {
      const errorMessage =
        error instanceof Error
          ? error.message
          : 'Error desconocido del modelo.';

      if (error instanceof ServiceOutcomeModelUnavailableError) {
        this.logger.warn(`Pronóstico de orden no disponible: ${errorMessage}`);
      } else {
        this.logger.error(
          `Falló el pronóstico de orden: ${errorMessage}`,
          error instanceof Error ? error.stack : undefined,
        );
      }

      return inputs.map(() =>
        this.buildUnavailableOutcomePrediction(errorMessage),
      );
    }
  }

  private isUniqueConstraintError(error: unknown) {
    if (!(error instanceof QueryFailedError)) {
      return false;
    }

    const driverError = (
      error as QueryFailedError & {
        driverError?: { code?: string; errno?: number };
      }
    ).driverError;

    return driverError?.code === '23505' || driverError?.errno === 19;
  }

  private async findActivePatientOrFail(
    patientId: number,
    message: string,
  ): Promise<Patient> {
    const patient = await this.patientRepo.findOne({
      where: { id: patientId, isActive: true },
    });

    if (!patient) {
      throw new NotFoundException(message);
    }

    return patient;
  }

  private async findActiveDoctorOrFail(
    doctorId: number,
    message: string,
  ): Promise<Doctor> {
    const doctor = await this.doctorRepo.findOne({
      where: { id: doctorId, isActive: true },
    });

    if (!doctor) {
      throw new NotFoundException(message);
    }

    return doctor;
  }

  async getSuggestedFolio() {
    return { folio: await this.getNextAutoServiceFolio() };
  }

  private async buildReceiptPdfBuffer(service: ServiceOrder): Promise<Buffer> {
    const labName = process.env.LAB_NAME ?? DEFAULT_LAB_NAME;
    const labSubtitle = process.env.LAB_SUBTITLE ?? DEFAULT_LAB_SUBTITLE;
    const labHeaderTitle =
      process.env.LAB_HEADER_TITLE ?? `${labName} ${labSubtitle}`.trim();
    const labAddress = process.env.LAB_ADDRESS ?? DEFAULT_LAB_ADDRESS;
    const labAddress2 = process.env.LAB_ADDRESS_2 ?? DEFAULT_LAB_ADDRESS_2;
    const labAddress3 = process.env.LAB_ADDRESS_3 ?? DEFAULT_LAB_ADDRESS_3;
    const labPhone = process.env.LAB_PHONE ?? DEFAULT_LAB_PHONE;
    const labEmail = process.env.LAB_EMAIL ?? '';
    const logoPath = resolveLabLogoPath(process.env.LAB_LOGO_PATH);

    const patient = service.patient;
    const doctor = service.doctor;
    const patientName = this.buildPersonName(patient);
    const doctorName = this.buildPersonName(doctor);
    const barcodeText = service.folio ?? String(service.id);
    const barcodeBuffer = await this.buildBarcodeBuffer(barcodeText, 12);

    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ margin: 40, size: 'A4' });
      const chunks: Buffer[] = [];

      doc.on('data', (chunk) => chunks.push(chunk));
      doc.on('error', (err) => reject(err));
      doc.on('end', () => resolve(Buffer.concat(chunks)));

      const left = 40;
      const right = doc.page.width - 40;
      const top = 42;
      const dividerColor = '#c8ced6';
      const lightDividerColor = '#e9edf2';
      const blueAccent = '#3b6f9c';
      const infoLeftX = left;
      const infoRightX = 308;
      const infoWidth = 220;
      const brandX = left;
      const brandWidth = 104;
      const centerX = 154;
      const centerWidth = 220;
      const addressX = 162;
      const addressWidth = 204;
      const brandSubtitle = this.formatBrandSubtitle(labSubtitle);

      this.drawPdfLogo(doc, logoPath, brandX, top + 18, brandWidth, 28);
      if (brandSubtitle) {
        doc
          .font('Helvetica')
          .fontSize(5.7)
          .text(brandSubtitle, brandX, top + 49, {
            width: brandWidth,
            align: 'center',
          });
      }

      doc
        .font('Helvetica-Bold')
        .fontSize(8.8)
        .text(labHeaderTitle, centerX, top - 2, {
          width: centerWidth,
          align: 'center',
        });
      doc
        .font('Helvetica')
        .fontSize(5.8)
        .text(labAddress, addressX, top + 17, {
          width: addressWidth,
          align: 'center',
        });
      if (labAddress2) {
        doc.font('Helvetica').fontSize(5.8);
        doc.text(labAddress2, addressX, top + 26, {
          width: addressWidth,
          align: 'center',
        });
      }
      if (labAddress3) {
        doc
          .font('Helvetica-Bold')
          .fontSize(6)
          .text(labAddress3, addressX, top + 35, {
            width: addressWidth,
            align: 'center',
          });
      }
      if (labPhone) {
        doc
          .font('Helvetica-Bold')
          .fontSize(6.2)
          .text(`TEL. ${labPhone}`, addressX, top + 45, {
            width: addressWidth,
            align: 'center',
          });
      }

      doc
        .font('Helvetica-Bold')
        .fontSize(12)
        .text('FOLIO', right - 145, top - 2, {
          width: 145,
          align: 'right',
        })
        .text(service.folio ?? 'N/D', right - 165, top + 16, {
          width: 165,
          align: 'right',
        });
      doc
        .font('Helvetica-Bold')
        .fontSize(9)
        .text(`SUC: ${service.branchName ?? 'N/D'}`, right - 145, top + 34, {
          width: 145,
          align: 'right',
        });

      if (barcodeBuffer) {
        doc.image(barcodeBuffer, right - 155, top + 46, {
          width: 145,
          height: 24,
        });
      }
      doc
        .font('Helvetica')
        .fontSize(6)
        .text(
          `${service.folio ?? 'N/D'}-${this.sanitizeBarcodeToken(patientName, 8)}-REC`,
          right - 160,
          top + 72,
          {
            width: 150,
            align: 'center',
          },
        );
      doc
        .font('Helvetica')
        .fontSize(6.8)
        .text(
          `${patientName} - ${this.calcAge(patient?.birthDate)}`,
          right - 160,
          top + 84,
          {
            width: 150,
            align: 'center',
          },
        );

      const headerBottom = top + 104;
      doc
        .moveTo(left, headerBottom)
        .lineTo(right, headerBottom)
        .strokeColor(dividerColor)
        .stroke();

      const infoTop = headerBottom + 16;
      const leftLines = [
        `PACIENTE: ${patientName}`,
        `TELEFONO: ${patient?.phone ?? 'N/D'}`,
        `DIRECCION: ${patient?.addressLine ?? 'N/D'}`,
        `ENTRE CALLES: ${patient?.addressBetween ?? 'N/D'}`,
      ];
      const rightLines = [
        `FECHA: ${this.formatDate(service.createdAt)}`,
        `EDAD: ${this.calcAge(patient?.birthDate)}`,
        `SEXO: ${this.formatGenderLabel(patient?.gender)}`,
        `FECHA DE ENTREGA: ${this.formatDate(service.deliveryAt)}`,
      ];
      const rightLinesExtra = [
        `SUC: ${service.branchName ?? 'N/D'}`,
        `FOLIO: ${service.folio ?? 'N/D'}`,
      ];

      doc.font('Helvetica').fontSize(8.8);
      leftLines.forEach((line, index) => {
        doc.text(line, infoLeftX, infoTop + index * 18, { width: infoWidth });
      });
      rightLines.forEach((line, index) => {
        doc.text(line, infoRightX, infoTop + index * 18, { width: infoWidth });
      });
      rightLinesExtra.forEach((line, index) => {
        doc
          .font('Helvetica-Bold')
          .text(line, right - 130, infoTop + index * 18, {
            width: 130,
            align: 'right',
          });
      });

      const infoBottom = infoTop + 80;
      doc
        .moveTo(left, infoBottom)
        .lineTo(right, infoBottom)
        .strokeColor(dividerColor)
        .stroke();

      let cursorY = infoBottom + 16;
      const colX = {
        name: left,
        type: 255,
        price: 332,
        discount: 420,
        total: 505,
      };

      doc
        .font('Helvetica-Bold')
        .fontSize(10)
        .fillColor('black')
        .text('ANALISIS CLINICO', colX.name, cursorY)
        .text('TP', colX.type, cursorY)
        .text('PRECIO', colX.price, cursorY, { width: 60, align: 'right' })
        .text('DESC.', colX.discount, cursorY, { width: 50, align: 'right' })
        .text('TOTAL', colX.total, cursorY, { width: 50, align: 'right' });
      cursorY += 18;
      doc
        .moveTo(left, cursorY)
        .lineTo(right, cursorY)
        .strokeColor(dividerColor)
        .stroke();
      cursorY += 10;

      for (const item of service.items ?? []) {
        const rowTop = cursorY;
        const lineTotal = Number(item.subtotalAmount ?? 0);
        const description =
          item.sourcePackageNameSnapshot ?? item.studyNameSnapshot ?? '';

        doc
          .font('Helvetica-Bold')
          .fontSize(9)
          .text(
            this.truncate(item.studyNameSnapshot ?? '', 34),
            colX.name,
            rowTop,
            {
              width: 190,
            },
          );
        doc
          .font('Helvetica')
          .fontSize(6.8)
          .fillColor(blueAccent)
          .text(
            `DESCRIPCION: ${this.truncate(description, 34)}`,
            colX.name,
            rowTop + 11,
            {
              width: 190,
            },
          )
          .fillColor('black');
        doc
          .font('Helvetica')
          .fontSize(8.4)
          .text(this.mapPriceTypeLabel(item.priceType), colX.type, rowTop + 1, {
            width: 44,
            align: 'center',
          });
        doc.text(
          this.formatMoney(Number(item.unitPrice ?? 0)),
          colX.price,
          rowTop + 1,
          {
            width: 60,
            align: 'right',
          },
        );
        doc.text(
          `${Number(item.discountPercent ?? 0)} %`,
          colX.discount,
          rowTop + 1,
          {
            width: 50,
            align: 'right',
          },
        );
        doc.text(this.formatMoney(lineTotal), colX.total, rowTop + 1, {
          width: 50,
          align: 'right',
        });

        cursorY += 28;
        doc
          .moveTo(left, cursorY)
          .lineTo(right, cursorY)
          .strokeColor(lightDividerColor)
          .stroke();
        cursorY += 6;
      }

      const subtotal = Number(service.subtotalAmount ?? 0);
      const courtesy = Number(service.courtesyPercent ?? 0);
      const discount = Number(service.discountAmount ?? 0);
      const total = Number(service.totalAmount ?? 0);
      const totalsTop = Math.max(cursorY + 16, doc.page.height - 150);

      doc
        .moveTo(355, totalsTop - 10)
        .lineTo(right, totalsTop - 10)
        .strokeColor(dividerColor)
        .stroke();
      doc.font('Helvetica').fontSize(9);
      doc.text('SUBTOTAL:', 388, totalsTop, { width: 80, align: 'right' });
      doc.text(this.formatMoney(subtotal), 470, totalsTop, {
        width: 65,
        align: 'right',
      });
      doc.text('CORTESIA:', 388, totalsTop + 18, { width: 80, align: 'right' });
      doc.text(`${courtesy} %`, 470, totalsTop + 18, {
        width: 65,
        align: 'right',
      });
      doc.text('DESC. TOTAL:', 388, totalsTop + 36, {
        width: 80,
        align: 'right',
      });
      doc.text(this.formatMoney(discount), 470, totalsTop + 36, {
        width: 65,
        align: 'right',
      });
      doc
        .font('Helvetica-Bold')
        .text('TOTAL:', 388, totalsTop + 58, { width: 80, align: 'right' })
        .text(this.formatMoney(total), 470, totalsTop + 58, {
          width: 65,
          align: 'right',
        });

      const footerY = doc.page.height - 48;
      doc
        .font('Helvetica')
        .fontSize(7)
        .fillColor('#555555')
        .text(`Telefono: ${labPhone || 'N/D'}`, left, footerY, { width: 190 })
        .text(`Correo: ${labEmail || 'N/D'}`, left, footerY + 12, {
          width: 220,
        })
        .fillColor('black');

      doc.end();
    });
  }

  private async buildTicketPdfBuffer(service: ServiceOrder): Promise<Buffer> {
    const labName = process.env.LAB_NAME ?? DEFAULT_LAB_NAME;
    const labSubtitle = process.env.LAB_SUBTITLE ?? DEFAULT_LAB_SUBTITLE;
    const labHeaderTitle =
      process.env.LAB_HEADER_TITLE ?? `${labName} ${labSubtitle}`.trim();
    const labAddress = process.env.LAB_ADDRESS ?? DEFAULT_LAB_ADDRESS;
    const labAddress2 = process.env.LAB_ADDRESS_2 ?? DEFAULT_LAB_ADDRESS_2;
    const labAddress3 = process.env.LAB_ADDRESS_3 ?? DEFAULT_LAB_ADDRESS_3;
    const labPhone = process.env.LAB_PHONE ?? DEFAULT_LAB_PHONE;
    const logoPath = resolveLabLogoPath(process.env.LAB_LOGO_PATH);
    const patientName = service.patient
      ? this.buildPersonName(service.patient)
      : 'N/D';
    const items = service.items ?? [];
    const logoHeaderHeight = 56;
    const pageHeight = Math.max(
      520 + logoHeaderHeight,
      265 + logoHeaderHeight + items.length * 34 + 120,
    );

    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ margin: 18, size: [226, pageHeight] });
      const chunks: Buffer[] = [];

      doc.on('data', (chunk) => chunks.push(chunk));
      doc.on('error', (err) => reject(err));
      doc.on('end', () => resolve(Buffer.concat(chunks)));

      const left = 18;
      const right = doc.page.width - 18;
      const dividerColor = '#c8ced6';
      const blueAccent = '#3b6f9c';
      const brandSubtitle = this.formatBrandSubtitle(labSubtitle);
      let cursorY = 22;

      this.drawPdfLogo(
        doc,
        logoPath,
        left + (right - left - 96) / 2,
        cursorY,
        96,
        26,
      );
      cursorY += 28;

      if (brandSubtitle) {
        doc
          .font('Helvetica')
          .fontSize(4.8)
          .text(brandSubtitle, left + (right - left - 96) / 2, cursorY, {
            width: 96,
            align: 'center',
          });
      }
      cursorY += 10;

      doc
        .font('Helvetica-Bold')
        .fontSize(6.3)
        .text(labHeaderTitle, left, cursorY, {
          width: right - left,
          align: 'center',
        });
      cursorY += 11;
      if (labAddress) {
        doc
          .font('Helvetica')
          .fontSize(5.3)
          .text(labAddress, left, cursorY, {
            width: right - left,
            align: 'center',
          });
        cursorY += 8;
      }
      if (labAddress2) {
        doc.text(labAddress2, left, cursorY, {
          width: right - left,
          align: 'center',
        });
        cursorY += 8;
      }
      if (labAddress3) {
        doc
          .font('Helvetica-Bold')
          .fontSize(5.4)
          .text(labAddress3, left, cursorY, {
            width: right - left,
            align: 'center',
          });
        cursorY += 8;
      }
      if (labPhone) {
        doc
          .font('Helvetica-Bold')
          .fontSize(5.4)
          .text(`TEL. ${labPhone}`, left, cursorY, {
            width: right - left,
            align: 'center',
          });
        cursorY += 11;
      }

      doc
        .font('Helvetica-Bold')
        .fontSize(7.6)
        .text(`FOLIO ${service.folio ?? 'N/D'}`, left, cursorY, { width: 120 })
        .text(`SUC: ${service.branchName ?? 'N/D'}`, 128, cursorY, {
          width: 80,
          align: 'right',
        });
      cursorY += 12;

      doc
        .font('Helvetica')
        .fontSize(7.1)
        .text(`FECHA: ${this.formatDate(service.createdAt)}`, left, cursorY, {
          width: right - left,
        });
      cursorY += 12;
      doc.text(`PACIENTE: ${patientName}`, left, cursorY, {
        width: right - left,
      });
      cursorY += 12;
      doc
        .text(
          `EDAD: ${this.calcAge(service.patient?.birthDate)}`,
          left,
          cursorY,
          {
            width: 96,
          },
        )
        .text(
          `SEXO: ${this.formatGenderLabel(service.patient?.gender)}`,
          116,
          cursorY,
          {
            width: 92,
            align: 'right',
          },
        );
      cursorY += 12;
      doc.text(`TEL: ${service.patient?.phone ?? 'N/D'}`, left, cursorY, {
        width: right - left,
      });
      cursorY += 12;
      doc.text(
        `DIRECCION: ${service.patient?.addressLine ?? 'N/D'}`,
        left,
        cursorY,
        {
          width: right - left,
        },
      );
      cursorY += 12;
      doc.text(
        `ENTRE CALLES: ${service.patient?.addressBetween ?? 'N/D'}`,
        left,
        cursorY,
        { width: right - left },
      );
      cursorY += 12;
      doc.text(
        `FECHA DE ENTREGA: ${this.formatDate(service.deliveryAt)}`,
        left,
        cursorY,
        {
          width: right - left,
        },
      );
      cursorY += 12;

      doc
        .moveTo(left, cursorY)
        .lineTo(right, cursorY)
        .strokeColor(dividerColor)
        .stroke();
      cursorY += 8;

      const colX = {
        name: left,
        type: 108,
        price: 138,
        discount: 167,
        total: 208,
      };
      doc
        .font('Helvetica-Bold')
        .fontSize(7.2)
        .text('ANALISIS CLINICO', colX.name, cursorY, { width: 86 })
        .text('TP', colX.type, cursorY, { width: 20, align: 'center' })
        .text('PRECIO', colX.price, cursorY, { width: 28, align: 'right' })
        .text('DESC.', colX.discount, cursorY, { width: 24, align: 'right' })
        .text('TOTAL', colX.total - 28, cursorY, { width: 28, align: 'right' });
      cursorY += 14;
      doc
        .moveTo(left, cursorY)
        .lineTo(right, cursorY)
        .strokeColor(dividerColor)
        .stroke();
      cursorY += 8;

      for (const item of items) {
        const rowTop = cursorY;
        const description =
          item.sourcePackageNameSnapshot ?? item.studyNameSnapshot ?? '';

        doc
          .font('Helvetica-Bold')
          .fontSize(7.2)
          .text(
            this.truncate(item.studyNameSnapshot ?? '', 20),
            colX.name,
            rowTop,
            {
              width: 82,
            },
          );
        doc
          .font('Helvetica')
          .fontSize(5.6)
          .fillColor(blueAccent)
          .text(
            `DESCRIPCION: ${this.truncate(description, 20)}`,
            colX.name,
            rowTop + 9,
            {
              width: 82,
            },
          )
          .fillColor('black');
        doc
          .font('Helvetica')
          .fontSize(6.6)
          .text(this.mapPriceTypeLabel(item.priceType), colX.type, rowTop + 2, {
            width: 20,
            align: 'center',
          });
        doc.text(
          this.formatMoney(Number(item.unitPrice ?? 0)),
          colX.price,
          rowTop + 2,
          {
            width: 28,
            align: 'right',
          },
        );
        doc.text(
          `${Number(item.discountPercent ?? 0)} %`,
          colX.discount,
          rowTop + 2,
          {
            width: 24,
            align: 'right',
          },
        );
        doc.text(
          this.formatMoney(Number(item.subtotalAmount ?? 0)),
          colX.total - 28,
          rowTop + 2,
          {
            width: 28,
            align: 'right',
          },
        );
        cursorY += 28;
      }

      cursorY += 8;
      doc
        .moveTo(120, cursorY)
        .lineTo(right, cursorY)
        .strokeColor(dividerColor)
        .stroke();
      cursorY += 10;

      doc
        .font('Helvetica')
        .fontSize(7.5)
        .text('SUBTOTAL:', 118, cursorY, { width: 52, align: 'right' })
        .text(
          this.formatMoney(Number(service.subtotalAmount ?? 0)),
          170,
          cursorY,
          {
            width: 38,
            align: 'right',
          },
        );
      cursorY += 12;
      doc
        .text('CORTESIA:', 118, cursorY, { width: 52, align: 'right' })
        .text(`${Number(service.courtesyPercent ?? 0)} %`, 170, cursorY, {
          width: 38,
          align: 'right',
        });
      cursorY += 12;
      doc
        .text('DESC. TOTAL:', 118, cursorY, { width: 52, align: 'right' })
        .text(
          this.formatMoney(Number(service.discountAmount ?? 0)),
          170,
          cursorY,
          {
            width: 38,
            align: 'right',
          },
        );
      cursorY += 14;
      doc
        .font('Helvetica-Bold')
        .text('TOTAL:', 118, cursorY, { width: 52, align: 'right' })
        .text(
          this.formatMoney(Number(service.totalAmount ?? 0)),
          170,
          cursorY,
          {
            width: 38,
            align: 'right',
          },
        );

      doc.end();
    });
  }

  private async buildLabelsPdfBuffer(service: ServiceOrder): Promise<Buffer> {
    const labName = process.env.LAB_NAME ?? DEFAULT_LAB_NAME;
    const logoPath = resolveLabLogoPath(process.env.LAB_LOGO_PATH);
    const patient = service.patient;
    const sampleAt = service.sampleAt ?? service.createdAt;

    const studyIds = [
      ...new Set((service.items ?? []).map((item) => item.studyId)),
    ];
    const studies = studyIds.length
      ? await this.studyRepo.findBy({ id: In(studyIds) })
      : [];
    const studyMap = new Map<number, Study>();
    studies.forEach((s) => studyMap.set(s.id, s));

    const labels: Array<{
      item: ServiceOrderItem;
      barcode: string;
      studyCode: string;
    }> = [];
    for (const item of service.items ?? []) {
      const study = studyMap.get(item.studyId);
      const studyCode = study?.code ?? String(item.studyId);
      const patientTag = this.sanitizeBarcodeToken(
        `${patient?.lastName ?? ''}${patient?.firstName ?? ''}`,
        8,
      );
      const studyTag = this.sanitizeBarcodeToken(
        study?.code ?? item.studyNameSnapshot ?? String(item.studyId),
        8,
      );
      const barcodeText = `${service.folio ?? service.id}-${patientTag}-${studyTag}-${item.id}`;
      labels.push({ item, barcode: barcodeText, studyCode });
    }

    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ margin: 24, size: 'A4' });
      const chunks: Buffer[] = [];

      doc.on('data', (chunk) => chunks.push(chunk));
      doc.on('error', (err) => reject(err));
      doc.on('end', () => resolve(Buffer.concat(chunks)));

      const pageHeight = doc.page.height;
      const labelWidth = 180;
      const labelHeight = 80;
      const gapX = 8;
      const gapY = 8;
      const startX = 24;
      const startY = 30;
      const cols = 3;
      const rowsPerPage = Math.floor(
        (pageHeight - startY * 2 + gapY) / (labelHeight + gapY),
      );

      let index = 0;

      const drawLabel = async (
        x: number,
        y: number,
        item: ServiceOrderItem,
        barcodeText: string,
        studyCode: string,
      ) => {
        doc.rect(x, y, labelWidth, labelHeight).strokeColor('#dddddd').stroke();

        const patientName = patient
          ? `${patient.firstName} ${patient.lastName} ${patient.middleName ?? ''}`.trim()
          : 'N/D';

        this.drawPdfLogo(doc, logoPath, x + labelWidth - 60, y + 5, 52, 16);

        doc
          .font('Helvetica-Bold')
          .fontSize(7)
          .text(labName, x + 4, y + 6, { width: labelWidth - 64 });

        doc
          .font('Helvetica-Bold')
          .fontSize(8)
          .text(this.truncate(patientName, 28), x + 4, y + 14, {
            width: labelWidth - 8,
          });

        doc
          .font('Helvetica')
          .fontSize(7)
          .text(
            `Sexo: ${patient?.gender ?? 'N/D'}  Edad: ${this.calcAge(patient?.birthDate)}`,
            x + 4,
            y + 24,
            {
              width: labelWidth - 8,
            },
          );

        doc
          .font('Helvetica')
          .fontSize(7)
          .text(
            `Estudio: ${this.truncate(item.studyNameSnapshot ?? studyCode, 26)}`,
            x + 4,
            y + 34,
            {
              width: labelWidth - 8,
            },
          );

        doc
          .font('Helvetica')
          .fontSize(7)
          .text(`Folio: ${service.folio ?? service.id}`, x + 4, y + 44, {
            width: labelWidth - 8,
          })
          .text(`Muestra: ${this.formatDateShort(sampleAt)}`, x + 4, y + 54, {
            width: labelWidth - 8,
          });

        const barcodeBuffer = await this.buildBarcodeBuffer(barcodeText, 8);
        if (barcodeBuffer) {
          doc.image(barcodeBuffer, x + 6, y + 62, {
            width: labelWidth - 12,
            height: 14,
          });
        }

        doc
          .font('Helvetica')
          .fontSize(6)
          .text(barcodeText, x + 6, y + 76, {
            width: labelWidth - 12,
            align: 'center',
          });
      };

      const renderLabels = async () => {
        for (const label of labels) {
          if (index > 0 && index % (cols * rowsPerPage) === 0) {
            doc.addPage();
          }

          const localIndex = index % (cols * rowsPerPage);
          const row = Math.floor(localIndex / cols);
          const col = localIndex % cols;

          const x = startX + col * (labelWidth + gapX);
          const y = startY + row * (labelHeight + gapY);

          await drawLabel(x, y, label.item, label.barcode, label.studyCode);
          index += 1;
        }
      };

      renderLabels()
        .then(() => doc.end())
        .catch((err) => reject(err));
    });
  }

  private async buildServiceItems(
    dtoItems: CreateServiceDto['items'],
  ): Promise<{ items: ServiceOrderItem[]; subtotal: number }> {
    if (!dtoItems || dtoItems.length === 0) {
      throw new BadRequestException(
        'Debe agregar al menos un analisis al servicio.',
      );
    }

    const studyIds = [...new Set(dtoItems.map((item) => item.studyId))];
    const studies = await this.studyRepo.findBy({ id: In(studyIds) });
    if (studies.length !== studyIds.length) {
      throw new NotFoundException(
        'Uno o mas estudios no existen o estan inactivos.',
      );
    }

    const studyMap = new Map<number, Study>();
    studies.forEach((study) => studyMap.set(study.id, study));

    const items: ServiceOrderItem[] = [];
    let subtotal = 0;

    for (const itemDto of dtoItems) {
      const study = studyMap.get(itemDto.studyId)!;
      const quantity = itemDto.quantity;
      const itemDiscount = Number(itemDto.discountPercent ?? 0);

      if (!study.isActive || study.status !== StudyStatus.ACTIVE) {
        throw new BadRequestException(
          `El estudio "${study.name}" no esta disponible para nuevos servicios.`,
        );
      }

      if (study.type === StudyType.PACKAGE) {
        const componentIds = study.packageStudyIds ?? [];
        if (componentIds.length === 0) {
          throw new BadRequestException(
            `El paquete "${study.name}" no tiene estudios asociados.`,
          );
        }

        const componentStudies = await this.studyRepo.findBy({
          id: In(componentIds),
        });
        if (componentStudies.length !== componentIds.length) {
          throw new NotFoundException(
            `Uno o mas estudios del paquete "${study.name}" no existen.`,
          );
        }

        const invalidComponent = componentStudies.find(
          (component) =>
            !component.isActive ||
            component.status !== StudyStatus.ACTIVE ||
            component.type !== StudyType.STUDY,
        );

        if (invalidComponent) {
          throw new BadRequestException(
            `El paquete "${study.name}" contiene estudios no disponibles.`,
          );
        }

        const orderedComponents = componentIds
          .map((componentId) =>
            componentStudies.find((component) => component.id === componentId),
          )
          .filter((component): component is Study => Boolean(component));

        const packageUnitPrice = this.getPriceByType(study, itemDto.priceType);
        const packageLineBase = packageUnitPrice * quantity;
        const packageLineSubtotal = packageLineBase * (1 - itemDiscount / 100);
        subtotal += packageLineSubtotal;

        orderedComponents.forEach((component, index) => {
          const isPricedLine = index === 0;
          items.push(
            this.itemRepo.create({
              studyId: component.id,
              studyNameSnapshot: component.name,
              sourcePackageId: study.id,
              sourcePackageNameSnapshot: study.name,
              priceType: itemDto.priceType,
              unitPrice: isPricedLine ? packageUnitPrice : 0,
              quantity,
              discountPercent: isPricedLine ? itemDiscount : 0,
              subtotalAmount: isPricedLine ? packageLineSubtotal : 0,
            }),
          );
        });

        continue;
      }

      const unitPrice = this.getPriceByType(study, itemDto.priceType);
      const lineBase = unitPrice * quantity;
      const lineSubtotal = lineBase * (1 - itemDiscount / 100);
      subtotal += lineSubtotal;

      items.push(
        this.itemRepo.create({
          studyId: study.id,
          studyNameSnapshot: study.name,
          priceType: itemDto.priceType,
          unitPrice,
          quantity,
          discountPercent: itemDiscount,
          subtotalAmount: lineSubtotal,
        }),
      );
    }

    return { items, subtotal };
  }

  private getServiceItemIdentityKey(
    item: Pick<
      ServiceOrderItem,
      'studyId' | 'sourcePackageId' | 'priceType' | 'unitPrice'
    >,
  ) {
    const packageScope = item.sourcePackageId
      ? `pkg:${item.sourcePackageId}`
      : 'single';
    const packageRole = item.sourcePackageId
      ? Number(item.unitPrice) > 0
        ? 'priced'
        : 'shadow'
      : 'single';

    return `${packageScope}:${item.studyId}:${item.priceType}:${packageRole}`;
  }

  private reconcileServiceItems(
    existingItems: ServiceOrderItem[],
    preparedItems: ServiceOrderItem[],
  ) {
    const existingBuckets = new Map<string, ServiceOrderItem[]>();
    const usedItemIds = new Set<number>();

    for (const item of [...existingItems].sort((a, b) => a.id - b.id)) {
      const key = this.getServiceItemIdentityKey(item);
      const bucket = existingBuckets.get(key) ?? [];
      bucket.push(item);
      existingBuckets.set(key, bucket);
    }

    const takeNextBucketMatch = (preparedItem: ServiceOrderItem) => {
      const key = this.getServiceItemIdentityKey(preparedItem);
      const bucket = existingBuckets.get(key) ?? [];

      while (bucket.length > 0) {
        const candidate = bucket.shift()!;
        if (!usedItemIds.has(candidate.id)) {
          return candidate;
        }
      }

      return undefined;
    };

    const items = preparedItems.map((preparedItem) => {
      const matched = takeNextBucketMatch(preparedItem);

      if (!matched) {
        return preparedItem;
      }

      usedItemIds.add(matched.id);
      return this.itemRepo.merge(matched, preparedItem);
    });

    const removedItemIds = existingItems
      .filter((item) => !usedItemIds.has(item.id))
      .map((item) => item.id);

    return { items, removedItemIds };
  }

  /**
   * PASO 5 - USO INDIVIDUAL.
   * El formulario llama este método antes de guardar un servicio nuevo.
   */
  async predictOutcome(
    dto: PredictServiceOutcomeDto,
  ): Promise<PublicServiceOutcomePrediction> {
    if (!dto.deliveryAt || !dto.items?.length) {
      return this.buildUnavailableOutcomePrediction(
        'Captura la fecha de entrega y al menos un estudio para consultar el pronóstico.',
      );
    }

    const preparedItems = await this.buildServiceItems(dto.items);
    const courtesyPercent = Number(dto.courtesyPercent ?? 0);
    const totals = this.calculateTotals(
      preparedItems.subtotal,
      courtesyPercent,
    );
    const features = this.buildOutcomeFeatures({
      branchName: dto.branchName,
      sampleAt: dto.sampleAt,
      deliveryAt: dto.deliveryAt,
      createdAt: new Date(),
      subtotalAmount: preparedItems.subtotal,
      courtesyPercent,
      discountAmount: totals.discountAmount,
      totalAmount: totals.totalAmount,
      items: preparedItems.items,
    });

    if (!features) {
      return this.buildUnavailableOutcomePrediction(
        'La fecha de entrega debe ser posterior al inicio de la orden para consultar el pronóstico.',
      );
    }

    // Envía X al artefacto previamente entrenado.
    return (
      this.runOutcomeModel([features])[0] ??
      this.buildUnavailableOutcomePrediction()
    );
  }

  /**
   * PASO 5 - USO POR LOTE.
   * La lista de servicios llama este método para pronosticar todas las órdenes
   * pendientes o en curso usando el mismo artefacto cargado en memoria.
   */
  async predictOutcomesBatch(serviceIds: number[]) {
    const uniqueIds = [...new Set(serviceIds)];
    if (uniqueIds.length === 0) return { predictions: [] };

    const orders = await this.serviceRepo.find({
      where: {
        id: In(uniqueIds),
        isActive: true,
        status: In([ServiceStatus.PENDING, ServiceStatus.IN_PROGRESS]),
      },
    });
    const orderById = new Map(orders.map((order) => [order.id, order]));
    const featuresByServiceId = new Map<number, ServiceOutcomeFeatures>();

    for (const order of orders) {
      const features = this.buildOutcomeFeatures({
        branchName: order.branchName,
        sampleAt: order.sampleAt,
        deliveryAt: order.deliveryAt,
        createdAt: order.createdAt,
        subtotalAmount: Number(order.subtotalAmount),
        courtesyPercent: Number(order.courtesyPercent),
        discountAmount: Number(order.discountAmount),
        totalAmount: Number(order.totalAmount),
        items: order.items ?? [],
      });
      if (features) featuresByServiceId.set(order.id, features);
    }

    const modeledIds = uniqueIds.filter((id) => featuresByServiceId.has(id));
    const modeledPredictions =
      modeledIds.length > 0
        ? this.runOutcomeModel(
            modeledIds.map((id) => featuresByServiceId.get(id)!),
          )
        : [];
    const predictionByServiceId = new Map(
      modeledIds.map((id, index) => [id, modeledPredictions[index]]),
    );

    return {
      predictions: uniqueIds.map((serviceId) => {
        const order = orderById.get(serviceId);
        let prediction = predictionByServiceId.get(serviceId);

        if (!order) {
          prediction = this.buildUnavailableOutcomePrediction(
            'El pronóstico solo se muestra en órdenes pendientes o en curso.',
          );
        } else if (!prediction) {
          prediction = this.buildUnavailableOutcomePrediction(
            'La orden no tiene suficientes datos para calcular el pronóstico.',
          );
        }

        return { serviceId, prediction };
      }),
    };
  }

  async create(dto: CreateServiceDto) {
    await this.findActivePatientOrFail(
      dto.patientId,
      'El paciente no existe o esta inactivo.',
    );

    if (dto.doctorId) {
      await this.findActiveDoctorOrFail(
        dto.doctorId,
        'El medico no existe o esta inactivo.',
      );
    }

    const preparedItems = await this.buildServiceItems(dto.items);
    const preparedCourtesyPercent = Number(dto.courtesyPercent ?? 0);
    const {
      discountAmount: preparedDiscountAmount,
      totalAmount: preparedTotalAmount,
    } = this.calculateTotals(preparedItems.subtotal, preparedCourtesyPercent);

    const manualFolio = this.normalizeServiceFolio(dto.folio);
    const useAutoFolio = dto.autoGenerateFolio ?? false;

    if (!useAutoFolio && !manualFolio) {
      throw new BadRequestException(
        'El folio es obligatorio o activa la generacion automatica.',
      );
    }

    const saveService = async (folio: string) => {
      const service = this.serviceRepo.create({
        folio,
        patientId: dto.patientId,
        doctorId: dto.doctorId,
        branchName: dto.branchName,
        sampleAt: dto.sampleAt ? new Date(dto.sampleAt) : undefined,
        deliveryAt: dto.deliveryAt ? new Date(dto.deliveryAt) : undefined,
        status: dto.status ?? ServiceStatus.PENDING,
        completedAt:
          dto.status === ServiceStatus.COMPLETED ? new Date() : undefined,
        courtesyPercent: preparedCourtesyPercent,
        subtotalAmount: preparedItems.subtotal,
        discountAmount: preparedDiscountAmount,
        totalAmount: preparedTotalAmount,
        notes: dto.notes,
        items: preparedItems.items,
      });

      return this.serviceRepo.save(service);
    };

    if (!useAutoFolio && manualFolio) {
      const existing = await this.serviceRepo.findOne({
        where: { folio: manualFolio },
      });

      if (existing) {
        throw new ConflictException('Ya existe un servicio con este folio.');
      }

      try {
        return await saveService(manualFolio);
      } catch (error) {
        if (this.isUniqueConstraintError(error)) {
          throw new ConflictException('Ya existe un servicio con este folio.');
        }
        throw error;
      }
    }

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const nextFolio = await this.getNextAutoServiceFolio();

      try {
        return await saveService(nextFolio);
      } catch (error) {
        if (!this.isUniqueConstraintError(error)) {
          throw error;
        }
      }
    }

    throw new ConflictException(
      'No se pudo generar un folio automatico. Intenta de nuevo.',
    );
  }

  async findOne(id: number) {
    const service = await this.serviceRepo.findOne({
      where: { id, isActive: true },
    });
    if (!service) {
      throw new NotFoundException('Servicio no encontrado.');
    }
    return service;
  }

  async findByFolio(folio: string) {
    const service = await this.serviceRepo.findOne({
      where: { folio, isActive: true },
    });
    if (!service) {
      throw new NotFoundException('Servicio no encontrado.');
    }
    return service;
  }

  async search(params: {
    search?: string;
    status?: ServiceStatus;
    branchName?: string;
    fromDate?: string;
    toDate?: string;
    page?: number;
    limit?: number;
  }) {
    const { search, status, branchName, fromDate, toDate } = params;
    const page = Number(params.page) || 1;
    const limit = Number(params.limit) || 10;

    const qb = this.serviceRepo
      .createQueryBuilder('s')
      .leftJoinAndSelect('s.patient', 'p')
      .leftJoinAndSelect('s.doctor', 'd')
      .leftJoinAndSelect('s.items', 'i')
      .where('s.isActive = :active', { active: true })
      .distinct(true);

    if (status) {
      qb.andWhere('s.status = :status', { status });
    }

    if (branchName && branchName !== 'all') {
      qb.andWhere('s.branchName = :branchName', { branchName });
    }

    if (fromDate) {
      qb.andWhere('s.createdAt >= :from', {
        from: new Date(fromDate),
      });
    }

    if (toDate) {
      const endDate = new Date(toDate);
      endDate.setHours(23, 59, 59, 999);
      qb.andWhere('s.createdAt <= :to', {
        to: endDate,
      });
    }

    const normalizedSearch = this.normalizeSearchValue(search ?? '');
    if (normalizedSearch) {
      qb.andWhere(
        `(
          ${this.buildNormalizedSql('s.folio')} LIKE :normalizedSearch
          OR ${this.buildNormalizedSql(
            "concat_ws(' ', p.firstName, p.lastName, p.middleName)",
          )} LIKE :normalizedSearch
          OR ${this.buildNormalizedSql('i.studyNameSnapshot')} LIKE :normalizedSearch
        )`,
        { normalizedSearch: `%${normalizedSearch}%` },
      );
    }

    qb.orderBy('s.createdAt', 'DESC')
      .skip((page - 1) * limit)
      .take(limit);

    const [data, total] = await qb.getManyAndCount();

    return {
      data,
      meta: {
        page,
        limit,
        total,
      },
    };
  }

  async update(id: number, dto: UpdateServiceDto) {
    const service = await this.findOne(id);

    if (dto.patientId && dto.patientId !== service.patientId) {
      await this.findActivePatientOrFail(
        dto.patientId,
        'El nuevo paciente no existe o esta inactivo.',
      );
    }

    if (dto.doctorId && dto.doctorId !== service.doctorId) {
      await this.findActiveDoctorOrFail(
        dto.doctorId,
        'El nuevo medico no existe o esta inactivo.',
      );
    }

    let subtotal = Number(service.subtotalAmount);
    let nextItems = service.items;
    let removedItemIds: number[] = [];

    if (dto.items) {
      const preparedItems = await this.buildServiceItems(dto.items);
      subtotal = preparedItems.subtotal;
      const reconciliation = this.reconcileServiceItems(
        service.items ?? [],
        preparedItems.items,
      );
      nextItems = reconciliation.items;
      removedItemIds = reconciliation.removedItemIds;
    }

    const nextCourtesyPercent =
      dto.courtesyPercent !== undefined
        ? Number(dto.courtesyPercent)
        : Number(service.courtesyPercent);
    const { discountAmount, totalAmount } = this.calculateTotals(
      subtotal,
      nextCourtesyPercent,
    );

    const manualFolio = this.normalizeServiceFolio(dto.folio);
    const useAutoFolio = dto.autoGenerateFolio ?? false;

    if (!useAutoFolio && manualFolio && manualFolio !== service.folio) {
      const existing = await this.serviceRepo.findOne({
        where: { folio: manualFolio },
      });

      if (existing && existing.id !== service.id) {
        throw new ConflictException('Ya existe otro servicio con este folio.');
      }
    }

    const saveService = async (folio: string) => {
      const savedId = await this.serviceRepo.manager.transaction(
        async (manager) => {
          const transactionalServiceRepo = manager.getRepository(ServiceOrder);
          const transactionalItemRepo = manager.getRepository(ServiceOrderItem);

          const merged = transactionalServiceRepo.merge(service, {
            folio,
            patientId: dto.patientId ?? service.patientId,
            doctorId:
              dto.doctorId !== undefined ? dto.doctorId : service.doctorId,
            branchName: dto.branchName ?? service.branchName,
            sampleAt: dto.sampleAt ? new Date(dto.sampleAt) : service.sampleAt,
            deliveryAt: dto.deliveryAt
              ? new Date(dto.deliveryAt)
              : service.deliveryAt,
            status: dto.status ?? service.status,
            completedAt:
              dto.status === ServiceStatus.COMPLETED
                ? (service.completedAt ?? new Date())
                : dto.status
                  ? undefined
                  : service.completedAt,
            courtesyPercent: nextCourtesyPercent,
            subtotalAmount: subtotal,
            discountAmount,
            totalAmount,
            notes: dto.notes ?? service.notes,
            items: nextItems,
          });

          const saved = await transactionalServiceRepo.save(merged);

          if (removedItemIds.length > 0) {
            await transactionalItemRepo.delete({ id: In(removedItemIds) });
          }

          return saved.id;
        },
      );

      return this.findOne(savedId);
    };

    if (!useAutoFolio) {
      try {
        return await saveService(manualFolio ?? service.folio);
      } catch (error) {
        if (this.isUniqueConstraintError(error)) {
          throw new ConflictException(
            'Ya existe otro servicio con este folio.',
          );
        }
        throw error;
      }
    }

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const nextFolio = await this.getNextAutoServiceFolio();

      try {
        return await saveService(nextFolio);
      } catch (error) {
        if (!this.isUniqueConstraintError(error)) {
          throw error;
        }
      }
    }

    throw new ConflictException(
      'No se pudo generar un folio automatico. Intenta de nuevo.',
    );
  }

  async updateStatus(id: number, dto: UpdateServiceStatusDto) {
    const service = await this.findOne(id);
    service.status = dto.status;
    service.completedAt =
      dto.status === ServiceStatus.COMPLETED
        ? (service.completedAt ?? new Date())
        : undefined;
    return this.serviceRepo.save(service);
  }

  async softDelete(id: number) {
    const service = await this.findOne(id);
    service.isActive = false;
    await this.serviceRepo.save(service);
    return { message: 'Servicio desactivado correctamente.' };
  }

  async hardDelete(id: number) {
    const result = await this.serviceRepo.delete({ id });
    if (result.affected === 0) {
      throw new NotFoundException('Servicio no encontrado.');
    }
    return { message: 'Servicio eliminado definitivamente.' };
  }

  async generateReceiptPdf(id: number) {
    const service = await this.findOne(id);
    return this.buildReceiptPdfBuffer(service);
  }

  async generateTubeLabelsPdf(id: number) {
    const service = await this.findOne(id);
    return this.buildLabelsPdfBuffer(service);
  }

  async generateTicketPdf(id: number) {
    const service = await this.findOne(id);
    return this.buildTicketPdfBuffer(service);
  }

  async exportCsv() {
    const services = await this.serviceRepo.find({
      where: { isActive: true },
      order: { createdAt: 'DESC' },
    });

    return toCsv(
      [
        'folio',
        'patientId',
        'patientName',
        'doctorId',
        'doctorName',
        'branchName',
        'sampleAt',
        'deliveryAt',
        'completedAt',
        'status',
        'courtesyPercent',
        'subtotalAmount',
        'discountAmount',
        'totalAmount',
        'notes',
        'items',
        'createdAt',
      ],
      services.map((service) => [
        service.folio,
        service.patientId,
        service.patient
          ? `${service.patient.firstName} ${service.patient.lastName} ${service.patient.middleName ?? ''}`.trim()
          : '',
        service.doctorId ?? '',
        service.doctor
          ? `${service.doctor.firstName} ${service.doctor.lastName} ${service.doctor.middleName ?? ''}`.trim()
          : '',
        service.branchName,
        service.sampleAt?.toISOString() ?? '',
        service.deliveryAt?.toISOString() ?? '',
        service.completedAt?.toISOString() ?? '',
        service.status,
        service.courtesyPercent,
        service.subtotalAmount,
        service.discountAmount,
        service.totalAmount,
        service.notes,
        (service.items ?? [])
          .map(
            (item) =>
              `${item.studyId}:${item.studyNameSnapshot}:${item.quantity}:${item.priceType}:${item.unitPrice}:${item.discountPercent}:${item.subtotalAmount}:${item.sourcePackageId ?? ''}:${item.sourcePackageNameSnapshot ?? ''}`,
          )
          .join(' | '),
        service.createdAt?.toISOString() ?? '',
      ]),
    );
  }
}
