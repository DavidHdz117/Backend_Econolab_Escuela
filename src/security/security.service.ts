import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, randomBytes, timingSafeEqual } from 'crypto';
import type { CookieOptions, Request, Response } from 'express';
import type { HelmetOptions } from 'helmet';
import { isProduction, toBoolean, toNumber, toStringArray } from 'src/config/env.utils';
import { CSRF_EXCLUDED_ROUTES, SAFE_HTTP_METHODS } from './security.constants';

@Injectable()
export class SecurityService {
  constructor(private readonly config: ConfigService) {}

  getAllowedOrigins(): string[] {
    const configuredOrigins = toStringArray(this.config.get<string>('CORS_ORIGINS'));
    const fallbackOrigins = [
      this.config.get<string>('FRONTEND_URL'),
      this.isProduction() ? undefined : 'http://localhost:5173',
      this.isProduction() ? undefined : 'http://localhost:3000',
    ].filter((value): value is string => Boolean(value));

    return Array.from(new Set([...configuredOrigins, ...fallbackOrigins]));
  }

  buildHelmetConfig(): HelmetOptions {
    const directives: Record<string, string[]> = {
      defaultSrc: ["'self'"],
      baseUri: ["'self'"],
      frameAncestors: ["'none'"],
      formAction: ["'self'"],
      objectSrc: ["'none'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:', 'https:'],
      fontSrc: ["'self'", 'https:', 'data:'],
      connectSrc: ["'self'", ...this.getAllowedOrigins()],
    };

    if (this.isProduction()) {
      directives.upgradeInsecureRequests = [];
    }

    return {
      contentSecurityPolicy: {
        useDefaults: true,
        directives,
      },
      frameguard: { action: 'deny' },
      noSniff: true,
      hsts: this.shouldEnableHsts()
        ? {
            maxAge: 15552000,
            includeSubDomains: true,
            preload: true,
          }
        : false,
      referrerPolicy: { policy: 'no-referrer' },
    };
  }

  getCsrfCookieName(): string {
    return this.config.get<string>('CSRF_COOKIE_NAME') ?? '__Host-econolab-csrf';
  }

  getCsrfHeaderName(): string {
    return this.config.get<string>('CSRF_HEADER_NAME') ?? 'X-CSRF-Token';
  }

  issueCsrfToken(response: Response, currentSecret?: string): string {
    const secret = currentSecret?.trim() || randomBytes(32).toString('hex');
    response.cookie(this.getCsrfCookieName(), secret, this.getCsrfCookieOptions());
    return this.buildCsrfToken(secret);
  }

  validateCsrfToken(secret: string | undefined, token: string | undefined): boolean {
    if (!secret || !token) {
      return false;
    }

    const [nonce, signature] = token.split('.');
    if (!nonce || !signature) {
      return false;
    }

    const expectedSignature = this.signCsrfNonce(secret, nonce);
    return this.safeEquals(signature, expectedSignature);
  }

  shouldSkipCsrf(req: Request): boolean {
    const method = req.method.toUpperCase();
    if (SAFE_HTTP_METHODS.has(method)) {
      return true;
    }

    if (this.hasBearerToken(req)) {
      return true;
    }

    const path = (req.originalUrl ?? req.url).split('?')[0];
    return CSRF_EXCLUDED_ROUTES.some((pattern) => pattern.test(path));
  }

  getTrustProxy(): boolean | number {
    if (!this.isProduction()) {
      return toBoolean(this.config.get<string>('APP_TRUST_PROXY'), true);
    }

    const configured = this.config.get<string>('APP_TRUST_PROXY');
    if (configured == null) {
      return 1;
    }

    const asNumber = Number(configured);
    return Number.isFinite(asNumber)
      ? asNumber
      : toBoolean(configured, true);
  }

  getThrottleTtlMs(): number {
    return toNumber(this.config.get<string>('THROTTLE_TTL_MS'), 60_000);
  }

  getThrottleLimit(): number {
    return toNumber(this.config.get<string>('THROTTLE_LIMIT'), 120);
  }

  private isProduction(): boolean {
    return isProduction(this.config);
  }

  private shouldEnableHsts(): boolean {
    return toBoolean(
      this.config.get<string>('APP_ENABLE_HSTS'),
      this.isProduction(),
    );
  }

  private shouldUseSecureCookies(): boolean {
    return toBoolean(
      this.config.get<string>('COOKIE_SECURE'),
      this.isProduction(),
    );
  }

  private getCsrfCookieOptions(): CookieOptions {
    return {
      httpOnly: true,
      sameSite: 'strict',
      secure: this.shouldUseSecureCookies(),
      path: '/',
    };
  }

  private buildCsrfToken(secret: string): string {
    const nonce = randomBytes(16).toString('hex');
    const signature = this.signCsrfNonce(secret, nonce);
    return `${nonce}.${signature}`;
  }

  private signCsrfNonce(secret: string, nonce: string): string {
    return createHmac('sha256', this.getCsrfSalt())
      .update(`${nonce}.${secret}`)
      .digest('hex');
  }

  private getCsrfSalt(): string {
    return (
      this.config.get<string>('CSRF_SECRET_SALT') ??
      this.config.getOrThrow<string>('JWT_SECRET')
    );
  }

  private safeEquals(left: string, right: string): boolean {
    const leftBuffer = Buffer.from(left);
    const rightBuffer = Buffer.from(right);
    if (leftBuffer.length !== rightBuffer.length) {
      return false;
    }

    return timingSafeEqual(leftBuffer, rightBuffer);
  }

  private hasBearerToken(req: Request): boolean {
    const authorization = req.headers.authorization;
    return typeof authorization === 'string' && authorization.startsWith('Bearer ');
  }
}
