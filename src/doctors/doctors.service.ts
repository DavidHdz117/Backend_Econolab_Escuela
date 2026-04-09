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
import { CreateDoctorDto } from './dto/create-doctor.dto';
import { UpdateDoctorStatusDto } from './dto/update-doctor-status.dto';
import { UpdateDoctorDto } from './dto/update-doctor.dto';
import { Doctor } from './entities/doctor.entity';

type DoctorImportOperation = {
  action: 'create' | 'update';
  payload: CreateDoctorDto;
  existing?: Doctor | null;
};

type DoctorStatusFilter = 'active' | 'inactive' | 'all';

@Injectable()
export class DoctorsService {
  constructor(
    @InjectRepository(Doctor)
    private readonly repo: Repository<Doctor>,
  ) {}

  private normalizeStatusFilter(status?: string): DoctorStatusFilter {
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

  private normalizePhoneValue(value?: string | null) {
    return (value ?? '').replace(/\D+/g, '');
  }

  private normalizeEmailValue(value?: string | null) {
    return (value ?? '').trim().toLowerCase();
  }

  private buildNormalizedSql(field: string) {
    return `regexp_replace(lower(translate(coalesce(${field}, ''), 'áéíóúäëïöüàèìòùÁÉÍÓÚÄËÏÖÜÀÈÌÒÙñÑ', 'aeiouaeiouaeiouAEIOUAEIOUAEIOUnN')), '[^a-z0-9]+', '', 'g')`;
  }

  private buildDigitsOnlySql(field: string) {
    return `regexp_replace(coalesce(${field}, ''), '\\D+', '', 'g')`;
  }

  private buildLowerTrimSql(field: string) {
    return `lower(trim(coalesce(${field}, '')))`;
  }

  private buildFullNameSql(alias: string) {
    return `concat_ws(' ', ${alias}.firstName, ${alias}.lastName, ${alias}.middleName)`;
  }

  private async findByIdOrFail(id: number) {
    const doctor = await this.repo.findOne({ where: { id } });

    if (!doctor) {
      throw new NotFoundException('Medico no encontrado.');
    }

    return doctor;
  }

  private async findDoctorDuplicateByLicense(
    licenseNumber?: string,
    excludeId?: number,
    activeOnly = false,
  ) {
    const normalizedLicense = this.normalizeSearchValue(licenseNumber ?? '');
    if (!normalizedLicense) {
      return null;
    }

    const qb = this.repo
      .createQueryBuilder('doctor')
      .where(`${this.buildNormalizedSql('doctor.licenseNumber')} = :license`, {
        license: normalizedLicense,
      });

    if (excludeId) {
      qb.andWhere('doctor.id != :excludeId', { excludeId });
    }

    if (activeOnly) {
      qb.andWhere('doctor.isActive = true');
    }

    return qb.getOne();
  }

  private async findDoctorDuplicateByNameAndEmail(
    doctor: Pick<Doctor, 'firstName' | 'lastName' | 'middleName' | 'email'>,
    excludeId?: number,
  ) {
    const normalizedFullName = this.normalizeSearchValue(
      `${doctor.firstName} ${doctor.lastName} ${doctor.middleName ?? ''}`,
    );
    const normalizedEmail = this.normalizeEmailValue(doctor.email);

    if (!normalizedFullName || !normalizedEmail) {
      return null;
    }

    const qb = this.repo
      .createQueryBuilder('doctor')
      .where(
        `${this.buildNormalizedSql(this.buildFullNameSql('doctor'))} = :fullName`,
        { fullName: normalizedFullName },
      )
      .andWhere(`${this.buildLowerTrimSql('doctor.email')} = :email`, {
        email: normalizedEmail,
      });

    if (excludeId) {
      qb.andWhere('doctor.id != :excludeId', { excludeId });
    }

    return qb.getOne();
  }

  private async findDoctorDuplicateByNameAndPhone(
    doctor: Pick<Doctor, 'firstName' | 'lastName' | 'middleName' | 'phone'>,
    excludeId?: number,
  ) {
    const normalizedFullName = this.normalizeSearchValue(
      `${doctor.firstName} ${doctor.lastName} ${doctor.middleName ?? ''}`,
    );
    const normalizedPhone = this.normalizePhoneValue(doctor.phone);

    if (!normalizedFullName || !normalizedPhone) {
      return null;
    }

    const qb = this.repo
      .createQueryBuilder('doctor')
      .where(
        `${this.buildNormalizedSql(this.buildFullNameSql('doctor'))} = :fullName`,
        { fullName: normalizedFullName },
      )
      .andWhere(`${this.buildDigitsOnlySql('doctor.phone')} = :phone`, {
        phone: normalizedPhone,
      });

    if (excludeId) {
      qb.andWhere('doctor.id != :excludeId', { excludeId });
    }

    return qb.getOne();
  }

  private async findDoctorDuplicateByNameAndSpecialty(
    doctor: Pick<Doctor, 'firstName' | 'lastName' | 'middleName' | 'specialty'>,
    excludeId?: number,
  ) {
    const normalizedFullName = this.normalizeSearchValue(
      `${doctor.firstName} ${doctor.lastName} ${doctor.middleName ?? ''}`,
    );
    const normalizedSpecialty = this.normalizeSearchValue(
      doctor.specialty ?? '',
    );

    if (!normalizedFullName || !normalizedSpecialty) {
      return null;
    }

    const qb = this.repo
      .createQueryBuilder('doctor')
      .where(
        `${this.buildNormalizedSql(this.buildFullNameSql('doctor'))} = :fullName`,
        { fullName: normalizedFullName },
      )
      .andWhere(`${this.buildNormalizedSql('doctor.specialty')} = :specialty`, {
        specialty: normalizedSpecialty,
      });

    if (excludeId) {
      qb.andWhere('doctor.id != :excludeId', { excludeId });
    }

    return qb.getOne();
  }

  private async findDoctorDuplicateByNameOnly(
    doctor: Pick<Doctor, 'firstName' | 'lastName' | 'middleName'>,
    excludeId?: number,
  ) {
    const normalizedFullName = this.normalizeSearchValue(
      `${doctor.firstName} ${doctor.lastName} ${doctor.middleName ?? ''}`,
    );

    if (!normalizedFullName) {
      return null;
    }

    const qb = this.repo
      .createQueryBuilder('doctor')
      .where(
        `${this.buildNormalizedSql(this.buildFullNameSql('doctor'))} = :fullName`,
        { fullName: normalizedFullName },
      );

    if (excludeId) {
      qb.andWhere('doctor.id != :excludeId', { excludeId });
    }

    return qb.getOne();
  }

  private async assertNoDuplicateDoctor(
    doctor: Pick<
      Doctor,
      | 'firstName'
      | 'lastName'
      | 'middleName'
      | 'email'
      | 'phone'
      | 'specialty'
      | 'licenseNumber'
    >,
    excludeId?: number,
  ) {
    const licenseDuplicate = await this.findDoctorDuplicateByLicense(
      doctor.licenseNumber,
      excludeId,
    );

    if (licenseDuplicate) {
      throw new ConflictException(
        'Ya existe un medico con esa cedula profesional.',
      );
    }

    const emailDuplicate = await this.findDoctorDuplicateByNameAndEmail(
      doctor,
      excludeId,
    );

    if (emailDuplicate) {
      throw new ConflictException(
        'Ya existe un medico con el mismo nombre y correo electronico.',
      );
    }

    const phoneDuplicate = await this.findDoctorDuplicateByNameAndPhone(
      doctor,
      excludeId,
    );

    if (phoneDuplicate) {
      throw new ConflictException(
        'Ya existe un medico con el mismo nombre y telefono.',
      );
    }

    if (
      !this.normalizeSearchValue(doctor.licenseNumber ?? '') &&
      !this.normalizeEmailValue(doctor.email) &&
      !this.normalizePhoneValue(doctor.phone)
    ) {
      const specialtyDuplicate =
        await this.findDoctorDuplicateByNameAndSpecialty(doctor, excludeId);

      if (specialtyDuplicate) {
        throw new ConflictException(
          'Ya existe un medico con el mismo nombre y especialidad.',
        );
      }

      if (!this.normalizeSearchValue(doctor.specialty ?? '')) {
        const nameDuplicate = await this.findDoctorDuplicateByNameOnly(
          doctor,
          excludeId,
        );

        if (nameDuplicate) {
          throw new ConflictException(
            'Ya existe un medico con el mismo nombre completo.',
          );
        }
      }
    }
  }

  async search(search: string, page = 1, limit = 10, status?: string) {
    const normalizedStatus = this.normalizeStatusFilter(status);
    const qb = this.repo
      .createQueryBuilder('doctor')
      .orderBy('doctor.lastName', 'ASC')
      .addOrderBy('doctor.firstName', 'ASC')
      .skip((page - 1) * limit)
      .take(limit);

    if (normalizedStatus !== 'all') {
      qb.andWhere('doctor.isActive = :isActive', {
        isActive: normalizedStatus === 'active',
      });
    }

    const normalizedSearch = this.normalizeSearchValue(search);
    if (normalizedSearch) {
      const normalizedFields = [
        this.buildNormalizedSql('doctor.firstName'),
        this.buildNormalizedSql('doctor.lastName'),
        this.buildNormalizedSql('doctor.middleName'),
        this.buildNormalizedSql(this.buildFullNameSql('doctor')),
        this.buildNormalizedSql('doctor.email'),
        this.buildNormalizedSql('doctor.phone'),
        this.buildNormalizedSql('doctor.licenseNumber'),
        this.buildNormalizedSql('doctor.specialty'),
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

  async create(dto: CreateDoctorDto) {
    await this.assertNoDuplicateDoctor({
      firstName: dto.firstName,
      lastName: dto.lastName,
      middleName: dto.middleName,
      email: dto.email,
      phone: dto.phone,
      specialty: dto.specialty,
      licenseNumber: dto.licenseNumber,
    });

    const entity = this.repo.create(dto);
    return this.repo.save(entity);
  }

  async findOne(id: number) {
    return this.findByIdOrFail(id);
  }

  async update(id: number, dto: UpdateDoctorDto) {
    const doctor = await this.findByIdOrFail(id);

    await this.assertNoDuplicateDoctor(
      {
        firstName: dto.firstName ?? doctor.firstName,
        lastName: dto.lastName ?? doctor.lastName,
        middleName: dto.middleName ?? doctor.middleName,
        email: dto.email ?? doctor.email,
        phone: dto.phone ?? doctor.phone,
        specialty: dto.specialty ?? doctor.specialty,
        licenseNumber: dto.licenseNumber ?? doctor.licenseNumber,
      },
      id,
    );

    const merged = this.repo.merge(doctor, dto);
    return this.repo.save(merged);
  }

  async softDelete(id: number) {
    const doctor = await this.findByIdOrFail(id);
    doctor.isActive = false;
    await this.repo.save(doctor);
    return { message: 'Medico desactivado correctamente.' };
  }

  async updateStatus(id: number, dto: UpdateDoctorStatusDto) {
    const doctor = await this.findByIdOrFail(id);

    if (doctor.isActive === dto.isActive) {
      return doctor;
    }

    doctor.isActive = dto.isActive;
    return this.repo.save(doctor);
  }

  async hardDelete(id: number) {
    const result = await this.repo.delete({ id });

    if (result.affected === 0) {
      throw new NotFoundException('Medico no encontrado.');
    }

    return { message: 'Medico eliminado definitivamente de la base de datos.' };
  }

  async existsByLicense(licenseNumber: string) {
    const doctor = await this.findDoctorDuplicateByLicense(
      licenseNumber,
      undefined,
      true,
    );

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
      return this.findDoctorDuplicateByLicense(payload.licenseNumber);
    }

    if (payload.email) {
      const byEmail = await this.findDoctorDuplicateByNameAndEmail({
        firstName: payload.firstName,
        lastName: payload.lastName,
        middleName: payload.middleName,
        email: payload.email,
      });
      if (byEmail) {
        return byEmail;
      }
    }

    return this.findDoctorDuplicateByNameOnly({
      firstName: payload.firstName,
      lastName: payload.lastName,
      middleName: payload.middleName,
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
