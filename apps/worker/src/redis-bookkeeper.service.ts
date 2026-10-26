import { Injectable, OnApplicationShutdown } from '@nestjs/common';
import IORedis, { type Redis } from 'ioredis';
import { batchKeys, BATCH_KEY_TTL_SECONDS } from '@queue-lab/shared';
import { getRedisConnectionOptions } from './redis';

/**
 * Per-batch bookkeeping in Redis, kept separate from the BullMQ connection.
 * Every key is set to expire 24h after its last write.
 */
@Injectable()
export class RedisBookkeeper implements OnApplicationShutdown {
  private readonly client: Redis = new IORedis(getRedisConnectionOptions());

  /** INCR the per-(batch,index) started counter; returns the new value. */
  async recordStart(batchId: string, index: number): Promise<number> {
    const key = batchKeys.started(batchId, index);
    const n = await this.client.incr(key);
    await this.client.expire(key, BATCH_KEY_TTL_SECONDS);
    return n;
  }

  /** INCR the per-batch duplicate counter; returns the new value. */
  async recordDuplicate(batchId: string): Promise<number> {
    const key = batchKeys.duplicates(batchId);
    const n = await this.client.incr(key);
    await this.client.expire(key, BATCH_KEY_TTL_SECONDS);
    return n;
  }

  /** INCR the per-batch done counter; returns the new value. */
  async recordDone(batchId: string): Promise<number> {
    const key = batchKeys.done(batchId);
    const n = await this.client.incr(key);
    await this.client.expire(key, BATCH_KEY_TTL_SECONDS);
    return n;
  }

  async onApplicationShutdown(): Promise<void> {
    try {
      await this.client.quit();
    } catch {
      this.client.disconnect();
    }
  }
}
