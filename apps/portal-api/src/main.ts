import 'reflect-metadata';
import cookieParser from 'cookie-parser';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';

/**
 * Separate process, separate realm (ADR-0004): distinct cookie name
 * (__Host-kms_padm), distinct user store (platformAdmins), distinct
 * Redis session prefix. Never shares a session namespace with apps/api.
 */
async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  app.set('trust proxy', 1);
  app.use(cookieParser());
  const port = process.env.PORT ? Number(process.env.PORT) : 3100;
  await app.listen(port);
}

bootstrap();
