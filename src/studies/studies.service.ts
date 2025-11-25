import {Injectable, ConflictException, NotFoundException,} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Like } from 'typeorm';
import { Study, StudyStatus, StudyType } from './entities/study.entity';
import { StudyDetail } from './entities/study-detail.entity';
import { CreateStudyDto } from './dto/create-study.dto';
import { UpdateStudyDto } from './dto/update-study.dto';
import { CreateStudyDetailDto } from './dto/create-study-detail.dto';
import { UpdateStudyDetailDto } from './dto/update-study-detail.dto';

@Injectable()
export class StudiesService {
  constructor(
    @InjectRepository(Study)
    private readonly studyRepo: Repository<Study>,
    @InjectRepository(StudyDetail)
    private readonly detailRepo: Repository<StudyDetail>,
  ) {}

  /**
   * Búsqueda de estudios / paquetes
   */
  async search(
    search: string,
    type?: StudyType,
    status?: StudyStatus,
    page = 1,
    limit = 10,
  ) {
    const base: any = { isActive: true };
    if (type) base.type = type;
    if (status) base.status = status;

    let where: any;

    if (search) {
      where = [
        { ...base, name: Like(`%${search}%`) },
        { ...base, code: Like(`%${search}%`) },
      ];
    } else {
      where = base;
    }

    const [data, total] = await this.studyRepo.findAndCount({
      where,
      take: limit,
      skip: (page - 1) * limit,
      order: { name: 'ASC' },
    });

    return {
      data,
      meta: {
        page,
        limit,
        total,
      },
    };
  }

  /**
   * Verificar existencia por clave
   */
  async existsByCode(code: string) {
    const study = await this.studyRepo.findOne({
      where: { code, isActive: true },
      select: ['id'],
    });
    return { exists: !!study, studyId: study?.id ?? null };
  }

  /**
   * Crear estudio
   */
  async create(dto: CreateStudyDto) {
    const existing = await this.studyRepo.findOne({
      where: { code: dto.code },
    });

    if (existing) {
      throw new ConflictException('Ya existe un estudio con esta clave.');
    }

    const entity = this.studyRepo.create({
      ...dto,
      normalPrice: dto.normalPrice,
      difPrice: dto.difPrice,
      specialPrice: dto.specialPrice,
      hospitalPrice: dto.hospitalPrice,
      otherPrice: dto.otherPrice,
      defaultDiscountPercent: dto.defaultDiscountPercent,
    });

    return this.studyRepo.save(entity);
  }

  /**
   * Obtener un estudio
   */
  async findOne(id: number) {
    const study = await this.studyRepo.findOne({
      where: { id, isActive: true },
    });
    if (!study) {
      throw new NotFoundException('Estudio no encontrado.');
    }
    return study;
  }

  /**
   * Actualizar estudio
   */
  async update(id: number, dto: UpdateStudyDto) {
    const study = await this.findOne(id);

    if (dto.code && dto.code !== study.code) {
      const existing = await this.studyRepo.findOne({
        where: { code: dto.code },
      });
      if (existing && existing.id !== id) {
        throw new ConflictException('Ya existe otro estudio con esta clave.');
      }
    }

    const merged = this.studyRepo.merge(study, {
      ...dto,
      normalPrice: dto.normalPrice ?? study.normalPrice,
      difPrice: dto.difPrice ?? study.difPrice,
      specialPrice: dto.specialPrice ?? study.specialPrice,
      hospitalPrice: dto.hospitalPrice ?? study.hospitalPrice,
      otherPrice: dto.otherPrice ?? study.otherPrice,
      defaultDiscountPercent:
        dto.defaultDiscountPercent ?? study.defaultDiscountPercent,
    });
    return this.studyRepo.save(merged);
  }

  /**
   * Baja lógica de estudio
   */
  async softDelete(id: number) {
    await this.findOne(id);
    await this.studyRepo.update({ id }, { isActive: false });
    return { message: 'Estudio desactivado correctamente.' };
  }

  /**
   * Eliminación física
   */
  async hardDelete(id: number) {
    const result = await this.studyRepo.delete({ id });

    if (result.affected === 0) {
      throw new NotFoundException('Estudio no encontrado.');
    }

    return { message: 'Estudio eliminado definitivamente de la base de datos.' };
  }

  // -------- DETALLES DE ESTUDIO --------

  /**
   * Listar detalles de un estudio (categorías y parámetros)
   */
  async listDetails(studyId: number) {
    await this.findOne(studyId);

    const details = await this.detailRepo.find({
      where: { studyId, isActive: true },
      order: { sortOrder: 'ASC' },
    });

    return details;
  }

  /**
   * Crear detalle para un estudio
   */
  async createDetail(studyId: number, dto: CreateStudyDetailDto) {
    await this.findOne(studyId);

    if (dto.parentId) {
      const parent = await this.detailRepo.findOne({
        where: { id: dto.parentId, studyId, isActive: true },
      });
      if (!parent) {
        throw new NotFoundException('El detalle padre no existe en este estudio.');
      }
    }

    const entity = this.detailRepo.create({
      ...dto,
      studyId,
    });

    return this.detailRepo.save(entity);
  }

  /**
   * Actualizar detalle
   */
  async updateDetail(detailId: number, dto: UpdateStudyDetailDto) {
    const detail = await this.detailRepo.findOne({
      where: { id: detailId, isActive: true },
    });
    if (!detail) {
      throw new NotFoundException('Detalle de estudio no encontrado.');
    }

    if (dto.parentId) {
      const parent = await this.detailRepo.findOne({
        where: { id: dto.parentId, studyId: detail.studyId, isActive: true },
      });
      if (!parent) {
        throw new NotFoundException('El detalle padre no existe en este estudio.');
      }
    }

    const merged = this.detailRepo.merge(detail, dto);
    return this.detailRepo.save(merged);
  }

  /**
   * Baja lógica de un detalle
   */
  async softDeleteDetail(detailId: number) {
    const detail = await this.detailRepo.findOne({
      where: { id: detailId, isActive: true },
    });
    if (!detail) {
      throw new NotFoundException('Detalle de estudio no encontrado.');
    }
    await this.detailRepo.update({ id: detailId }, { isActive: false });
    return { message: 'Detalle de estudio desactivado correctamente.' };
  }

  /**
   * Eliminación física de un detalle
   */
  async hardDeleteDetail(detailId: number) {
    const result = await this.detailRepo.delete({ id: detailId });

    if (result.affected === 0) {
      throw new NotFoundException('Detalle de estudio no encontrado.');
    }

    return { message: 'Detalle de estudio eliminado definitivamente.' };
  }
}
