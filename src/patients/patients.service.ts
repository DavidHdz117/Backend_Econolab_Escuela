import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  ImportPreviewResult,
  ImportPreviewRow,
  ImportPreviewSummary,
} from 'src/common/import/import-preview.types';
import { parseCsv, toCsv } from 'src/common/utils/csv.util';
import { CreatePatientDto } from './dto/create-patient.dto';
import { UpdatePatientStatusDto } from './dto/update-patient-status.dto';
import { UpdatePatientDto } from './dto/update-patient.dto';
import { Patient, PatientGender } from './entities/patient.entity';

type PatientImportOperation = {
  action: 'create' | 'update';
  payload: CreatePatientDto;
  existing?: Patient | null;
};

type PatientStatusFilter = 'active' | 'inactive' | 'all';

@Injectable()
export class PatientsService {
  constructor(
    @InjectRepository(Patient)
    private readonly repo: Repository<Patient>,
  ) {}

  private normalizeStatusFilter(status?: string): PatientStatusFilter {
    if (status === 'inactive' || status === 'all') {
      return status;
    }

    return 'active';
  }

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

  private buildFullNameSql(alias: string) {
    return `concat_ws(' ', ${alias}.firstName, ${alias}.lastName, ${alias}.middleName)`;
  }

  private async findByIdOrFail(id: number) {
    const patient = await this.repo.findOne({ where: { id } });

    if (!patient) {
      throw new NotFoundException('Paciente no encontrado.');
    }

    return patient;
  }

  private async findPatientDuplicateByDocument(
    documentType?: string,
    documentNumber?: string,
    excludeId?: number,
    activeOnly = false,
  ) {
    const normalizedType = this.normalizeSearchValue(documentType ?? '');
    const normalizedNumber = this.normalizeSearchValue(documentNumber ?? '');

    if (!normalizedType || !normalizedNumber) {
      return null;
    }

    const qb = this.repo
      .createQueryBuilder('patient')
      .where(
        `${this.buildNormalizedSql('patient.documentType')} = :documentType`,
        { documentType: normalizedType },
      )
      .andWhere(
        `${this.buildNormalizedSql('patient.documentNumber')} = :documentNumber`,
        { documentNumber: normalizedNumber },
      );

    if (excludeId) {
      qb.andWhere('patient.id != :excludeId', { excludeId });
    }

    if (activeOnly) {
      qb.andWhere('patient.isActive = true');
    }

    return qb.getOne();
  }

  private async findPatientDuplicateByIdentity(
    patient: Pick<Patient, 'firstName' | 'lastName' | 'middleName' | 'birthDate'>,
    excludeId?: number,
  ) {
    const normalizedFullName = this.normalizeSearchValue(
      `${patient.firstName} ${patient.lastName} ${patient.middleName ?? ''}`,
    );

    if (!normalizedFullName || !patient.birthDate) {
      return null;
    }

    const qb = this.repo
      .createQueryBuilder('patient')
      .where(
        `${this.buildNormalizedSql(this.buildFullNameSql('patient'))} = :fullName`,
        { fullName: normalizedFullName },
      )
      .andWhere('patient.birthDate = :birthDate', {
        birthDate: patient.birthDate,
      });

    if (excludeId) {
      qb.andWhere('patient.id != :excludeId', { excludeId });
    }

    return qb.getOne();
  }

  private async assertNoDuplicatePatient(
    patient: Pick<
      Patient,
      | 'firstName'
      | 'lastName'
      | 'middleName'
      | 'birthDate'
      | 'documentType'
      | 'documentNumber'
    >,
    excludeId?: number,
  ) {
    const documentDuplicate = await this.findPatientDuplicateByDocument(
      patient.documentType,
      patient.documentNumber,
      excludeId,
    );

    if (documentDuplicate) {
      throw new ConflictException(
        'Ya existe un paciente con ese tipo y numero de documento.',
      );
    }

    const identityDuplicate = await this.findPatientDuplicateByIdentity(
      patient,
      excludeId,
    );

    if (identityDuplicate) {
      throw new ConflictException(
        'Ya existe un paciente con el mismo nombre y fecha de nacimiento.',
      );
    }
  }

  async search(search: string, page = 1, limit = 10, status?: string) {
    const normalizedStatus = this.normalizeStatusFilter(status);
    const qb = this.repo
      .createQueryBuilder('patient')
      .orderBy('patient.lastName', 'ASC')
      .addOrderBy('patient.firstName', 'ASC')
      .skip((page - 1) * limit)
      .take(limit);

    if (normalizedStatus !== 'all') {
      qb.andWhere('patient.isActive = :isActive', {
        isActive: normalizedStatus === 'active',
      });
    }

    const normalizedSearch = this.normalizeSearchValue(search);
    if (normalizedSearch) {
      const normalizedFields = [
        this.buildNormalizedSql('patient.firstName'),
        this.buildNormalizedSql('patient.lastName'),
        this.buildNormalizedSql('patient.middleName'),
        this.buildNormalizedSql(this.buildFullNameSql('patient')),
        this.buildNormalizedSql('patient.phone'),
        this.buildNormalizedSql('patient.email'),
        this.buildNormalizedSql('patient.documentNumber'),
        this.buildNormalizedSql('patient.addressLine'),
      ];

      qb.andWhere(
        `(${normalizedFields
          .map((field) => `${field} LIKE :search`)
          .join(' OR ')})`,
        {
          search: `%${normalizedSearch}%`,
        },
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

  async create(dto: CreatePatientDto) {
    await this.assertNoDuplicatePatient({
      firstName: dto.firstName,
      lastName: dto.lastName,
      middleName: dto.middleName,
      birthDate: dto.birthDate,
      documentType: dto.documentType,
      documentNumber: dto.documentNumber,
    });

    const entity = this.repo.create(dto);
    return this.repo.save(entity);
  }

  async findOne(id: number) {
    return this.findByIdOrFail(id);
  }

  async update(id: number, dto: UpdatePatientDto) {
    const patient = await this.findByIdOrFail(id);

    await this.assertNoDuplicatePatient(
      {
        firstName: dto.firstName ?? patient.firstName,
        lastName: dto.lastName ?? patient.lastName,
        middleName: dto.middleName ?? patient.middleName,
        birthDate: dto.birthDate ?? patient.birthDate,
        documentType: dto.documentType ?? patient.documentType,
        documentNumber: dto.documentNumber ?? patient.documentNumber,
      },
      id,
    );

    const merged = this.repo.merge(patient, dto);
    return this.repo.save(merged);
  }

  async softDelete(id: number) {
    const patient = await this.findByIdOrFail(id);
    patient.isActive = false;
    await this.repo.save(patient);
    return { message: 'Paciente desactivado correctamente.' };
  }

  async updateStatus(id: number, dto: UpdatePatientStatusDto) {
    const patient = await this.findByIdOrFail(id);

    if (patient.isActive === dto.isActive) {
      return patient;
    }

    patient.isActive = dto.isActive;
    return this.repo.save(patient);
  }

  async hardDelete(id: number) {
    const result = await this.repo.delete({ id });

    if (result.affected === 0) {
      throw new NotFoundException('Paciente no encontrado.');
    }

    return { message: 'Paciente eliminado definitivamente de la base de datos.' };
  }

  async existsByDocument(documentType: string, documentNumber: string) {
    const patient = await this.findPatientDuplicateByDocument(
      documentType,
      documentNumber,
      undefined,
      true,
    );

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
      return this.findPatientDuplicateByDocument(
        payload.documentType,
        payload.documentNumber,
      );
    }

    return this.findPatientDuplicateByIdentity({
      firstName: payload.firstName,
      lastName: payload.lastName,
      middleName: payload.middleName,
      birthDate: payload.birthDate,
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
