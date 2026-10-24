import { Injectable, OnModuleInit } from '@nestjs/common';
import { DataSource } from 'typeorm';

/** Additive, idempotent migration. Never alters or synchronizes existing tables. */
@Injectable()
export class MobileSchemaService implements OnModuleInit {
  constructor(private readonly db: DataSource) {}
  async onModuleInit() {
    await this.db.transaction(async (manager) => {
      await manager.query('SELECT pg_advisory_xact_lock(7732501)');
      await manager.query(`CREATE TABLE IF NOT EXISTS mobile_refresh_tokens (
        token_hash CHAR(64) PRIMARY KEY,
        session_id UUID NOT NULL REFERENCES user_session(id) ON DELETE CASCADE,
        expires_at TIMESTAMPTZ NOT NULL,
        consumed_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`);
      await manager.query(
        'CREATE INDEX IF NOT EXISTS mobile_refresh_tokens_session_idx ON mobile_refresh_tokens(session_id)',
      );
      await manager.query(`CREATE TABLE IF NOT EXISTS account_privacy (
        user_id INTEGER PRIMARY KEY REFERENCES "user"(id) ON DELETE CASCADE,
        notice_version VARCHAR(40),
        accepted_at TIMESTAMPTZ,
        optional_communications BOOLEAN NOT NULL DEFAULT FALSE,
        optional_analytics BOOLEAN NOT NULL DEFAULT FALSE,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`);
      // Expired opaque tokens contain no plaintext credentials; bounded cleanup on startup.
      await manager.query(
        'DELETE FROM mobile_refresh_tokens WHERE expires_at < NOW()',
      );
    });
  }
}
