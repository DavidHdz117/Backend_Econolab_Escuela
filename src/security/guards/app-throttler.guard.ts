import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

@Injectable()
export class AppThrottlerGuard extends ThrottlerGuard {
  protected async getTracker(req: Record<string, any>): Promise<string> {
    const forwardedFor = req.headers?.['x-forwarded-for'];

    if (typeof forwardedFor === 'string' && forwardedFor.trim()) {
      return forwardedFor.split(',')[0]?.trim() ?? req.ip ?? 'unknown';
    }

    if (Array.isArray(forwardedFor) && forwardedFor.length > 0) {
      return forwardedFor[0] ?? req.ip ?? 'unknown';
    }

    return req.ip ?? req.socket?.remoteAddress ?? 'unknown';
  }
}
