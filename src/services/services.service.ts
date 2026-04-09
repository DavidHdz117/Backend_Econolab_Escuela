import {
  BadRequestException,
  ConflictException,
  Injectable,
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
import { Patient } from '../patients/entities/patient.entity';
import { Doctor } from '../doctors/entities/doctor.entity';
import { Study, StudyStatus, StudyType } from '../studies/entities/study.entity';
import PDFDocument from 'pdfkit';
import fs from 'fs';
import * as bwipjs from 'bwip-js';
import { toCsv } from 'src/common/utils/csv.util';

const AUTO_SERVICE_FOLIO_PREFIX = 'ECO';
const AUTO_SEQUENCE_PAD = 4;

@Injectable()
export class ServicesService {
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

  private extractAutoSequenceValue(value: string | null | undefined, date = new Date()) {
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

  private isUniqueConstraintError(error: unknown) {
    if (!(error instanceof QueryFailedError)) {
      return false;
    }

    const driverError = (error as QueryFailedError & {
      driverError?: { code?: string; errno?: number };
    }).driverError;

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
    const labName = process.env.LAB_NAME ?? 'ECONOLAB';
    const labSubtitle =
      process.env.LAB_SUBTITLE ?? 'LABORATORIO DE ANALISIS CLINICOS';
    const labAddress = process.env.LAB_ADDRESS ?? '';
    const labAddress2 = process.env.LAB_ADDRESS_2 ?? '';
    const labPhone = process.env.LAB_PHONE ?? '';
    const labEmail = process.env.LAB_EMAIL ?? '';
    const logoPath = process.env.LAB_LOGO_PATH ?? '';

    const patient = service.patient;
    const doctor = service.doctor;
    const barcodeText = service.folio ?? String(service.id);
    const barcodeBuffer = await this.buildBarcodeBuffer(barcodeText, 12);

    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ margin: 40, size: 'A4' });
      const chunks: Buffer[] = [];

      doc.on('data', (chunk) => chunks.push(chunk));
      doc.on('error', (err) => reject(err));
      doc.on('end', () => resolve(Buffer.concat(chunks)));

      const headerTop = doc.y;
      if (logoPath && fs.existsSync(logoPath)) {
        doc.image(logoPath, 40, headerTop, {
          fit: [90, 50],
        });
      }

      doc
        .font('Helvetica-Bold')
        .fontSize(12)
        .text(labName, 140, headerTop, { align: 'center' });
      doc
        .font('Helvetica')
        .fontSize(8)
        .text(labSubtitle, 140, headerTop + 14, { align: 'center' })
        .text(labAddress, 140, headerTop + 26, { align: 'center' })
        .text(labAddress2, 140, headerTop + 36, { align: 'center' });

      doc
        .font('Helvetica-Bold')
        .fontSize(9)
        .text(`FOLIO: ${service.folio ?? 'N/D'}`, 380, headerTop, {
          align: 'right',
        })
        .text(`SUC: ${service.branchName ?? 'N/D'}`, 380, headerTop + 12, {
          align: 'right',
        });

      if (barcodeBuffer) {
        doc.image(barcodeBuffer, 420, headerTop + 26, {
          width: 130,
          height: 32,
        });
      }

      doc.moveDown(3.2);
      doc.moveTo(40, doc.y).lineTo(555, doc.y).strokeColor('#bbbbbb').stroke();
      doc.moveDown(0.8);

      doc.font('Helvetica-Bold').fontSize(9).text('PACIENTE');
      doc
        .font('Helvetica')
        .fontSize(9)
        .text(
          `Nombre: ${patient ? `${patient.firstName} ${patient.lastName} ${patient.middleName ?? ''}`.trim() : 'N/D'}`,
        )
        .text(`Edad: ${this.calcAge(patient?.birthDate)}`)
        .text(`Sexo: ${patient?.gender ?? 'N/D'}`)
        .text(`Tel: ${patient?.phone ?? 'N/D'}`)
        .text(`Direccion: ${patient?.addressLine ?? 'N/D'}`);

      doc.moveDown(0.4);
      doc.font('Helvetica-Bold').fontSize(9).text('ORDEN');
      doc
        .font('Helvetica')
        .fontSize(9)
        .text(`Fecha: ${this.formatDate(service.createdAt)}`)
        .text(`Toma de muestra: ${this.formatDate(service.sampleAt)}`)
        .text(`Entrega: ${this.formatDate(service.deliveryAt)}`)
        .text(
          `Doctor: ${doctor ? `${doctor.firstName} ${doctor.lastName} ${doctor.middleName ?? ''}`.trim() : 'N/D'}`,
        )
        .text(`Cedula: ${doctor?.licenseNumber ?? 'N/D'}`);

      doc.moveDown(0.8);
      doc.moveTo(40, doc.y).lineTo(555, doc.y).strokeColor('#bbbbbb').stroke();
      doc.moveDown(0.6);

      const colX = { name: 40, type: 300, price: 380, discount: 450, total: 510 };
      doc
        .font('Helvetica-Bold')
        .fontSize(9)
        .text('ANALISIS CLINICO', colX.name, doc.y)
        .text('TP', colX.type, doc.y)
        .text('PRECIO', colX.price, doc.y)
        .text('DESC.', colX.discount, doc.y)
        .text('TOTAL', colX.total, doc.y);

      doc.moveDown(0.4);
      doc.moveTo(40, doc.y).lineTo(555, doc.y).strokeColor('#cccccc').stroke();
      doc.moveDown(0.4);

      doc.font('Helvetica').fontSize(9);
      for (const item of service.items ?? []) {
        const lineTotal = Number(item.subtotalAmount ?? 0);
        doc.text(this.truncate(item.studyNameSnapshot ?? ''), colX.name, doc.y, {
          width: 240,
        });
        doc.text(this.mapPriceTypeLabel(item.priceType), colX.type, doc.y);
        doc.text(this.formatMoney(Number(item.unitPrice ?? 0)), colX.price, doc.y, {
          width: 60,
          align: 'right',
        });
        doc.text(`${Number(item.discountPercent ?? 0)} %`, colX.discount, doc.y, {
          width: 50,
          align: 'right',
        });
        doc.text(this.formatMoney(lineTotal), colX.total, doc.y, {
          width: 60,
          align: 'right',
        });
        doc.moveDown(0.6);
      }

      doc.moveDown(0.4);
      doc.moveTo(340, doc.y).lineTo(555, doc.y).strokeColor('#bbbbbb').stroke();
      doc.moveDown(0.4);

      const subtotal = Number(service.subtotalAmount ?? 0);
      const courtesy = Number(service.courtesyPercent ?? 0);
      const discount = Number(service.discountAmount ?? 0);
      const total = Number(service.totalAmount ?? 0);

      doc.font('Helvetica').fontSize(9);
      doc.text('SUBTOTAL:', 380, doc.y, { align: 'right' });
      doc.text(this.formatMoney(subtotal), 510, doc.y, { align: 'right' });
      doc.moveDown(0.4);
      doc.text('CORTESIA:', 380, doc.y, { align: 'right' });
      doc.text(`${courtesy} %`, 510, doc.y, { align: 'right' });
      doc.moveDown(0.4);
      doc.text('DESC. TOTAL:', 380, doc.y, { align: 'right' });
      doc.text(this.formatMoney(discount), 510, doc.y, { align: 'right' });
      doc.moveDown(0.4);
      doc.font('Helvetica-Bold').text('TOTAL:', 380, doc.y, { align: 'right' });
      doc.text(this.formatMoney(total), 510, doc.y, { align: 'right' });
      doc.moveDown(1.2);

      if (labPhone || labEmail) {
        doc
          .font('Helvetica')
          .fontSize(8)
          .text(`Tel: ${labPhone}`, 40, doc.y)
          .text(`Email: ${labEmail}`, 40, doc.y + 10);
      }

      doc.end();
    });
  }

  private async buildTicketPdfBuffer(service: ServiceOrder): Promise<Buffer> {
    const labName = process.env.LAB_NAME ?? 'ECONOLAB';
    const patientName = service.patient
      ? `${service.patient.firstName} ${service.patient.lastName} ${service.patient.middleName ?? ''}`.trim()
      : 'N/D';
    const barcodeBuffer = await this.buildBarcodeBuffer(
      service.folio ?? String(service.id),
      10,
      2,
    );

    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ margin: 18, size: [226, 520] });
      const chunks: Buffer[] = [];

      doc.on('data', (chunk) => chunks.push(chunk));
      doc.on('error', (err) => reject(err));
      doc.on('end', () => resolve(Buffer.concat(chunks)));

      doc.font('Helvetica-Bold').fontSize(12).text(labName, {
        align: 'center',
      });
      doc.font('Helvetica').fontSize(8).text('Ticket de servicio', {
        align: 'center',
      });
      doc.moveDown(0.7);

      doc.font('Helvetica-Bold').fontSize(9);
      doc.text(`Folio: ${service.folio}`);
      doc.font('Helvetica').fontSize(8);
      doc.text(`Paciente: ${patientName}`);
      doc.text(`Sucursal: ${service.branchName ?? 'N/D'}`);
      doc.text(`Creado: ${this.formatDate(service.createdAt)}`);
      doc.text(`Entrega: ${this.formatDate(service.deliveryAt)}`);
      doc.moveDown(0.7);

      if (barcodeBuffer) {
        doc.image(barcodeBuffer, 34, doc.y, { width: 140, height: 26 });
        doc.moveDown(2.2);
      }

      doc.moveTo(18, doc.y).lineTo(208, doc.y).strokeColor('#cccccc').stroke();
      doc.moveDown(0.6);

      doc.font('Helvetica-Bold').fontSize(8).text('ESTUDIO', 18, doc.y);
      doc.text('TOTAL', 160, doc.y, { width: 48, align: 'right' });
      doc.moveDown(0.4);
      doc.font('Helvetica').fontSize(8);

      for (const item of service.items ?? []) {
        doc.text(this.truncate(item.studyNameSnapshot ?? '', 24), 18, doc.y, {
          width: 130,
        });
        doc.text(this.formatMoney(Number(item.subtotalAmount ?? 0)), 160, doc.y, {
          width: 48,
          align: 'right',
        });
        doc.moveDown(0.5);
      }

      doc.moveDown(0.4);
      doc.moveTo(18, doc.y).lineTo(208, doc.y).strokeColor('#cccccc').stroke();
      doc.moveDown(0.6);

      doc.text(`Subtotal: ${this.formatMoney(Number(service.subtotalAmount ?? 0))}`);
      doc.text(`Cortesia: ${Number(service.courtesyPercent ?? 0)} %`);
      doc.text(`Descuento: ${this.formatMoney(Number(service.discountAmount ?? 0))}`);
      doc
        .font('Helvetica-Bold')
        .text(`Total: ${this.formatMoney(Number(service.totalAmount ?? 0))}`);
      doc.moveDown(1);
      doc.font('Helvetica').fontSize(7).text(
        'Documento informativo generado desde el sistema.',
        {
          align: 'center',
        },
      );

      doc.end();
    });
  }

  private async buildLabelsPdfBuffer(service: ServiceOrder): Promise<Buffer> {
    const labName = process.env.LAB_NAME ?? 'ECONOLAB';
    const patient = service.patient;
    const sampleAt = service.sampleAt ?? service.createdAt;

    const studyIds = [...new Set((service.items ?? []).map((item) => item.studyId))];
    const studies = studyIds.length
      ? await this.studyRepo.findBy({ id: In(studyIds) })
      : [];
    const studyMap = new Map<number, Study>();
    studies.forEach((s) => studyMap.set(s.id, s));

    const labels: Array<{ item: ServiceOrderItem; barcode: string; studyCode: string }> = [];
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

        doc
          .font('Helvetica-Bold')
          .fontSize(7)
          .text(labName, x + 4, y + 4, { width: labelWidth - 8 });

        doc
          .font('Helvetica-Bold')
          .fontSize(8)
          .text(this.truncate(patientName, 28), x + 4, y + 14, {
            width: labelWidth - 8,
          });

        doc
          .font('Helvetica')
          .fontSize(7)
          .text(`Sexo: ${patient?.gender ?? 'N/D'}  Edad: ${this.calcAge(patient?.birthDate)}`, x + 4, y + 24, {
            width: labelWidth - 8,
          });

        doc
          .font('Helvetica')
          .fontSize(7)
          .text(`Estudio: ${this.truncate(item.studyNameSnapshot ?? studyCode, 26)}`, x + 4, y + 34, {
            width: labelWidth - 8,
          });

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

        const componentStudies = await this.studyRepo.findBy({ id: In(componentIds) });
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
      const savedId = await this.serviceRepo.manager.transaction(async (manager) => {
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
              ? service.completedAt ?? new Date()
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
      });

      return this.findOne(savedId);
    };

    if (!useAutoFolio) {
      try {
        return await saveService(manualFolio ?? service.folio);
      } catch (error) {
        if (this.isUniqueConstraintError(error)) {
          throw new ConflictException('Ya existe otro servicio con este folio.');
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
        ? service.completedAt ?? new Date()
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
