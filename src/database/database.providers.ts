import { ConfigService } from '@nestjs/config';
import { Pool, type PoolConfig } from 'pg';
import { toNumber } from 'src/config/env.utils';
import { DB_ADMIN_POOL, DB_RECEPCIONISTA_POOL } from './database.constants';

const resolveSsl = (value: string | undefined): PoolConfig['ssl'] => {
  if (!value) return { rejectUnauthorized: false };

  const normalized = value.trim().toLowerCase();
  if (normalized === 'false' || normalized === '0' || normalized === 'off') return false;
  return { rejectUnauthorized: false };
};

const buildBaseConfig = (config: ConfigService): PoolConfig => ({
  host: config.getOrThrow<string>('DATABASE_HOST'),
  port: toNumber(config.get<string>('DATABASE_PORT'), 5432),
  database: config.getOrThrow<string>('DATABASE_NAME'),
  ssl: resolveSsl(config.get<string>('DATABASE_SSL')),
});

export const databaseProviders = [
  {
    provide: DB_ADMIN_POOL,
    inject: [ConfigService],
    useFactory: (config: ConfigService) =>
      new Pool({
        ...buildBaseConfig(config),
        user: config.getOrThrow<string>('DATABASE_ADMIN_USER'),
        password: config.getOrThrow<string>('DATABASE_ADMIN_PASS'),
      }),
  },
  {
    provide: DB_RECEPCIONISTA_POOL,
    inject: [ConfigService],
    useFactory: (config: ConfigService) =>
      new Pool({
        ...buildBaseConfig(config),
        user: config.getOrThrow<string>('DATABASE_RECEPCIONISTA_USER'),
        password: config.getOrThrow<string>('DATABASE_RECEPCIONISTA_PASS'),
      }),
  },
];
