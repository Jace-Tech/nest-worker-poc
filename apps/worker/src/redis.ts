import type { RedisOptions } from 'ioredis';

/**
 * Build ioredis connection options from REDIS_URL.
 * - rediss:// (Upstash and most managed Redis) enables TLS automatically.
 * - maxRetriesPerRequest MUST be null for BullMQ's blocking worker connection.
 */
export function getRedisConnectionOptions(): RedisOptions {
  const url = process.env.REDIS_URL;
  if (!url) {
    throw new Error('REDIS_URL is not set');
  }

  const parsed = new URL(url);
  const isTls = parsed.protocol === 'rediss:';

  return {
    host: parsed.hostname,
    port: Number(parsed.port) || 6379,
    username: parsed.username ? decodeURIComponent(parsed.username) : undefined,
    password: parsed.password ? decodeURIComponent(parsed.password) : undefined,
    maxRetriesPerRequest: null,
    // Empty object = use sensible TLS defaults (SNI from host). Undefined = plaintext.
    tls: isTls ? {} : undefined,
    // Upstash doesn't support every introspection command; skip the ready check
    // so connecting doesn't stall.
    enableReadyCheck: false,
  };
}
