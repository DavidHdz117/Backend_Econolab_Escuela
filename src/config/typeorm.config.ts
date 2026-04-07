import { ConfigService } from '@nestjs/config';
import type { TypeOrmModuleOptions } from '@nestjs/typeorm';
import { toBoolean, toNumber } from './env.utils';

const resolveSsl = (
  value: string | undefined,
): false | { rejectUnauthorized: false } => {
  if (!value) {
    return false;
  }

  const normalized = value.trim().toLowerCase();
  if (['false', '0', 'off'].includes(normalized)) {
    return false;
  }

  return { rejectUnauthorized: false };
};

export const typeOrmConfig = (
  configService: ConfigService,
): TypeOrmModuleOptions => ({
  type: 'postgres',
  host: configService.getOrThrow<string>('DATABASE_HOST'),
  port: toNumber(configService.get<string>('DATABASE_PORT'), 5432),
  username: configService.getOrThrow<string>('DATABASE_USER'),
  password: configService.getOrThrow<string>('DATABASE_PASS'),
  database: configService.getOrThrow<string>('DATABASE_NAME'),
  ssl: resolveSsl(configService.get<string>('DATABASE_SSL')),
  logging: toBoolean(configService.get<string>('DATABASE_LOGGING'), false),
  autoLoadEntities: true,
  synchronize: toBoolean(
    configService.get<string>('DATABASE_SYNCHRONIZE'),
    false,
  ),
});
