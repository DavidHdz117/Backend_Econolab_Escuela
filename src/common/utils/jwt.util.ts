import * as jwt from 'jsonwebtoken';
import { Secret } from 'jsonwebtoken';
import { Role } from '../enums/roles.enum';

export const AUTH_SESSION_TTL = '30d';
export const AUTH_SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30;

/** Payload que graba dentro del JWT */
export interface AppJwtPayload extends jwt.JwtPayload {
  sub: string;        // id del usuario
  email: string;
  nombre: string;
  rol: Role;
  jti?: string;       // id de la sesión
  iat?: number;
  exp?: number;
}

export function generateJWT(payload: AppJwtPayload): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('Falta la variable de entorno JWT_SECRET');

  return jwt.sign(payload, secret as Secret, {
    expiresIn: AUTH_SESSION_TTL,
    algorithm: 'HS256',
  });
}
