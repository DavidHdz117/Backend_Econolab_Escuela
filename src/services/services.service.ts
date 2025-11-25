import { Injectable, NotFoundException, BadRequestException,} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {ServiceOrder, ServiceOrderItem, ServiceItemPriceType, ServiceStatus,} from './entities/service-order.entity';
import { CreateServiceDto } from './dto/create-service.dto';
import { UpdateServiceDto } from './dto/update-service.dto';
import { UpdateServiceStatusDto } from './dto/update-service-status.dto';
import { Patient } from '../patients/entities/patient.entity';
import { Doctor } from '../doctors/entities/doctor.entity';
import { Study } from '../studies/entities/study.entity';

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
  ) { }

  // --------- Helpers ---------

  private getPriceByType(study: Study, type: ServiceItemPriceType): number {
    switch (type) {
      case ServiceItemPriceType.DIF:
        return study.difPrice;
      case ServiceItemPriceType.SPECIAL:
        return study.specialPrice;
      case ServiceItemPriceType.HOSPITAL:
        return study.hospitalPrice;
      case ServiceItemPriceType.OTHER:
        return study.otherPrice;
      case ServiceItemPriceType.NORMAL:
      default:
        return study.normalPrice;
    }
  }

  // --------- CRUD principal ---------

  async create(dto: CreateServiceDto) {
    const patient = await this.patientRepo.findOne({
      where: { id: dto.patientId, isActive: true },
    });
    if (!patient) {
      throw new NotFoundException('El paciente no existe o está inactivo.');
    }

    let doctor: Doctor | null = null;
    if (dto.doctorId) {
      doctor = await this.doctorRepo.findOne({
        where: { id: dto.doctorId, isActive: true },
      });
      if (!doctor) {
        throw new NotFoundException('El médico no existe o está inactivo.');
      }
    }

    if (!dto.items || dto.items.length === 0) {
      throw new BadRequestException(
        'Debe agregar al menos un análisis al servicio.',
      );
    }

    // Cargamos todos los estudios involucrados
    const studyIds = dto.items.map((i) => i.studyId);
    const studies = await this.studyRepo.findByIds(studyIds);
    if (studies.length !== studyIds.length) {
      throw new NotFoundException(
        'Uno o más estudios no existen o están inactivos.',
      );
    }

    const studyMap = new Map<number, Study>();
    studies.forEach((s) => studyMap.set(s.id, s));

    const items: ServiceOrderItem[] = [];

    let subtotal = 0;

    for (const itemDto of dto.items) {
      const study = studyMap.get(itemDto.studyId)!;
      const unitPrice = this.getPriceByType(study, itemDto.priceType);
      const quantity = itemDto.quantity;
      const itemDiscount = itemDto.discountPercent ?? 0;

      const lineBase = unitPrice * quantity;
      const lineSubtotal = lineBase * (1 - itemDiscount / 100);

      subtotal += lineSubtotal;

      const item = this.itemRepo.create({
        studyId: study.id,
        studyNameSnapshot: study.name,
        priceType: itemDto.priceType,
        unitPrice,
        quantity,
        discountPercent: itemDiscount,
        subtotalAmount: lineSubtotal,
      });

      items.push(item);
    }

    const courtesyPercent = dto.courtesyPercent ?? 0;
    const discountAmount = subtotal * (courtesyPercent / 100);
    const total = subtotal - discountAmount;

    const service = this.serviceRepo.create({
      folio: dto.folio,
      patientId: dto.patientId,
      doctorId: dto.doctorId,
      branchName: dto.branchName,
      sampleAt: dto.sampleAt ? new Date(dto.sampleAt) : undefined,
      deliveryAt: dto.deliveryAt ? new Date(dto.deliveryAt) : undefined,
      status: dto.status ?? ServiceStatus.PENDING,
      courtesyPercent,
      subtotalAmount: subtotal,
      discountAmount,
      totalAmount: total,
      notes: dto.notes,
      items,
    });

    return this.serviceRepo.save(service);
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

  /**
   * Búsqueda paginada de servicios
   * Filtros: texto (folio, nombre paciente), estatus y rango de fechas de creación.
   */
  async search(params: {
    search?: string;
    status?: ServiceStatus;
    fromDate?: string;
    toDate?: string;
    page?: number;
    limit?: number;
  }) {
    const { search, status, fromDate, toDate } = params;
    const page = Number(params.page) || 1;
    const limit = Number(params.limit) || 10;

    const qb = this.serviceRepo
      .createQueryBuilder('s')
      .leftJoinAndSelect('s.patient', 'p')
      .leftJoinAndSelect('s.doctor', 'd')
      .leftJoinAndSelect('s.items', 'i')
      .where('s.isActive = :active', { active: true });

    if (status) {
      qb.andWhere('s.status = :status', { status });
    }

    if (fromDate && toDate) {
      qb.andWhere('s.createdAt BETWEEN :from AND :to', {
        from: new Date(fromDate),
        to: new Date(toDate),
      });
    }

    if (search) {
      qb.andWhere(
        '(s.folio LIKE :q OR p.firstName LIKE :q OR p.lastName LIKE :q)',
        { q: `%${search}%` },
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

    // Por simplicidad, aquí no recalculamos todos los ítems.
    // Si quieres soportar edición completa (cambiar estudios, etc.)
    // podemos hacer una función similar a create que reemplace items.
    if (dto.patientId && dto.patientId !== service.patientId) {
      const patient = await this.patientRepo.findOne({
        where: { id: dto.patientId, isActive: true },
      });
      if (!patient) {
        throw new NotFoundException('El nuevo paciente no existe o está inactivo.');
      }
    }

    if (dto.doctorId && dto.doctorId !== service.doctorId) {
      const doctor = await this.doctorRepo.findOne({
        where: { id: dto.doctorId, isActive: true },
      });
      if (!doctor) {
        throw new NotFoundException('El nuevo médico no existe o está inactivo.');
      }
    }

    const merged = this.serviceRepo.merge(service, {
      folio: dto.folio ?? service.folio,
      patientId: dto.patientId ?? service.patientId,
      doctorId: dto.doctorId ?? service.doctorId,
      branchName: dto.branchName ?? service.branchName,
      sampleAt: dto.sampleAt ? new Date(dto.sampleAt) : service.sampleAt,
      deliveryAt: dto.deliveryAt ? new Date(dto.deliveryAt) : service.deliveryAt,
      status: dto.status ?? service.status,
      courtesyPercent: dto.courtesyPercent ?? service.courtesyPercent,
      notes: dto.notes ?? service.notes,
      // Totales: podrías recalcular aquí si cambias cortesía
    });

    // Si solo cambió cortesía, ajustamos totales sin tocar los ítems
    if (dto.courtesyPercent !== undefined) {
      const subtotal = merged.subtotalAmount;
      const discount = subtotal * (merged.courtesyPercent / 100);
      merged.discountAmount = discount;
      merged.totalAmount = subtotal - discount;
    }

    return this.serviceRepo.save(merged);
  }

  async updateStatus(id: number, dto: UpdateServiceStatusDto) {
    const service = await this.findOne(id);
    service.status = dto.status;
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
}
