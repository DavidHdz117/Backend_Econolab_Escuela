import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Like, QueryFailedError, Repository } from 'typeorm';
import {
  ImportPreviewResult,
  ImportPreviewRow,
  ImportPreviewSummary,
} from 'src/common/import/import-preview.types';
import { parseCsv, toCsv } from 'src/common/utils/csv.util';
import { CreateStudyDetailDto } from './dto/create-study-detail.dto';
import { CreateStudyDto } from './dto/create-study.dto';
import { UpdateStudyDetailStatusDto } from './dto/update-study-detail-status.dto';
import { UpdateStudyDetailDto } from './dto/update-study-detail.dto';
import { UpdateStudyDto } from './dto/update-study.dto';
import { StudyDetail, StudyDetailType } from './entities/study-detail.entity';
import { Study, StudyStatus, StudyType } from './entities/study.entity';
import { EstimateStudyDto } from './dto/estimate-study.dto';
import { StudyEstimationModel } from './models/study-estimation.model';

type StudyImportOperation = {
  action: 'create' | 'update';
  payload: CreateStudyDto;
  existing?: Study | null;
};

type PublicStudiesQuery = {
  search?: string;
  type?: StudyType;
  limit?: number;
  includeDetails?: boolean;
};

const AUTO_SEQUENCE_PAD = 4;
const AUTO_STUDY_CODE_PREFIX: Record<StudyType, string> = {
  [StudyType.STUDY]: 'EST',
  [StudyType.PACKAGE]: 'PAQ',
  [StudyType.OTHER]: 'OTR',
};

@Injectable()
export class StudiesService {
  constructor(
    @InjectRepository(Study)
    private readonly studyRepo: Repository<Study>,
    @InjectRepository(StudyDetail)
    private readonly detailRepo: Repository<StudyDetail>,
    private readonly studyEstimationModel: StudyEstimationModel,
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

  private buildAutoStudyCode(
    type: StudyType,
    sequence: number,
    date = new Date(),
  ) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${AUTO_STUDY_CODE_PREFIX[type]}${y}${m}${d}${String(sequence).padStart(AUTO_SEQUENCE_PAD, '0')}`;
  }

  private extractAutoSequenceValue(
    value: string | null | undefined,
    type: StudyType,
    date = new Date(),
  ) {
    if (!value) return 0;

    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    const dateToken = `${y}${m}${d}`;
    const match = new RegExp(
      `^${AUTO_STUDY_CODE_PREFIX[type]}${dateToken}(\\d{${AUTO_SEQUENCE_PAD}})$`,
      'i',
    ).exec(value.trim());

    return match ? Number(match[1]) : 0;
  }

  private isUniqueConstraintError(error: unknown) {
    if (!(error instanceof QueryFailedError)) {
      return false;
    }

    const driverError = (
      error as QueryFailedError & {
        driverError?: { code?: string };
      }
    ).driverError;

    return driverError?.code === '23505';
  }

  private async getNextAutoStudyCode(type: StudyType, date = new Date()) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    const prefix = `${AUTO_STUDY_CODE_PREFIX[type]}${y}${m}${d}%`;

    const latest = await this.studyRepo
      .createQueryBuilder('study')
      .where('study.code LIKE :prefix', { prefix })
      .orderBy('study.code', 'DESC')
      .getOne();

    const nextSequence =
      this.extractAutoSequenceValue(latest?.code, type, date) + 1;
    return this.buildAutoStudyCode(type, nextSequence, date);
  }

  private normalizeStudyCode(code?: string | null) {
    const normalized = code?.trim().toUpperCase();
    return normalized ? normalized : null;
  }

  private async findDuplicateStudyByName(
    name: string,
    type: StudyType,
    excludeId?: number,
  ) {
    const normalizedName = this.normalizeSearchValue(name);
    if (!normalizedName) {
      return null;
    }

    const qb = this.studyRepo
      .createQueryBuilder('study')
      .where('study.type = :type', { type })
      .andWhere(`${this.buildNormalizedSql('study.name')} = :name`, {
        name: normalizedName,
      });

    if (excludeId) {
      qb.andWhere('study.id != :excludeId', { excludeId });
    }

    return qb.getOne();
  }

  private async assertNoDuplicateStudyName(
    name: string,
    type: StudyType,
    excludeId?: number,
  ) {
    const duplicate = await this.findDuplicateStudyByName(
      name,
      type,
      excludeId,
    );

    if (duplicate) {
      throw new ConflictException(
        'Ya existe otro registro con el mismo nombre dentro de este tipo.',
      );
    }
  }

  private async findActiveStudyOrFail(id: number) {
    const study = await this.studyRepo.findOne({
      where: { id, isActive: true },
    });

    if (!study) {
      throw new NotFoundException('Estudio no encontrado.');
    }

    return study;
  }

  private async findDetailOrFail(detailId: number, activeOnly = false) {
    const detail = await this.detailRepo.findOne({
      where: activeOnly ? { id: detailId, isActive: true } : { id: detailId },
    });

    if (!detail) {
      throw new NotFoundException('Detalle de estudio no encontrado.');
    }

    return detail;
  }

  private ensureStudyAllowsDirectDetails(study: Study, message: string) {
    if (study.type === StudyType.PACKAGE) {
      throw new BadRequestException(message);
    }
  }

  private async assertParentDetailExists(
    studyId: number,
    parentId?: number | null,
  ) {
    if (parentId === undefined || parentId === null) {
      return;
    }

    const parent = await this.detailRepo.findOne({
      where: { id: parentId, studyId, isActive: true },
    });

    if (!parent) {
      throw new NotFoundException(
        'El detalle padre no existe en este estudio.',
      );
    }
  }

  async getSuggestedCode(type: StudyType = StudyType.STUDY) {
    return { code: await this.getNextAutoStudyCode(type) };
  }

  /** Construye el dataset real y manda llamar al modelo de regresion. */
  async estimate(dto: EstimateStudyDto) {
    const studies = await this.studyRepo.find({
      where: [
        { isActive: true, status: StudyStatus.ACTIVE },
        {
          code: Like('MLTRAIN-%'),
          indicator: 'DATOS SINTETICOS',
        },
      ],
    });
    const studyIds = studies.map((study) => study.id);
    const parameterCounts = new Map<number, number>();

    if (studyIds.length > 0) {
      const details = await this.detailRepo.find({
        where: {
          studyId: In(studyIds),
          dataType: StudyDetailType.PARAMETER,
          isActive: true,
        },
      });

      for (const detail of details) {
        parameterCounts.set(
          detail.studyId,
          (parameterCounts.get(detail.studyId) ?? 0) + 1,
        );
      }
    }

    const dataset = studies.map((study) => ({
      type: study.type,
      parameterCount: parameterCounts.get(study.id) ?? 0,
      method: study.method,
      normalPrice: Number(study.normalPrice),
    }));

    // Aqui se manda llamar y se utiliza el modelo.
    return this.studyEstimationModel.predict(dto, dataset);
  }

  private async validatePackageStudyIds(
    packageStudyIds: number[] | undefined,
    currentStudyId?: number,
  ) {
    const normalizedIds = [...new Set((packageStudyIds ?? []).filter(Boolean))];

    if (currentStudyId && normalizedIds.includes(currentStudyId)) {
      throw new BadRequestException(
        'Un paquete no puede incluirse a si mismo.',
      );
    }

    if (normalizedIds.length === 0) {
      return [];
    }

    const studies = await this.studyRepo.findBy({ id: In(normalizedIds) });
    if (studies.length !== normalizedIds.length) {
      throw new NotFoundException('Uno o mas estudios del paquete no existen.');
    }

    const invalidStudy = studies.find(
      (study) =>
        !study.isActive ||
        study.status !== StudyStatus.ACTIVE ||
        study.type !== StudyType.STUDY,
    );

    if (invalidStudy) {
      throw new BadRequestException(
        'Los paquetes solo pueden incluir estudios individuales activos.',
      );
    }

    return normalizedIds;
  }

  async search(
    search: string,
    type?: StudyType,
    status?: StudyStatus,
    page = 1,
    limit = 10,
  ) {
    const qb = this.studyRepo
      .createQueryBuilder('study')
      .where('study.isActive = :isActive', { isActive: true })
      .orderBy('study.name', 'ASC')
      .skip((page - 1) * limit)
      .take(limit);

    if (type) {
      qb.andWhere('study.type = :type', { type });
    }

    if (status) {
      qb.andWhere('study.status = :status', { status });
    }

    const normalizedSearch = this.normalizeSearchValue(search);
    if (normalizedSearch) {
      const normalizedFields = [
        this.buildNormalizedSql('study.name'),
        this.buildNormalizedSql('study.code'),
        this.buildNormalizedSql('study.description'),
        this.buildNormalizedSql('study.method'),
        this.buildNormalizedSql('study.indicator'),
      ];

      qb.andWhere(
        `(${normalizedFields
          .map((field) => `${field} LIKE :search`)
          .join(' OR ')})`,
        { search: `%${normalizedSearch}%` },
      );
    }

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

  async existsByCode(code: string) {
    const normalizedCode = this.normalizeStudyCode(code);
    if (!normalizedCode) {
      return { exists: false, studyId: null };
    }

    const study = await this.studyRepo.findOne({
      where: { code: normalizedCode, isActive: true },
      select: ['id'],
    });
    return { exists: !!study, studyId: study?.id ?? null };
  }

  async create(dto: CreateStudyDto) {
    const packageStudyIds =
      dto.type === StudyType.PACKAGE
        ? await this.validatePackageStudyIds(dto.packageStudyIds)
        : [];
    await this.assertNoDuplicateStudyName(dto.name, dto.type);

    const manualCode = this.normalizeStudyCode(dto.code);
    const useAutoCode = dto.autoGenerateCode ?? false;

    if (!useAutoCode && !manualCode) {
      throw new BadRequestException(
        'La clave es obligatoria o activa la generacion automatica.',
      );
    }

    const saveStudy = async (code: string) => {
      const entity = this.studyRepo.create({
        ...dto,
        code,
        packageStudyIds,
        normalPrice: dto.normalPrice,
        difPrice: dto.difPrice,
        specialPrice: dto.specialPrice,
        hospitalPrice: dto.hospitalPrice,
        otherPrice: dto.otherPrice,
        defaultDiscountPercent: dto.defaultDiscountPercent,
      });

      return this.studyRepo.save(entity);
    };

    if (!useAutoCode && manualCode) {
      const existing = await this.studyRepo.findOne({
        where: { code: manualCode },
      });

      if (existing) {
        throw new ConflictException('Ya existe un estudio con esta clave.');
      }

      try {
        return await saveStudy(manualCode);
      } catch (error) {
        if (this.isUniqueConstraintError(error)) {
          throw new ConflictException('Ya existe un estudio con esta clave.');
        }

        throw error;
      }
    }

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const nextCode = await this.getNextAutoStudyCode(dto.type);

      try {
        return await saveStudy(nextCode);
      } catch (error) {
        if (!this.isUniqueConstraintError(error)) {
          throw error;
        }
      }
    }

    throw new ConflictException(
      'No se pudo generar una clave automatica. Intenta de nuevo.',
    );
  }

  async findOne(id: number) {
    return this.findActiveStudyOrFail(id);
  }

  async update(id: number, dto: UpdateStudyDto) {
    const study = await this.findOne(id);
    const nextType = dto.type ?? study.type;
    const nextName = dto.name ?? study.name;
    const manualCode = this.normalizeStudyCode(dto.code);
    const useAutoCode = dto.autoGenerateCode ?? false;

    await this.assertNoDuplicateStudyName(nextName, nextType, id);

    if (!useAutoCode && manualCode && manualCode !== study.code) {
      const existing = await this.studyRepo.findOne({
        where: { code: manualCode },
      });
      if (existing && existing.id !== id) {
        throw new ConflictException('Ya existe otro estudio con esta clave.');
      }
    }

    const packageStudyIds =
      nextType === StudyType.PACKAGE
        ? await this.validatePackageStudyIds(
            dto.packageStudyIds ?? study.packageStudyIds,
            id,
          )
        : [];

    const saveStudy = async (code: string) => {
      const merged = this.studyRepo.merge(study, {
        ...dto,
        code,
        packageStudyIds,
        normalPrice: dto.normalPrice ?? study.normalPrice,
        difPrice: dto.difPrice ?? study.difPrice,
        specialPrice: dto.specialPrice ?? study.specialPrice,
        hospitalPrice: dto.hospitalPrice ?? study.hospitalPrice,
        otherPrice: dto.otherPrice ?? study.otherPrice,
        defaultDiscountPercent:
          dto.defaultDiscountPercent ?? study.defaultDiscountPercent,
      });

      return this.studyRepo.save(merged);
    };

    if (!useAutoCode) {
      try {
        return await saveStudy(manualCode ?? study.code);
      } catch (error) {
        if (this.isUniqueConstraintError(error)) {
          throw new ConflictException('Ya existe otro estudio con esta clave.');
        }

        throw error;
      }
    }

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const nextCode = await this.getNextAutoStudyCode(nextType);

      try {
        return await saveStudy(nextCode);
      } catch (error) {
        if (!this.isUniqueConstraintError(error)) {
          throw error;
        }
      }
    }

    throw new ConflictException(
      'No se pudo generar una clave automatica. Intenta de nuevo.',
    );
  }

  async softDelete(id: number) {
    const study = await this.findOne(id);
    study.isActive = false;
    await this.studyRepo.save(study);
    return { message: 'Estudio desactivado correctamente.' };
  }

  async hardDelete(id: number) {
    const result = await this.studyRepo.delete({ id });

    if (result.affected === 0) {
      throw new NotFoundException('Estudio no encontrado.');
    }

    return {
      message: 'Estudio eliminado definitivamente de la base de datos.',
    };
  }

  async listDetails(studyId: number) {
    const study = await this.findOne(studyId);

    if (study.type === StudyType.PACKAGE) {
      return [];
    }

    return this.detailRepo.find({
      where: { studyId },
      order: { sortOrder: 'ASC', name: 'ASC' },
    });
  }

  async createDetail(studyId: number, dto: CreateStudyDetailDto) {
    const study = await this.findOne(studyId);
    this.ensureStudyAllowsDirectDetails(
      study,
      'Los paquetes no definen parametros directos. Agrega estudios al paquete.',
    );
    await this.assertParentDetailExists(studyId, dto.parentId);

    const entity = this.detailRepo.create({
      ...dto,
      studyId,
    });

    return this.detailRepo.save(entity);
  }

  async updateDetail(detailId: number, dto: UpdateStudyDetailDto) {
    const detail = await this.findDetailOrFail(detailId);
    const study = await this.findOne(detail.studyId);

    this.ensureStudyAllowsDirectDetails(
      study,
      'Los paquetes no administran parametros directos.',
    );

    if (dto.parentId !== undefined && dto.parentId === detail.id) {
      throw new BadRequestException(
        'Un detalle no puede depender de si mismo.',
      );
    }

    await this.assertParentDetailExists(detail.studyId, dto.parentId);

    const merged = this.detailRepo.merge(detail, dto);
    return this.detailRepo.save(merged);
  }

  async updateDetailStatus(detailId: number, dto: UpdateStudyDetailStatusDto) {
    const detail = await this.findDetailOrFail(detailId);

    if (detail.isActive === dto.isActive) {
      return detail;
    }

    detail.isActive = dto.isActive;
    return this.detailRepo.save(detail);
  }

  async softDeleteDetail(detailId: number) {
    const detail = await this.findDetailOrFail(detailId, true);
    detail.isActive = false;
    await this.detailRepo.save(detail);
    return { message: 'Detalle de estudio desactivado correctamente.' };
  }

  async hardDeleteDetail(detailId: number) {
    const result = await this.detailRepo.delete({ id: detailId });

    if (result.affected === 0) {
      throw new NotFoundException('Detalle de estudio no encontrado.');
    }

    return { message: 'Detalle de estudio eliminado definitivamente.' };
  }

  async exportCsv() {
    const studies = await this.studyRepo.find({
      where: { isActive: true },
      order: { name: 'ASC' },
    });

    return toCsv(
      [
        'name',
        'code',
        'description',
        'durationMinutes',
        'type',
        'normalPrice',
        'difPrice',
        'specialPrice',
        'hospitalPrice',
        'otherPrice',
        'defaultDiscountPercent',
        'method',
        'indicator',
        'packageStudyIds',
        'status',
      ],
      studies.map((study) => [
        study.name,
        study.code,
        study.description,
        study.durationMinutes,
        study.type,
        study.normalPrice,
        study.difPrice,
        study.specialPrice,
        study.hospitalPrice,
        study.otherPrice,
        study.defaultDiscountPercent,
        study.method,
        study.indicator,
        (study.packageStudyIds ?? []).join(','),
        study.status,
      ]),
    );
  }

  async previewCsv(buffer: Buffer): Promise<ImportPreviewResult> {
    const analysis = await this.analyzeCsv(buffer);
    return analysis.preview;
  }

  async importCsv(buffer: Buffer) {
    const analysis = await this.analyzeCsv(buffer);
    let created = 0;
    let updated = 0;

    for (const operation of analysis.operations) {
      if (operation.action === 'update' && operation.existing) {
        const merged = this.studyRepo.merge(
          operation.existing,
          operation.payload,
          {
            isActive: true,
          },
        );
        await this.studyRepo.save(merged);
        updated += 1;
        continue;
      }

      await this.studyRepo.save(this.studyRepo.create(operation.payload));
      created += 1;
    }

    return {
      message: 'Importacion de estudios completada.',
      created,
      updated,
      skipped: analysis.preview.summary.skipped,
      invalid: analysis.preview.summary.invalidRows,
      duplicatesInFile: analysis.preview.summary.duplicatesInFile,
      duplicatesInDatabase: analysis.preview.summary.duplicatesInDatabase,
    };
  }

  private async analyzeCsv(buffer: Buffer): Promise<{
    preview: ImportPreviewResult;
    operations: StudyImportOperation[];
  }> {
    const rows = parseCsv(buffer.toString('utf8'));
    if (rows.length < 2) {
      throw new BadRequestException('El archivo CSV no contiene registros.');
    }

    const headers = rows[0].map((header) => header.trim());
    for (const header of ['name', 'code']) {
      if (!headers.includes(header)) {
        throw new BadRequestException(`Falta la columna requerida: ${header}`);
      }
    }

    const seenKeys = new Set<string>();
    const previewRows: ImportPreviewRow[] = [];
    const operations: StudyImportOperation[] = [];
    const summary: ImportPreviewSummary = {
      totalRows: rows.length - 1,
      validRows: 0,
      invalidRows: 0,
      toCreate: 0,
      toUpdate: 0,
      skipped: 0,
      duplicatesInFile: 0,
      duplicatesInDatabase: 0,
    };

    for (const [index, row] of rows.slice(1).entries()) {
      const rowNumber = index + 2;
      const record = this.buildRecord(headers, row);
      const errors: string[] = [];

      if (!record.name) errors.push('Falta name.');
      if (!record.code) errors.push('Falta code.');

      const payload: CreateStudyDto = {
        name: record.name,
        code: record.code,
        description: record.description,
        durationMinutes: this.parseInteger(record.durationMinutes, 60),
        type: this.parseStudyType(record.type),
        normalPrice: this.parseDecimal(record.normalPrice),
        difPrice: this.parseDecimal(record.difPrice),
        specialPrice: this.parseDecimal(record.specialPrice),
        hospitalPrice: this.parseDecimal(record.hospitalPrice),
        otherPrice: this.parseDecimal(record.otherPrice),
        defaultDiscountPercent: this.parseDecimal(
          record.defaultDiscountPercent,
        ),
        method: record.method,
        indicator: record.indicator,
        packageStudyIds: this.parseIntegerArray(record.packageStudyIds),
        status: this.parseStudyStatus(record.status),
      };

      const duplicateKey = payload.code?.trim().toLowerCase() ?? '';
      const duplicateInFile = !!duplicateKey && seenKeys.has(duplicateKey);

      if (duplicateKey && !duplicateInFile) {
        seenKeys.add(duplicateKey);
      }

      const existing =
        errors.length === 0 && !duplicateInFile
          ? await this.studyRepo.findOne({ where: { code: payload.code } })
          : null;

      const summaryLabel = `${payload.code} - ${payload.name}`;

      if (errors.length > 0) {
        summary.invalidRows += 1;
        summary.skipped += 1;
        previewRows.push({
          rowNumber,
          action: 'skip',
          duplicate: false,
          summary: summaryLabel,
          matchLabel: null,
          errors,
          raw: record,
        });
        continue;
      }

      if (duplicateInFile) {
        summary.validRows += 1;
        summary.skipped += 1;
        summary.duplicatesInFile += 1;
        previewRows.push({
          rowNumber,
          action: 'skip',
          duplicate: true,
          duplicateSource: 'file',
          summary: summaryLabel,
          matchLabel: payload.code ?? '',
          errors: ['Fila duplicada dentro del mismo archivo.'],
          raw: record,
        });
        continue;
      }

      summary.validRows += 1;

      if (existing) {
        summary.toUpdate += 1;
        summary.duplicatesInDatabase += 1;
        previewRows.push({
          rowNumber,
          action: 'update',
          duplicate: true,
          duplicateSource: 'database',
          summary: summaryLabel,
          matchLabel: `Estudio #${existing.id}`,
          errors: [],
          raw: record,
        });
        operations.push({ action: 'update', payload, existing });
        continue;
      }

      summary.toCreate += 1;
      previewRows.push({
        rowNumber,
        action: 'create',
        duplicate: false,
        summary: summaryLabel,
        matchLabel: null,
        errors: [],
        raw: record,
      });
      operations.push({ action: 'create', payload });
    }

    return {
      preview: {
        message: 'Previsualizacion de estudios generada correctamente.',
        headers,
        summary,
        rows: previewRows,
      },
      operations,
    };
  }

  private buildRecord(headers: string[], row: string[]) {
    return headers.reduce<Record<string, string>>((acc, header, index) => {
      acc[header] = (row[index] ?? '').trim();
      return acc;
    }, {});
  }

  private parseInteger(value: string, fallback: number) {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  private parseDecimal(value: string, fallback = 0) {
    const normalized = value.replace(',', '.').trim();
    const parsed = Number.parseFloat(normalized);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  private parseIntegerArray(value?: string) {
    return (value ?? '')
      .split(',')
      .map((segment) => Number.parseInt(segment.trim(), 10))
      .filter((segment) => Number.isFinite(segment));
  }

  private parseStudyType(value: string): StudyType {
    if (value === StudyType.PACKAGE) {
      return StudyType.PACKAGE;
    }
    if (value === StudyType.OTHER) {
      return StudyType.OTHER;
    }
    return StudyType.STUDY;
  }

  private parseStudyStatus(value: string): StudyStatus {
    return value === StudyStatus.SUSPENDED
      ? StudyStatus.SUSPENDED
      : StudyStatus.ACTIVE;
  }

  private toNumber(value: number | string | null | undefined) {
    const parsed = Number(value ?? 0);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  private buildPublicStudyResponse(
    study: Study,
    details: StudyDetail[] = [],
    packageStudies: Study[] = [],
  ) {
    const normalPrice = this.toNumber(study.normalPrice);
    const difPrice = this.toNumber(study.difPrice);
    const specialPrice = this.toNumber(study.specialPrice);
    const hospitalPrice = this.toNumber(study.hospitalPrice);
    const otherPrice = this.toNumber(study.otherPrice);

    return {
      id: study.id,
      code: study.code,
      name: study.name,
      type: study.type,
      description: study.description ?? null,
      durationMinutes: study.durationMinutes,
      method: study.method ?? null,
      indicator: study.indicator ?? null,
      prices: {
        normal: normalPrice,
        dif: difPrice,
        special: specialPrice,
        hospital: hospitalPrice,
        other: otherPrice,
      },
      defaultDiscountPercent: this.toNumber(study.defaultDiscountPercent),
      packageStudyIds: study.packageStudyIds ?? [],
      packageStudies: packageStudies.map((packageStudy) => ({
        id: packageStudy.id,
        code: packageStudy.code,
        name: packageStudy.name,
        normalPrice: this.toNumber(packageStudy.normalPrice),
      })),
      details: details.map((detail) => ({
        id: detail.id,
        parentId: detail.parentId ?? null,
        dataType: detail.dataType,
        name: detail.name,
        unit: detail.unit ?? null,
        referenceValue: detail.referenceValue ?? null,
      })),
      available: study.isActive && study.status === StudyStatus.ACTIVE,
      spokenSummary: `${study.name} esta disponible con precio normal de ${normalPrice} pesos.`,
    };
  }

  async listAvailableForPublic(query: PublicStudiesQuery = {}) {
    const limit = Math.min(Math.max(query.limit ?? 20, 1), 50);
    const qb = this.studyRepo
      .createQueryBuilder('study')
      .where('study.isActive = :isActive', { isActive: true })
      .andWhere('study.status = :status', { status: StudyStatus.ACTIVE })
      .orderBy('study.name', 'ASC')
      .take(limit);

    if (query.type) {
      qb.andWhere('study.type = :type', { type: query.type });
    }

    const normalizedSearch = this.normalizeSearchValue(query.search ?? '');
    if (normalizedSearch) {
      const normalizedFields = [
        this.buildNormalizedSql('study.name'),
        this.buildNormalizedSql('study.code'),
        this.buildNormalizedSql('study.description'),
        this.buildNormalizedSql('study.method'),
        this.buildNormalizedSql('study.indicator'),
      ];

      qb.andWhere(
        `(${normalizedFields
          .map((field) => `${field} LIKE :search`)
          .join(' OR ')})`,
        { search: `%${normalizedSearch}%` },
      );
    }

    const studies = await qb.getMany();
    const detailMap = new Map<number, StudyDetail[]>();
    const packageMap = new Map<number, Study[]>();

    if (query.includeDetails && studies.length > 0) {
      const details = await this.detailRepo.find({
        where: {
          studyId: In(studies.map((study) => study.id)),
          isActive: true,
        },
        order: { sortOrder: 'ASC', name: 'ASC' },
      });

      for (const detail of details) {
        detailMap.set(detail.studyId, [
          ...(detailMap.get(detail.studyId) ?? []),
          detail,
        ]);
      }
    }

    const packageIds = [
      ...new Set(studies.flatMap((study) => study.packageStudyIds ?? [])),
    ];

    if (packageIds.length > 0) {
      const packageItems = await this.studyRepo.findBy({
        id: In(packageIds),
        isActive: true,
        status: StudyStatus.ACTIVE,
      });
      const packageItemsById = new Map(
        packageItems.map((packageItem) => [packageItem.id, packageItem]),
      );

      for (const study of studies) {
        packageMap.set(
          study.id,
          (study.packageStudyIds ?? [])
            .map((id) => packageItemsById.get(id))
            .filter((packageItem): packageItem is Study => !!packageItem),
        );
      }
    }

    return {
      data: studies.map((study) =>
        this.buildPublicStudyResponse(
          study,
          detailMap.get(study.id) ?? [],
          packageMap.get(study.id) ?? [],
        ),
      ),
      meta: {
        total: studies.length,
        limit,
      },
    };
  }

  async findAvailableForPublic(codeOrId: string, includeDetails = true) {
    const trimmedValue = codeOrId.trim();
    const parsedId = Number.parseInt(trimmedValue, 10);
    const qb = this.studyRepo
      .createQueryBuilder('study')
      .where('study.isActive = :isActive', { isActive: true })
      .andWhere('study.status = :status', { status: StudyStatus.ACTIVE });

    if (Number.isFinite(parsedId) && String(parsedId) === trimmedValue) {
      qb.andWhere('study.id = :id', { id: parsedId });
    } else {
      qb.andWhere('upper(study.code) = :code', {
        code: trimmedValue.toUpperCase(),
      });
    }

    const study = await qb.getOne();
    if (!study) {
      throw new NotFoundException('Estudio disponible no encontrado.');
    }

    const details = includeDetails
      ? await this.detailRepo.find({
          where: { studyId: study.id, isActive: true },
          order: { sortOrder: 'ASC', name: 'ASC' },
        })
      : [];

    const packageStudies =
      study.packageStudyIds.length > 0
        ? await this.studyRepo.findBy({
            id: In(study.packageStudyIds),
            isActive: true,
            status: StudyStatus.ACTIVE,
          })
        : [];

    return {
      data: this.buildPublicStudyResponse(study, details, packageStudies),
    };
  }
}
