import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Like, Repository } from 'typeorm';
import {
  ImportPreviewResult,
  ImportPreviewRow,
  ImportPreviewSummary,
} from 'src/common/import/import-preview.types';
import { parseCsv, toCsv } from 'src/common/utils/csv.util';
import { CreateStudyDetailDto } from './dto/create-study-detail.dto';
import { CreateStudyDto } from './dto/create-study.dto';
import { UpdateStudyDetailDto } from './dto/update-study-detail.dto';
import { UpdateStudyDto } from './dto/update-study.dto';
import { StudyDetail } from './entities/study-detail.entity';
import { Study, StudyStatus, StudyType } from './entities/study.entity';

type StudyImportOperation = {
  action: 'create' | 'update';
  payload: CreateStudyDto;
  existing?: Study | null;
};

@Injectable()
export class StudiesService {
  constructor(
    @InjectRepository(Study)
    private readonly studyRepo: Repository<Study>,
    @InjectRepository(StudyDetail)
    private readonly detailRepo: Repository<StudyDetail>,
  ) {}

  async search(
    search: string,
    type?: StudyType,
    status?: StudyStatus,
    page = 1,
    limit = 10,
  ) {
    const base: Record<string, unknown> = { isActive: true };
    if (type) base.type = type;
    if (status) base.status = status;

    const where = search
      ? [{ ...base, name: Like(`%${search}%`) }, { ...base, code: Like(`%${search}%`) }]
      : base;

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

  async existsByCode(code: string) {
    const study = await this.studyRepo.findOne({
      where: { code, isActive: true },
      select: ['id'],
    });
    return { exists: !!study, studyId: study?.id ?? null };
  }

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

  async findOne(id: number) {
    const study = await this.studyRepo.findOne({
      where: { id, isActive: true },
    });
    if (!study) {
      throw new NotFoundException('Estudio no encontrado.');
    }
    return study;
  }

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

  async softDelete(id: number) {
    await this.findOne(id);
    await this.studyRepo.update({ id }, { isActive: false });
    return { message: 'Estudio desactivado correctamente.' };
  }

  async hardDelete(id: number) {
    const result = await this.studyRepo.delete({ id });

    if (result.affected === 0) {
      throw new NotFoundException('Estudio no encontrado.');
    }

    return { message: 'Estudio eliminado definitivamente de la base de datos.' };
  }

  async listDetails(studyId: number) {
    await this.findOne(studyId);

    const details = await this.detailRepo.find({
      where: { studyId, isActive: true },
      order: { sortOrder: 'ASC' },
    });

    return details;
  }

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
        const merged = this.studyRepo.merge(operation.existing, operation.payload, {
          isActive: true,
        });
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

  private async analyzeCsv(
    buffer: Buffer,
  ): Promise<{
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
        defaultDiscountPercent: this.parseDecimal(record.defaultDiscountPercent),
        method: record.method,
        indicator: record.indicator,
        status: this.parseStudyStatus(record.status),
      };

      const duplicateKey = payload.code.trim().toLowerCase();
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
          matchLabel: payload.code,
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
}
