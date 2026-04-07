import {
  MiddlewareConsumer,
  Module,
  type NestModule,
  RequestMethod,
} from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { toNumber } from 'src/config/env.utils';
import { SecurityController } from './security.controller';
import { SecurityEventsService } from './security-events.service';
import { SecurityService } from './security.service';
import { AppThrottlerGuard } from './guards/app-throttler.guard';
import { AttackDetectionMiddleware } from './middleware/attack-detection.middleware';
import { CacheControlMiddleware } from './middleware/cache-control.middleware';
import { CsrfProtectionMiddleware } from './middleware/csrf-protection.middleware';
import { RequestSanitizationMiddleware } from './middleware/request-sanitization.middleware';

@Module({
  imports: [
    ConfigModule,
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: async (configService: ConfigService) => ({
        errorMessage: 'Demasiadas solicitudes. Intenta nuevamente en unos minutos.',
        throttlers: [
          {
            name: 'default',
            ttl: toNumber(configService.get<string>('THROTTLE_TTL_MS'), 60_000),
            limit: toNumber(configService.get<string>('THROTTLE_LIMIT'), 120),
          },
        ],
      }),
    }),
  ],
  controllers: [SecurityController],
  providers: [
    SecurityService,
    SecurityEventsService,
    AttackDetectionMiddleware,
    CacheControlMiddleware,
    CsrfProtectionMiddleware,
    RequestSanitizationMiddleware,
    {
      provide: APP_GUARD,
      useClass: AppThrottlerGuard,
    },
  ],
  exports: [SecurityService, SecurityEventsService],
})
export class SecurityModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(
        CacheControlMiddleware,
        AttackDetectionMiddleware,
        RequestSanitizationMiddleware,
        CsrfProtectionMiddleware,
      )
      .forRoutes({ path: '*', method: RequestMethod.ALL });
  }
}
