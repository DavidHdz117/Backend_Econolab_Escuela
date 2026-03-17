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
import { CreatePatientDto } from './dto/create-patient.dto';
import { UpdatePatientDto } from './dto/update-patient.dto';
import { Patient, PatientGender } from './entities/patient.entity';

type PatientImportOperation = {
  action: 'create' | 'update';
  payload: CreatePatientDto;
  existing?: Patient | null;
};

@Injectable()
export class PatientsService {
  constructor(
    @InjectRepository(Patient)
    private readonly repo: Repository<Patient>,
  ) {}

  async search(search: string, page = 1, limit = 10) {
    const where = search
      ? [
          { firstName: Like(`%${search}%`), isActive: true },
          { lastName: Like(`%${search}%`), isActive: true },
          { phone: Like(`%${search}%`), isActive: true },
          { documentNumber: Like(`%${search}%`), isActive: true },
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
        'gender',
        'birthDate',
        'phone',
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

  async create(dto: CreatePatientDto) {
    if (dto.documentType && dto.documentNumber) {
      const exists = await this.repo.findOne({
        where: {
          documentType: dto.documentType,
          documentNumber: dto.documentNumber,
        },
      });
      if (exists) {
        throw new ConflictException(
          'Ya existe un paciente registrado con este tipo y numero de documento.',
        );
      }
    }

    const entity = this.repo.create(dto);
    return this.repo.save(entity);
  }

  async findOne(id: number) {
    const patient = await this.repo.findOne({ where: { id, isActive: true } });
    if (!patient) {
      throw new NotFoundException('Paciente no encontrado.');
    }
    return patient;
  }

  async update(id: number, dto: UpdatePatientDto) {
    const patient = await this.findOne(id);

    if (dto.documentType && dto.documentNumber) {
      const duplicated = await this.repo.findOne({
        where: {
          documentType: dto.documentType,
          documentNumber: dto.documentNumber,
          id: Not(id),
        },
      });

      if (duplicated) {
        throw new ConflictException(
          'Ya existe otro paciente con este tipo y numero de documento.',
        );
      }
    }

    const merged = this.repo.merge(patient, dto);
    return this.repo.save(merged);
  }

  async softDelete(id: number) {
    await this.findOne(id);
    await this.repo.update({ id }, { isActive: false });
    return { message: 'Paciente desactivado correctamente.' };
  }

  async hardDelete(id: number) {
    const result = await this.repo.delete({ id });

    if (result.affected === 0) {
      throw new NotFoundException('Paciente no encontrado.');
    }

    return { message: 'Paciente eliminado definitivamente de la base de datos.' };
  }

  async existsByDocument(documentType: string, documentNumber: string) {
    const patient = await this.repo.findOne({
      where: { documentType, documentNumber, isActive: true },
      select: ['id'],
    });
    return { exists: !!patient, patientId: patient?.id ?? null };
  }

  async exportCsv() {
    const patients = await this.repo.find({
      where: { isActive: true },
      order: { lastName: 'ASC', firstName: 'ASC' },
    });

    return toCsv(
      [
        'firstName',
        'lastName',
        'middleName',
        'gender',
        'birthDate',
        'phone',
        'email',
        'addressLine',
        'addressBetween',
        'addressCity',
        'addressState',
        'addressZip',
        'documentType',
        'documentNumber',
      ],
      patients.map((patient) => [
        patient.firstName,
        patient.lastName,
        patient.middleName,
        patient.gender,
        patient.birthDate,
        patient.phone,
        patient.email,
        patient.addressLine,
        patient.addressBetween,
        patient.addressCity,
        patient.addressState,
        patient.addressZip,
        patient.documentType,
        patient.documentNumber,
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
      message: 'Importacion de pacientes completada.',
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
    operations: PatientImportOperation[];
  }> {
    const rows = parseCsv(buffer.toString('utf8'));
    if (rows.length < 2) {
      throw new BadRequestException('El archivo CSV no contiene registros.');
    }

    const headers = rows[0].map((header) => header.trim());
    const requiredHeaders = ['firstName', 'lastName', 'gender', 'birthDate'];

    for (const header of requiredHeaders) {
      if (!headers.includes(header)) {
        throw new BadRequestException(`Falta la columna requerida: ${header}`);
      }
    }

    const seenKeys = new Set<string>();
    const previewRows: ImportPreviewRow[] = [];
    const operations: PatientImportOperation[] = [];
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
      if (!record.gender) errors.push('Falta gender.');
      if (!record.birthDate) errors.push('Falta birthDate.');

      const payload: CreatePatientDto = {
        firstName: record.firstName,
        lastName: record.lastName,
        middleName: record.middleName,
        gender: this.parseGender(record.gender),
        birthDate: record.birthDate,
        phone: record.phone,
        email: record.email,
        addressLine: record.addressLine,
        addressBetween: record.addressBetween,
        addressCity: record.addressCity,
        addressState: record.addressState,
        addressZip: record.addressZip,
        documentType: record.documentType,
        documentNumber: record.documentNumber,
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
          errors,
          raw: record,
          matchLabel: null,
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
          errors: ['Fila duplicada dentro del mismo archivo.'],
          raw: record,
          matchLabel: duplicateKey,
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
          errors: [],
          raw: record,
          matchLabel: `Paciente #${existing.id}`,
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
        errors: [],
        raw: record,
        matchLabel: null,
      });
      operations.push({ action: 'create', payload });
    }

    return {
      preview: {
        message: 'Previsualizacion de pacientes generada correctamente.',
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

  private parseGender(value: string): PatientGender {
    const normalized = value.trim().toLowerCase();
    if (normalized === PatientGender.MALE) {
      return PatientGender.MALE;
    }
    if (normalized === PatientGender.FEMALE) {
      return PatientGender.FEMALE;
    }
    return PatientGender.OTHER;
  }

  private buildDuplicateKey(payload: CreatePatientDto) {
    const documentType = payload.documentType?.trim().toLowerCase();
    const documentNumber = payload.documentNumber?.trim().toLowerCase();

    if (documentType && documentNumber) {
      return `document:${documentType}:${documentNumber}`;
    }

    const firstName = payload.firstName.trim().toLowerCase();
    const lastName = payload.lastName.trim().toLowerCase();
    const birthDate = payload.birthDate.trim();

    if (!firstName || !lastName || !birthDate) {
      return '';
    }

    return `identity:${firstName}:${lastName}:${birthDate}`;
  }

  private async findExistingForImport(payload: CreatePatientDto) {
    if (payload.documentType && payload.documentNumber) {
      return this.repo.findOne({
        where: {
          documentType: payload.documentType,
          documentNumber: payload.documentNumber,
        },
      });
    }

    return this.repo.findOne({
      where: {
        firstName: payload.firstName,
        lastName: payload.lastName,
        birthDate: payload.birthDate,
      },
    });
  }

  private describeRecord(payload: CreatePatientDto) {
    const fullName = [payload.firstName, payload.lastName, payload.middleName]
      .filter((value) => !!value)
      .join(' ');

    if (payload.documentType && payload.documentNumber) {
      return `${fullName} (${payload.documentType}: ${payload.documentNumber})`;
    }

    return `${fullName} - ${payload.birthDate}`;
  }
}
