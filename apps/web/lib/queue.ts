import IORedis, { type Redis } from 'ioredis';
import { Queue } from 'bullmq';
import { QUEUE_NAME } from '@queue-lab/shared';

/**
 * Lazy module-scope singletons. Next.js reuses the module across warm
 * invocations of a serverless function, so one connection + one Queue are shared
 * instead of reconnecting per request. The globalThis cache also survives dev
 * hot-reload, which otherwise leaks a connection on every edit.
 *
 * Connecting is deferred until first use (not at import) so that `next build`,
 * which imports route modules to analyze them, does not require REDIS_URL and
 * does not open a socket.
 */
const globalForQueue = globalThis as unknown as {
  __redis?: Redis;
  __queue?: Queue;
};

function createConnection(): Redis {
  const url = process.env.REDIS_URL;
  if (!url) {
    throw new Error('REDIS_URL is not set');
  }
  const isTls = url.startsWith('rediss://');
  return new IORedis(url, {
    // Required by BullMQ; also fine for the plain reads the stats route does.
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    // ioredis auto-enables TLS for rediss://; this is belt-and-suspenders.
    ...(isTls ? { tls: {} } : {}),
  });
}

export function getConnection(): Redis {
  if (!globalForQueue.__redis) {
    globalForQueue.__redis = createConnection();
  }
  return globalForQueue.__redis;
}

export function getQueue(): Queue {
  if (!globalForQueue.__queue) {
    globalForQueue.__queue = new Queue(QUEUE_NAME, { connection: getConnection() });
  }
  return globalForQueue.__queue;
}
