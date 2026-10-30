import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { allowedOrigins } from './config/server-config.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  app.enableShutdownHooks();
  // The admin panel calls /api/admin from the web origin (in dev, :3000 → :3001).
  app.enableCors({ origin: allowedOrigins() });
  const port = Number(process.env.PORT ?? 3001);
  await app.listen(port);
  const webOrigin = (process.env.WEB_ORIGIN ?? 'http://localhost:3000').split(',')[0]?.trim();
  Logger.log(`Volleyland server listening on http://localhost:${port}`, 'Bootstrap');
  Logger.log(`Play at ${webOrigin}/play`, 'Bootstrap');
  Logger.log(`Admin at ${webOrigin}/admin`, 'Bootstrap');
}

void bootstrap();
