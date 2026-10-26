import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { QUEUE_NAME, type JobPayload } from '@queue-lab/shared';
import { RedisBookkeeper } from './redis-bookkeeper.service';
import { ShutdownService } from './shutdown.service';
import { abortableSleep } from './abortable-sleep';

const CONCURRENCY = Number(process.env.WORKER_CONCURRENCY ?? 10);

/**
 * Worker lock / stall tuning (why these values):
 *
 * - lockDuration 30000 (30s): BullMQ holds a lock on the job for 30s and
 *   auto-renews it every lockDuration/2 while process() is running. Our work is
 *   a non-blocking timer, so even a 600s job keeps renewing its lock as long as
 *   the process is alive. If the pod dies, the lock expires 30s later and the
 *   job becomes "stalled" and eligible for recovery — this is what makes a
 *   killed pod lose no work (delivery is at-least-once, not at-most-once).
 *
 * - maxStalledCount 1: a job recovered from a stall is retried at most once as
 *   "stalled" before BullMQ fails it. This bounds reprocessing after a crash
 *   while still recovering the in-flight job. A recovered job is re-run, so its
 *   started counter crosses 1 and the duplicate counter ticks — exactly what we
 *   want to measure.
 */
@Processor(QUEUE_NAME, {
  concurrency: CONCURRENCY,
  lockDuration: 30_000,
  maxStalledCount: 1,
})
export class LoadTestProcessor extends WorkerHost {
  private readonly logger = new Logger(LoadTestProcessor.name);

  constructor(
    private readonly redis: RedisBookkeeper,
    private readonly shutdown: ShutdownService,
  ) {
    super();
  }

  async process(job: Job<JobPayload>): Promise<void> {
    const { batchId, index, durationMs } = job.data;
    const attempt = job.attemptsMade + 1;
    this.logger.log(`started batch=${batchId} index=${index} attempt=${attempt}`);

    // Record the start. value > 1 means this (batch,index) ran before: a duplicate.
    const started = await this.redis.recordStart(batchId, index);
    if (started > 1) {
      const dup = await this.redis.recordDuplicate(batchId);
      this.logger.warn(
        `DUPLICATE batch=${batchId} index=${index} started=${started} duplicates=${dup}`,
      );
    }

    // Simulate work. Jitter is baked into durationMs per-job by the producer
    // (the shared JobPayload carries no jitter field), so we just sleep it.
    await abortableSleep(durationMs, this.shutdown.signal);

    await this.redis.recordDone(batchId);
    this.logger.log(`finished batch=${batchId} index=${index}`);
  }
}
