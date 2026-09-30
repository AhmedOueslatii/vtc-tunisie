import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { env } from './config/env.js';
import { RealtimeServer } from './modules/realtime/realtime.server.js';

const { PROCESS_ROLE, PORT, CORS_ORIGINS } = env();

if (PROCESS_ROLE === 'worker') {
  // Pas de HTTP : uniquement les consommateurs BullMQ (matching, et plus tard notifications, facturation).
  const app = await NestFactory.createApplicationContext(AppModule);
  app.enableShutdownHooks();
  Logger.log('Processus worker démarré', 'Bootstrap');
} else {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('v1');
  app.enableCors({ origin: CORS_ORIGINS.split(',').filter(Boolean) });
  app.enableShutdownHooks();
  app.get(RealtimeServer).attach(app.getHttpServer());
  await app.listen(PORT);
  Logger.log(`API (${PROCESS_ROLE}) sur http://localhost:${PORT}/v1`, 'Bootstrap');
}
