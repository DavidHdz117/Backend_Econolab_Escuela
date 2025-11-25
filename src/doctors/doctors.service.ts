import {Injectable, ConflictException, NotFoundException,} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Like, Not } from 'typeorm';
import { Doctor } from './entities/doctor.entity';
import { CreateDoctorDto } from './dto/create-doctor.dto';
import { UpdateDoctorDto } from './dto/update-doctor.dto';

@Injectable()
export class DoctorsService {
  constructor(
    @InjectRepository(Doctor)
    private readonly repo: Repository<Doctor>,
  ) {}

  /**
   * Búsqueda de médicos
   * Soporta búsqueda por nombre, email, teléfono o cédula.
   */
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

  /**
   * Crear médico
   * Valida que no exista otro con la misma cédula profesional.
   */
  async create(dto: CreateDoctorDto) {
    if (dto.licenseNumber) {
      const exists = await this.repo.findOne({
        where: { licenseNumber: dto.licenseNumber },
      });
      if (exists) {
        throw new ConflictException(
          'Ya existe un médico registrado con esta cédula profesional.',
        );
      }
    }

    const entity = this.repo.create(dto);
    return this.repo.save(entity);
  }

  /**
   * Obtener un médico por id (solo activos).
   */
  async findOne(id: number) {
    const doctor = await this.repo.findOne({ where: { id, isActive: true } });
    if (!doctor) {
      throw new NotFoundException('Médico no encontrado.');
    }
    return doctor;
  }

  /**
   * Actualizar médico
   * Valida que no se repita la cédula con otro registro.
   */
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
          'Ya existe otro médico con esta cédula profesional.',
        );
      }
    }

    const merged = this.repo.merge(doctor, dto);
    return this.repo.save(merged);
  }

  /**
   * Baja lógica
   */
  async softDelete(id: number) {
    await this.findOne(id);
    await this.repo.update({ id }, { isActive: false });
    return { message: 'Médico desactivado correctamente.' };
  }

  /**
   * Eliminación física de la BD
   */
  async hardDelete(id: number) {
    const result = await this.repo.delete({ id });

    if (result.affected === 0) {
      throw new NotFoundException('Médico no encontrado.');
    }

    return { message: 'Médico eliminado definitivamente de la base de datos.' };
  }

  /**
   * Verificar existencia por cédula profesional
   */
  async existsByLicense(licenseNumber: string) {
    const doctor = await this.repo.findOne({
      where: { licenseNumber, isActive: true },
      select: ['id'],
    });
    return { exists: !!doctor, doctorId: doctor?.id ?? null };
  }
}
