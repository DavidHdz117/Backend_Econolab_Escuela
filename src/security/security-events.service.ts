import { Injectable, Logger } from '@nestjs/common';
import type { Request } from 'express';
import { SENSITIVE_FIELD_PATTERN } from './security.constants';

type SuspiciousMatch = {
  kind: string;
  path: string;
  value: string;
};

@Injectable()
export class SecurityEventsService {
  private readonly logger = new Logger(SecurityEventsService.name);

  logSuspiciousPayload(req: Request, matches: SuspiciousMatch[]) {
    this.logger.warn(
      JSON.stringify({
        event: 'suspicious_payload_detected',
        ...this.buildRequestContext(req),
        matches: matches.slice(0, 5).map((match) => ({
          ...match,
          value: this.truncate(match.value, 180),
        })),
      }),
    );
  }

  logCsrfViolation(req: Request) {
    this.logger.warn(
      JSON.stringify({
        event: 'csrf_validation_failed',
        ...this.buildRequestContext(req),
      }),
    );
  }

  private buildRequestContext(req: Request) {
    return {
      ip: this.getClientIp(req),
      method: req.method,
      endpoint: req.originalUrl ?? req.url,
      payload: {
        params: this.redactPayload(req.params),
        query: this.redactPayload(req.query),
        body: this.redactPayload(req.body),
      },
    };
  }

  private getClientIp(req: Request): string {
    const forwardedFor = req.headers['x-forwarded-for'];
    if (typeof forwardedFor === 'string' && forwardedFor.trim()) {
      return forwardedFor.split(',')[0]?.trim() ?? req.ip;
    }

    if (Array.isArray(forwardedFor) && forwardedFor.length > 0) {
      return forwardedFor[0] ?? req.ip;
    }

    return req.ip ?? 'unknown';
  }

  private redactPayload(value: unknown): unknown {
    if (Array.isArray(value)) {
      return value.map((item) => this.redactPayload(item));
    }

    if (!value || typeof value !== 'object' || value instanceof Date) {
      return this.redactScalar(value);
    }

    return Object.fromEntries(
      Object.entries(value).map(([key, nestedValue]) => [
        key,
        SENSITIVE_FIELD_PATTERN.test(key)
          ? '[REDACTED]'
          : this.redactPayload(nestedValue),
      ]),
    );
  }

  private redactScalar(value: unknown): unknown {
    if (typeof value !== 'string') {
      return value;
    }

    return this.truncate(value, 400);
  }

  private truncate(value: string, maxLength: number): string {
    if (value.length <= maxLength) {
      return value;
    }

    return `${value.slice(0, maxLength)}...`;
  }
}
