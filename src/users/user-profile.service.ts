import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { QueryFailedError, Raw, Repository } from 'typeorm';
import { checkPassword } from '../common/utils/crypto.util';
import { User } from './entities/user.entity';
import { UpdateProfileDto } from './dto/update-profile.dto';

export type UserProfile = Pick<User, 'id' | 'nombre' | 'email' | 'rol'>;

@Injectable()
export class UserProfileService {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
  ) {}

  async getProfile(userId: string): Promise<UserProfile> {
    const user = await this.users.findOne({
      where: { id: userId },
      select: ['id', 'nombre', 'email', 'rol'],
    });
    if (!user) throw new NotFoundException('Usuario no encontrado');
    return {
      id: user.id,
      nombre: user.nombre,
      email: user.email,
      rol: user.rol,
    };
  }

  async updateProfile(userId: string, dto: UpdateProfileDto) {
    if (dto.nombre === undefined && dto.email === undefined) {
      throw new BadRequestException(
        'Indica el nombre o correo que quieres actualizar',
      );
    }
    const user = await this.users.findOne({
      where: { id: userId },
      select: ['id', 'nombre', 'email', 'rol', 'password'],
    });
    if (!user) throw new NotFoundException('Usuario no encontrado');
    const emailChanged =
      dto.email !== undefined && dto.email !== user.email.toLowerCase();
    if (emailChanged) {
      if (!dto.current_password)
        throw new BadRequestException(
          'Confirma tu contraseña actual para cambiar el correo',
        );
      if (!(await checkPassword(dto.current_password, user.password)))
        throw new UnauthorizedException('Contraseña actual incorrecta');
    }
    if (dto.email !== undefined) {
      const existing = await this.users.findOne({
        where: {
          email: Raw((alias) => `LOWER(${alias}) = :profileEmail`, {
            profileEmail: dto.email,
          }),
        },
        select: ['id'],
      });
      if (existing && String(existing.id) !== String(userId))
        throw new ConflictException('El correo ya está registrado');
    }
    // Actualización parcial: no sobrescribe rol, contraseña ni otros campos de autenticación.
    const changes: Pick<UpdateProfileDto, 'nombre' | 'email'> = {};
    if (dto.nombre !== undefined) changes.nombre = dto.nombre;
    if (dto.email !== undefined) changes.email = dto.email;
    try {
      await this.users.update({ id: userId }, changes);
    } catch (error) {
      if (
        error instanceof QueryFailedError &&
        (error.driverError as { code?: string }).code === '23505'
      ) {
        throw new ConflictException('El correo ya está registrado');
      }
      throw error;
    }
    return {
      message: 'Perfil actualizado',
      usuario: await this.getProfile(userId),
    };
  }
}
