import 'reflect-metadata';
import 'dotenv/config';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { WorkerModule } from './worker.module';

async function bootstrap(): Promise<void> {
  // Standalone context: no HTTP adapter for the job logic. The only HTTP is the
  // tiny health server owned by HealthService.
  const app = await NestFactory.createApplicationContext(WorkerModule);

  // Wire SIGTERM/SIGINT -> app.close() -> onModuleDestroy / onApplicationShutdown.
  // This drains the BullMQ worker and aborts in-flight sleeps gracefully.
  app.enableShutdownHooks();

  new Logger('bootstrap').log(
    `worker started (concurrency=${process.env.WORKER_CONCURRENCY ?? 10})`,
  );
}

void bootstrap();
