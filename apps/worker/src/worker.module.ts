import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { QUEUE_NAME } from '@queue-lab/shared';
import { getRedisConnectionOptions } from './redis';
import { LoadTestProcessor } from './load-test.processor';
import { RedisBookkeeper } from './redis-bookkeeper.service';
import { ShutdownService } from './shutdown.service';
import { HealthService } from './health.service';

@Module({
  imports: [
    BullModule.forRoot({ connection: getRedisConnectionOptions() }),
    BullModule.registerQueue({ name: QUEUE_NAME }),
  ],
  providers: [LoadTestProcessor, RedisBookkeeper, ShutdownService, HealthService],
})
export class WorkerModule {}
