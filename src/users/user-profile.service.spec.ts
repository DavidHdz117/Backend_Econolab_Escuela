import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { QueryFailedError, type Repository } from 'typeorm';
import { UserProfileService } from './user-profile.service';
import { User } from './entities/user.entity';
import { Role } from '../common/enums/roles.enum';
import { checkPassword } from '../common/utils/crypto.util';

jest.mock('../common/utils/crypto.util', () => ({ checkPassword: jest.fn() }));
const profile = {
  id: '13',
  nombre: 'Prueba',
  email: 'prueba@example.test',
  rol: Role.Recepcionista,
};
const stored = {
  ...profile,
  password: 'test-only-hash',
  token: 'private-fixture',
};

describe('UserProfileService', () => {
  const repository = { findOne: jest.fn(), update: jest.fn() };
  const service = new UserProfileService(
    repository as unknown as Repository<User>,
  );
  beforeEach(() => {
    jest.resetAllMocks();
    repository.update.mockResolvedValue({ affected: 1 });
    jest.mocked(checkPassword).mockResolvedValue(true);
  });

  it('returns only public fields and selects the authenticated subject', async () => {
    repository.findOne.mockResolvedValue(stored);
    await expect(service.getProfile('13')).resolves.toEqual(profile);
    expect(repository.findOne).toHaveBeenCalledWith({
      where: { id: '13' },
      select: ['id', 'nombre', 'email', 'rol'],
    });
  });
  it('rejects a missing user', async () => {
    repository.findOne.mockResolvedValue(null);
    await expect(service.getProfile('13')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
  it('updates the name without requiring a password and never writes protected fields', async () => {
    repository.findOne
      .mockResolvedValueOnce(stored)
      .mockResolvedValueOnce({ ...profile, nombre: 'Nuevo nombre' });
    await expect(
      service.updateProfile('13', { nombre: 'Nuevo nombre' }),
    ).resolves.toEqual({
      message: 'Perfil actualizado',
      usuario: { ...profile, nombre: 'Nuevo nombre' },
    });
    expect(repository.update).toHaveBeenCalledWith(
      { id: '13' },
      { nombre: 'Nuevo nombre' },
    );
    expect(checkPassword).not.toHaveBeenCalled();
  });
  it('requires the current password before changing email', async () => {
    repository.findOne.mockResolvedValue(stored);
    await expect(
      service.updateProfile('13', { email: 'nuevo@example.test' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(repository.update).not.toHaveBeenCalled();
  });
  it('does not write a new email with a wrong password', async () => {
    repository.findOne.mockResolvedValue(stored);
    jest.mocked(checkPassword).mockResolvedValue(false);
    await expect(
      service.updateProfile('13', {
        email: 'nuevo@example.test',
        current_password: 'fixture8!',
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(repository.update).not.toHaveBeenCalled();
  });
  it('allows a verified new email and returns its persisted value', async () => {
    repository.findOne
      .mockResolvedValueOnce(stored)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ ...profile, email: 'nuevo@example.test' });
    await expect(
      service.updateProfile('13', {
        email: 'nuevo@example.test',
        current_password: 'fixture8!',
      }),
    ).resolves.toMatchObject({ usuario: { email: 'nuevo@example.test' } });
    expect(repository.update).toHaveBeenCalledWith(
      { id: '13' },
      { email: 'nuevo@example.test' },
    );
  });
  it('rejects an email already owned by another user', async () => {
    repository.findOne
      .mockResolvedValueOnce(stored)
      .mockResolvedValueOnce({ id: '14' });
    await expect(
      service.updateProfile('13', {
        email: 'otro@example.test',
        current_password: 'fixture8!',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(repository.update).not.toHaveBeenCalled();
  });
  it('handles a concurrent unique-email violation without exposing database details', async () => {
    repository.findOne
      .mockResolvedValueOnce(stored)
      .mockResolvedValueOnce(null);
    repository.update.mockRejectedValue(
      new QueryFailedError('private SQL fixture', [], {
        code: '23505',
      } as unknown as Error),
    );
    await expect(
      service.updateProfile('13', {
        email: 'nuevo@example.test',
        current_password: 'fixture8!',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
  it('rejects an empty update', async () => {
    await expect(service.updateProfile('13', {})).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(repository.findOne).not.toHaveBeenCalled();
  });
});
