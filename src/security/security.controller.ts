import { Controller, Get, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { SecurityService } from './security.service';

@Controller('security')
export class SecurityController {
  constructor(private readonly securityService: SecurityService) {}

  @Get('csrf-token')
  getCsrfToken(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const cookieName = this.securityService.getCsrfCookieName();
    const currentSecret =
      typeof req.cookies?.[cookieName] === 'string'
        ? req.cookies[cookieName]
        : undefined;

    return {
      csrfToken: this.securityService.issueCsrfToken(res, currentSecret),
      headerName: this.securityService.getCsrfHeaderName(),
    };
  }
}
