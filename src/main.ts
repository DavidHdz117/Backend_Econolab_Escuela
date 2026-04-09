import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import cookieParser = require('cookie-parser');
import { AppModule } from './app.module';
import { HttpExceptionZodFilter } from './common/filters/http-exception-zod.filter';
import { validationExceptionFactory } from './common/validation/validation-exception.factory';
import { SecurityService } from './security/security.service';

const helmet = require('helmet') as typeof import('helmet');

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const logger = new Logger('Bootstrap');
  const configService = app.get(ConfigService);
  const securityService = app.get(SecurityService);
  const allowedOrigins = securityService.getAllowedOrigins();
  const expressApp = app.getHttpAdapter().getInstance();

  expressApp.set('trust proxy', securityService.getTrustProxy());
  expressApp.disable('x-powered-by');
  app.use(cookieParser());
  app.use(helmet.default(securityService.buildHelmetConfig()));
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      forbidUnknownValues: true,
      transform: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
      stopAtFirstError: true,
      exceptionFactory: validationExceptionFactory,
    }),
  );
  app.enableCors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
        return;
      }

      logger.warn(`Blocked CORS origin: ${origin}`);
      callback(new Error('Origin not allowed by CORS'));
    },
    credentials: true,
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      securityService.getCsrfHeaderName(),
      'X-Requested-With',
    ],
    optionsSuccessStatus: 204,
  });

  app.useGlobalFilters(new HttpExceptionZodFilter());
  app.setGlobalPrefix('api');

  const port = Number(configService.get<string>('PORT') ?? 3000);
  await app.listen(port);
  logger.log(`Server listening on ${await app.getUrl()}`);
}

void bootstrap();
