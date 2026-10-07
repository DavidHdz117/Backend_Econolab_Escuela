import { ValidationPipe } from '@nestjs/common';
import { UpdateProfileDto } from './update-profile.dto';

describe('UpdateProfileDto and the existing strict validation policy', () => {
  const pipe = new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    transformOptions: { enableImplicitConversion: true },
  });
  const transform = (body: unknown) =>
    pipe.transform(body, { type: 'body', metatype: UpdateProfileDto });
  it('normalizes whitespace and email case', async () => {
    await expect(
      transform({ nombre: '  Jesús David  ', email: ' JESUS@EXAMPLE.TEST ' }),
    ).resolves.toMatchObject({
      nombre: 'Jesús David',
      email: 'jesus@example.test',
    });
  });
  it.each(['id', 'rol', 'password', 'confirmed', 'token'])(
    'rejects protected field %s',
    async (field) => {
      await expect(
        transform({ nombre: 'Prueba', [field]: 'malicious-fixture' }),
      ).rejects.toMatchObject({ status: 400 });
    },
  );
  it.each([
    { nombre: null },
    { email: null },
    { nombre: ' ' },
    { nombre: '<script>' },
    { nombre: 'A'.repeat(51) },
    { email: 'invalid' },
    { email: `${'a'.repeat(45)}@example.test` },
  ])('rejects invalid data %p', async (body) => {
    await expect(transform(body)).rejects.toMatchObject({ status: 400 });
  });
});
