import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { setupApiDocs } from './docs/api-docs';

export async function createApplication() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  // the staff spreadsheet import (D86) posts up to 2,000 rows as JSON; the default 100 kB is too small for it
  app.useBodyParser('json', { limit: '2mb' });
  const config = app.get(ConfigService);
  app.setGlobalPrefix('api', { exclude: ['health'] });
  app.use(helmet());
  app.enableCors({
    origin: config.getOrThrow<string[]>('CORS_ORIGINS'),
    credentials: true,
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  setupApiDocs(app);
  app.enableShutdownHooks();
  return app;
}
