import {
  ForbiddenException,
  Injectable,
  type NestMiddleware,
} from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { SecurityEventsService } from '../security-events.service';
import { SecurityService } from '../security.service';

@Injectable()
export class CsrfProtectionMiddleware implements NestMiddleware {
  constructor(
    private readonly securityService: SecurityService,
    private readonly securityEvents: SecurityEventsService,
  ) {}

  use(req: Request, _res: Response, next: NextFunction) {
    if (this.securityService.shouldSkipCsrf(req)) {
      next();
      return;
    }

    const cookieName = this.securityService.getCsrfCookieName();
    const headerName = this.securityService.getCsrfHeaderName().toLowerCase();
    const secret =
      typeof req.cookies?.[cookieName] === 'string'
        ? req.cookies[cookieName]
        : undefined;
    const headerValue = req.headers[headerName];
    const token = Array.isArray(headerValue) ? headerValue[0] : headerValue;

    if (!this.securityService.validateCsrfToken(secret, token)) {
      this.securityEvents.logCsrfViolation(req);
      throw new ForbiddenException('CSRF token invalido o ausente.');
    }

    next();
  }
}
