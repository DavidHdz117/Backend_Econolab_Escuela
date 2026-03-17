import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Like, Not, Repository } from 'typeorm';
import {
  ImportPreviewResult,
  ImportPreviewRow,
  ImportPreviewSummary,
} from 'src/common/import/import-preview.types';
import { parseCsv, toCsv } from 'src/common/utils/csv.util';
import { CreateDoctorDto } from './dto/create-doctor.dto';
import { UpdateDoctorDto } from './dto/update-doctor.dto';
import { Doctor } from './entities/doctor.entity';

type DoctorImportOperation = {
  action: 'create' | 'update';
  payload: CreateDoctorDto;
  existing?: Doctor | null;
};

@Injectable()
export class DoctorsService {
  constructor(
    @InjectRepository(Doctor)
    private readonly repo: Repository<Doctor>,
  ) {}

  async search(search: string, page = 1, limit = 10) {
    const where = search
      ? [
          { firstName: Like(`%${search}%`), isActive: true },
          { lastName: Like(`%${search}%`), isActive: true },
          { email: Like(`%${search}%`), isActive: true },
          { phone: Like(`%${search}%`), isActive: true },
          { licenseNumber: Like(`%${search}%`), isActive: true },
        ]
      : { isActive: true };

    const [data, total] = await this.repo.findAndCount({
      where,
      take: limit,
      skip: (page - 1) * limit,
      order: { lastName: 'ASC', firstName: 'ASC' },
      select: [
        'id',
        'firstName',
        'lastName',
        'middleName',
        'email',
        'phone',
        'specialty',
        'licenseNumber',
      ],
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

  async create(dto: CreateDoctorDto) {
    if (dto.licenseNumber) {
      const exists = await this.repo.findOne({
        where: { licenseNumber: dto.licenseNumber },
      });
      if (exists) {
        throw new ConflictException(
          'Ya existe un medico registrado con esta cedula profesional.',
        );
      }
    }

    const entity = this.repo.create(dto);
    return this.repo.save(entity);
  }

  async findOne(id: number) {
    const doctor = await this.repo.findOne({ where: { id, isActive: true } });
    if (!doctor) {
      throw new NotFoundException('Medico no encontrado.');
    }
    return doctor;
  }

  async update(id: number, dto: UpdateDoctorDto) {
    const doctor = await this.findOne(id);

    if (dto.licenseNumber) {
      const duplicated = await this.repo.findOne({
        where: {
          licenseNumber: dto.licenseNumber,
          id: Not(id),
        },
      });

      if (duplicated) {
        throw new ConflictException(
          'Ya existe otro medico con esta cedula profesional.',
        );
      }
    }

    const merged = this.repo.merge(doctor, dto);
    return this.repo.save(merged);
  }

  async softDelete(id: number) {
    await this.findOne(id);
    await this.repo.update({ id }, { isActive: false });
    return { message: 'Medico desactivado correctamente.' };
  }

  async hardDelete(id: number) {
    const result = await this.repo.delete({ id });

    if (result.affected === 0) {
      throw new NotFoundException('Medico no encontrado.');
    }

    return { message: 'Medico eliminado definitivamente de la base de datos.' };
  }

  async existsByLicense(licenseNumber: string) {
    const doctor = await this.repo.findOne({
      where: { licenseNumber, isActive: true },
      select: ['id'],
    });
    return { exists: !!doctor, doctorId: doctor?.id ?? null };
  }

  async exportCsv() {
    const doctors = await this.repo.find({
      where: { isActive: true },
      order: { lastName: 'ASC', firstName: 'ASC' },
    });

    return toCsv(
      [
        'firstName',
        'lastName',
        'middleName',
        'email',
        'phone',
        'specialty',
        'licenseNumber',
        'notes',
      ],
      doctors.map((doctor) => [
        doctor.firstName,
        doctor.lastName,
        doctor.middleName,
        doctor.email,
        doctor.phone,
        doctor.specialty,
        doctor.licenseNumber,
        doctor.notes,
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
        const merged = this.repo.merge(operation.existing, operation.payload, {
          isActive: true,
        });
        await this.repo.save(merged);
        updated += 1;
        continue;
      }

      await this.repo.save(this.repo.create(operation.payload));
      created += 1;
    }

    return {
      message: 'Importacion de medicos completada.',
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
    operations: DoctorImportOperation[];
  }> {
    const rows = parseCsv(buffer.toString('utf8'));
    if (rows.length < 2) {
      throw new BadRequestException('El archivo CSV no contiene registros.');
    }

    const headers = rows[0].map((header) => header.trim());
    for (const header of ['firstName', 'lastName']) {
      if (!headers.includes(header)) {
        throw new BadRequestException(`Falta la columna requerida: ${header}`);
      }
    }

    const seenKeys = new Set<string>();
    const previewRows: ImportPreviewRow[] = [];
    const operations: DoctorImportOperation[] = [];
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

      if (!record.firstName) errors.push('Falta firstName.');
      if (!record.lastName) errors.push('Falta lastName.');

      const payload: CreateDoctorDto = {
        firstName: record.firstName,
        lastName: record.lastName,
        middleName: record.middleName,
        email: record.email,
        phone: record.phone,
        specialty: record.specialty,
        licenseNumber: record.licenseNumber,
        notes: record.notes,
      };

      const duplicateKey = this.buildDuplicateKey(payload);
      const duplicateInFile = !!duplicateKey && seenKeys.has(duplicateKey);

      if (duplicateKey && !duplicateInFile) {
        seenKeys.add(duplicateKey);
      }

      const existing =
        errors.length === 0 && !duplicateInFile
          ? await this.findExistingForImport(payload)
          : null;

      const summaryLabel = this.describeRecord(payload);

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
          matchLabel: duplicateKey,
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
          matchLabel: `Medico #${existing.id}`,
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
        message: 'Previsualizacion de medicos generada correctamente.',
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

  private buildDuplicateKey(payload: CreateDoctorDto) {
    const license = payload.licenseNumber?.trim().toLowerCase();
    if (license) {
      return `license:${license}`;
    }

    const firstName = payload.firstName.trim().toLowerCase();
    const lastName = payload.lastName.trim().toLowerCase();
    const email = payload.email?.trim().toLowerCase();

    if (firstName && lastName && email) {
      return `identity:${firstName}:${lastName}:${email}`;
    }

    return firstName && lastName ? `identity:${firstName}:${lastName}` : '';
  }

  private async findExistingForImport(payload: CreateDoctorDto) {
    if (payload.licenseNumber) {
      return this.repo.findOne({
        where: { licenseNumber: payload.licenseNumber },
      });
    }

    if (payload.email) {
      const byEmail = await this.repo.findOne({
        where: {
          firstName: payload.firstName,
          lastName: payload.lastName,
          email: payload.email,
        },
      });
      if (byEmail) {
        return byEmail;
      }
    }

    return this.repo.findOne({
      where: {
        firstName: payload.firstName,
        lastName: payload.lastName,
      },
    });
  }

  private describeRecord(payload: CreateDoctorDto) {
    const fullName = [payload.firstName, payload.lastName, payload.middleName]
      .filter((value) => !!value)
      .join(' ');

    if (payload.licenseNumber) {
      return `${fullName} (cedula: ${payload.licenseNumber})`;
    }

    return `${fullName}${payload.specialty ? ` - ${payload.specialty}` : ''}`;
  }
}
