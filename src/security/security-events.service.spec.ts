import { Logger } from '@nestjs/common';
import type { Request } from 'express';
import { SecurityEventsService } from './security-events.service';

describe('SecurityEventsService credential redaction', () => {
  let warn: jest.SpyInstance;
  beforeEach(() => {
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
  });
  afterEach(() => jest.restoreAllMocks());

  it('never copies refresh or password values from suspicious matches into logs', () => {
    const privateValue = 'fixture-value--not-for-logs';
    new SecurityEventsService().logSuspiciousPayload(
      {
        method: 'POST',
        originalUrl: '/api/auth/refresh',
        headers: {},
        ip: '127.0.0.1',
        body: { refreshToken: privateValue, currentPassword: privateValue },
        query: {},
        params: {},
      } as unknown as Request,
      [
        {
          kind: 'sql_injection',
          path: 'body.refreshToken',
          value: privateValue,
        },
        {
          kind: 'sql_injection',
          path: 'body.currentPassword',
          value: privateValue,
        },
      ],
    );
    const output = String(warn.mock.calls[0][0]);
    expect(output).not.toContain(privateValue);
    expect(output).toContain('sql_injection');
    expect(output).toContain('[REDACTED]');
  });

  it('removes query credentials and reset tokens from the logged endpoint', () => {
    new SecurityEventsService().logCsrfViolation({
      method: 'POST',
      originalUrl:
        '/api/users/reset-password/fixture-reset?token=fixture-query',
      headers: {},
      ip: '127.0.0.1',
      body: {},
      query: { token: 'fixture-query' },
      params: { token: 'fixture-reset' },
    } as unknown as Request);
    const output = String(warn.mock.calls[0][0]);
    expect(output).not.toContain('fixture-reset');
    expect(output).not.toContain('fixture-query');
    expect(output).toContain('/api/users/reset-password/[REDACTED]');
  });
});
