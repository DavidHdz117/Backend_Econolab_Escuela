import { Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { SUSPICIOUS_PAYLOAD_PATTERNS } from '../security.constants';
import { SecurityEventsService } from '../security-events.service';

type SuspiciousMatch = {
  kind: string;
  path: string;
  value: string;
};

@Injectable()
export class AttackDetectionMiddleware implements NestMiddleware {
  constructor(private readonly securityEvents: SecurityEventsService) {}

  use(req: Request, _res: Response, next: NextFunction) {
    const matches: SuspiciousMatch[] = [];

    this.inspectValue(req.body, 'body', matches);
    this.inspectValue(req.query, 'query', matches);
    this.inspectValue(req.params, 'params', matches);

    if (matches.length > 0) {
      this.securityEvents.logSuspiciousPayload(req, matches);
    }

    next();
  }

  private inspectValue(value: unknown, path: string, matches: SuspiciousMatch[]) {
    if (matches.length >= 5) {
      return;
    }

    if (Array.isArray(value)) {
      value.forEach((item, index) =>
        this.inspectValue(item, `${path}.${index}`, matches),
      );
      return;
    }

    if (!value || typeof value !== 'object' || value instanceof Date) {
      this.inspectScalar(value, path, matches);
      return;
    }

    Object.entries(value).forEach(([key, nestedValue]) =>
      this.inspectValue(nestedValue, `${path}.${key}`, matches),
    );
  }

  private inspectScalar(
    value: unknown,
    path: string,
    matches: SuspiciousMatch[],
  ) {
    if (typeof value !== 'string' || matches.length >= 5) {
      return;
    }

    for (const pattern of SUSPICIOUS_PAYLOAD_PATTERNS) {
      if (pattern.regex.test(value)) {
        matches.push({
          kind: pattern.kind,
          path,
          value,
        });
        return;
      }
    }
  }
}
