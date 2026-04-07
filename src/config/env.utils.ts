import { ConfigService } from '@nestjs/config';

export const toBoolean = (
  value: string | boolean | undefined,
  fallback = false,
): boolean => {
  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value !== 'string') {
    return fallback;
  }

  const normalized = value.trim().toLowerCase();
  if (['true', '1', 'yes', 'on'].includes(normalized)) {
    return true;
  }

  if (['false', '0', 'no', 'off'].includes(normalized)) {
    return false;
  }

  return fallback;
};

export const toNumber = (
  value: string | number | undefined,
  fallback: number,
): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const toStringArray = (
  value: string | string[] | undefined,
  fallback: string[] = [],
): string[] => {
  if (Array.isArray(value)) {
    return value.map((item) => item.trim()).filter(Boolean);
  }

  if (typeof value !== 'string') {
    return [...fallback];
  }

  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
};

export const isProduction = (config: ConfigService): boolean =>
  config.get<string>('NODE_ENV') === 'production';
