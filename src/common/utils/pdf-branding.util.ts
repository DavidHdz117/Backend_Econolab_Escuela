import * as fs from 'fs';
import { isAbsolute, join } from 'path';

const DEFAULT_LAB_LOGO_FILE = 'econolab-brand.png';
export const DEFAULT_LAB_NAME = 'ECONOLAB';
export const DEFAULT_LAB_SUBTITLE = 'LABORATORIO DE ANALISIS CLINICOS';
export const DEFAULT_LAB_ADDRESS =
  'MATRIZ: BOULEVARD ADOLFO LOPEZ MATEOS COLONIA AVIACION CIVIL';
export const DEFAULT_LAB_ADDRESS_2 =
  'TOMA DE MUESTRA: CALLE CONSTITUYENTES COLONIA CANTORES';
export const DEFAULT_LAB_ADDRESS_3 = 'HUEJUTLA DE REYES, HIDALGO';
export const DEFAULT_LAB_PHONE = '771 199 3821 - CEL. 771 158 1482';

function resolveExistingPath(filePath?: string | null) {
  const normalized = filePath?.trim();
  if (!normalized) return '';

  const candidates = isAbsolute(normalized)
    ? [normalized]
    : [normalized, join(process.cwd(), normalized)];

  return candidates.find((candidate) => fs.existsSync(candidate)) ?? '';
}

export function resolveLabLogoPath(explicitPath?: string | null) {
  const configuredPath = resolveExistingPath(explicitPath);
  if (configuredPath) {
    return configuredPath;
  }

  const fallbackCandidates = [
    join(process.cwd(), 'pdf', 'assets', DEFAULT_LAB_LOGO_FILE),
    join(process.cwd(), 'dist', 'pdf', 'assets', DEFAULT_LAB_LOGO_FILE),
  ];

  return (
    fallbackCandidates.find((candidate) => fs.existsSync(candidate)) ?? ''
  );
}
