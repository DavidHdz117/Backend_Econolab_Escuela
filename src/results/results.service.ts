import { Injectable, NotFoundException, BadRequestException, } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  ServiceOrder,
  ServiceOrderItem,
} from '../services/entities/service-order.entity';
import { StudyDetail } from '../studies/entities/study-detail.entity';
import { StudyResult, StudyResultValue } from './entities/study-result.entity';
import { CreateStudyResultDto } from './dto/create-study-result.dto';
import { UpdateStudyResultDto } from './dto/update-study-result.dto';
import { StudyResultValueDto } from './dto/study-result-value.dto';

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

    // Traemos los detalles configurados del estudio (GLUCOSA, UREA, etc.)
    const details = await this.detailRepo.find({
      where: { studyId: item.studyId, isActive: true },
      order: { sortOrder: 'ASC' },
    });

    const values = details.map((d) =>
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
