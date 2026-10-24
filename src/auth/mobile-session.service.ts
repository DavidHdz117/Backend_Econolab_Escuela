import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource, EntityManager } from 'typeorm';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import * as jwt from 'jsonwebtoken';
import { User } from 'src/users/entities/user.entity';
import { UserSession } from './entities/user-session.entity';
import { Role } from 'src/common/enums/roles.enum';

const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const digest = (token: string) =>
  createHash('sha256').update(token).digest('hex');

/** Opaque, single-use refresh tokens; only their hashes are persisted. */
@Injectable()
export class MobileSessionService {
  constructor(
    private readonly db: DataSource,
    private readonly config: ConfigService,
  ) {}

  private async issue(
    manager: EntityManager,
    session: UserSession,
    user: User,
  ) {
    const refreshToken = `${randomUUID()}.${randomBytes(32).toString('base64url')}`;
    const expiresAt = new Date(
      Math.min(session.expiresAt.getTime(), Date.now() + REFRESH_TTL_MS),
    );
    await manager.query(
      'INSERT INTO mobile_refresh_tokens (token_hash, session_id, expires_at) VALUES ($1, $2, $3)',
      [digest(refreshToken), session.id, expiresAt],
    );
    const usuario = {
      id: String(user.id),
      nombre: user.nombre,
      email: user.email,
      rol: user.rol,
    };
    const token = jwt.sign(
      { sub: usuario.id, ...usuario, jti: session.id },
      this.config.getOrThrow<string>('JWT_SECRET'),
      { algorithm: 'HS256', expiresIn: '15m' },
    );
    return {
      token,
      usuario,
      refreshToken,
      refreshExpiresAt: expiresAt.toISOString(),
    };
  }

  async start(sessionId: string, user: User) {
    return this.db.transaction(async (manager) => {
      const session = await manager
        .getRepository(UserSession)
        .findOneByOrFail({ id: sessionId });
      return this.issue(manager, session, user);
    });
  }

  async refresh(refreshToken: string) {
    const result = await this.db.transaction(async (manager) => {
      // Lock the session first: refresh, reuse revocation and logout serialize on it.
      const rows = await manager.query<{ session_id: string }[]>(
        'SELECT session_id FROM mobile_refresh_tokens WHERE token_hash = $1',
        [digest(refreshToken)],
      );
      if (!rows.length) return null;
      const session = await manager.getRepository(UserSession).findOne({
        where: { id: rows[0].session_id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!session || session.revoked || session.expiresAt <= new Date())
        return null;
      const tokens = await manager.query<
        { consumed_at: Date | null; expires_at: Date }[]
      >(
        'SELECT consumed_at, expires_at FROM mobile_refresh_tokens WHERE token_hash = $1 FOR UPDATE',
        [digest(refreshToken)],
      );
      if (!tokens.length) return null;
      if (tokens[0].consumed_at) {
        // Commit revocation before returning 401; throwing inside the transaction would undo it.
        await manager
          .getRepository(UserSession)
          .update(session.id, { revoked: true });
        return null;
      }
      if (new Date(tokens[0].expires_at) <= new Date()) return null;
      const withUser = await manager
        .getRepository(UserSession)
        .findOne({ where: { id: session.id }, relations: ['user'] });
      const user = withUser?.user;
      if (
        !user ||
        !user.confirmed ||
        user.rol === Role.Unassigned ||
        (user.lockUntil && user.lockUntil > new Date())
      )
        return null;
      await manager.query(
        'UPDATE mobile_refresh_tokens SET consumed_at = NOW() WHERE token_hash = $1',
        [digest(refreshToken)],
      );
      return this.issue(manager, session, user);
    });
    if (!result)
      throw new UnauthorizedException(
        'La sesión terminó. Inicia sesión de nuevo.',
      );
    return result;
  }

  async revoke(refreshToken: string) {
    await this.db.query(
      `UPDATE user_session SET revoked = TRUE WHERE id IN
      (SELECT session_id FROM mobile_refresh_tokens WHERE token_hash = $1)`,
      [digest(refreshToken)],
    );
    return { message: 'Sesión cerrada' };
  }
}
