import { Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { SENSITIVE_FIELD_PATTERN } from '../security.constants';

@Injectable()
export class RequestSanitizationMiddleware implements NestMiddleware {
  use(req: Request, _res: Response, next: NextFunction) {
    req.body = this.sanitizeValue(req.body, []) as typeof req.body;
    this.mutateRecord(req.query as Record<string, unknown>, []);
    this.mutateRecord(req.params as Record<string, unknown>, []);
    next();
  }

  private mutateRecord(target: Record<string, unknown>, path: string[]) {
    if (!target || typeof target !== 'object' || Array.isArray(target)) {
      return;
    }

    for (const [key, value] of Object.entries(target)) {
      target[key] = this.sanitizeValue(value, [...path, key]);
    }
  }

  private sanitizeValue(value: unknown, path: string[]): unknown {
    if (Array.isArray(value)) {
      return value.map((entry, index) =>
        this.sanitizeValue(entry, [...path, String(index)]),
      );
    }

    if (!value || typeof value !== 'object' || value instanceof Date) {
      return this.sanitizeScalar(value, path);
    }

    const clone = { ...(value as Record<string, unknown>) };
    this.mutateRecord(clone, path);
    return clone;
  }

  private sanitizeScalar(value: unknown, path: string[]): unknown {
    if (typeof value !== 'string') {
      return value;
    }

    const withoutNullBytes = value.replace(/\0/g, '');
    const currentKey = path[path.length - 1] ?? '';
    if (SENSITIVE_FIELD_PATTERN.test(currentKey)) {
      return withoutNullBytes;
    }

    const withoutScripts = withoutNullBytes.replace(
      /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi,
      '',
    );

    return withoutScripts.replace(/<\/?[^>]+(>|$)/g, '').trim();
  }
}
