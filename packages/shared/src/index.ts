/**
 * Shared contract between apps/web (producer) and apps/worker (consumer).
 * Keep this the single source of truth for the queue name, the job payload
 * shape, Redis bookkeeping keys, and the stats response the UI polls.
 */

/** BullMQ queue name. KEDA watches the derived list `bull:load-test:wait`. */
export const QUEUE_NAME = 'load-test';

/**
 * BullMQ's default Redis key prefix. The wait list KEDA scales on is
 * `${BULL_PREFIX}:${QUEUE_NAME}:wait` = `bull:load-test:wait`.
 */
export const BULL_PREFIX = 'bull';

/** Enqueue these many jobs per addBulk call (producer side). */
export const CHUNK_SIZE = 1000;

/** Form/input bounds. */
export const JOB_COUNT_MIN = 1;
export const JOB_COUNT_MAX = 100_000;
export const DURATION_SECONDS_MIN = 0.1;
export const DURATION_SECONDS_MAX = 600;
export const JITTER_PERCENT_MIN = 0;
export const JITTER_PERCENT_MAX = 100;

/**
 * Default per-request enqueue cap. The form allows up to JOB_COUNT_MAX, but a
 * single POST must finish inside the Vercel function time limit. Requests above
 * the cap are rejected with 400. Override on the server with MAX_JOBS_PER_REQUEST.
 */
export const ENQUEUE_CAP_DEFAULT = 25_000;

/** TTL applied to every `batch:*` bookkeeping key (24h). */
export const BATCH_KEY_TTL_SECONDS = 86_400;

/**
 * Deterministic jobId so a retried enqueue cannot create duplicates.
 * Note: BullMQ v5 forbids ':' in a custom jobId (it is the Redis key separator),
 * so we join with '_' instead. Uniqueness and determinism are what matter here.
 */
export function jobIdFor(batchId: string, index: number): string {
  return `${batchId}_${index}`;
}

/** Redis bookkeeping keys written by the worker and read by the stats route. */
export const batchKeys = {
  /** INCR'd once per started attempt; value > 1 means a re-process. */
  started: (batchId: string, index: number): string =>
    `batch:${batchId}:started:${index}`,
  /** INCR'd whenever a started counter crosses 1 (a duplicate process). */
  duplicates: (batchId: string): string => `batch:${batchId}:duplicates`,
  /** INCR'd when a job finishes its simulated work. */
  done: (batchId: string): string => `batch:${batchId}:done`,
  /** Total jobs in the batch, written once by the producer at enqueue time. */
  total: (batchId: string): string => `batch:${batchId}:total`,
} as const;

/** The job payload enqueued by the web app and processed by the worker. */
export interface JobPayload {
  batchId: string;
  index: number;
  durationMs: number;
  createdAt: number;
}

/** Request body accepted by POST /api/jobs (pre-validation shape). */
export interface CreateJobsRequest {
  count: number;
  durationSeconds: number;
  jitterPercent?: number;
}

/** Response from POST /api/jobs. */
export interface CreateJobsResponse {
  batchId: string;
  count: number;
  durationMs: number;
  jitterPercent: number;
}

/** BullMQ queue.getJobCounts() result (plus any extra states BullMQ returns). */
export interface QueueJobCounts {
  waiting: number;
  active: number;
  delayed: number;
  completed: number;
  failed: number;
  [state: string]: number;
}

/** Per-batch progress derived from the Redis bookkeeping keys. */
export interface BatchProgress {
  batchId: string;
  /** Total jobs enqueued for this batch, or null if unknown. */
  total: number | null;
  /** Jobs that finished their simulated work. */
  done: number;
  /** Times a job was processed more than once (should stay 0). */
  duplicates: number;
  /** done / total * 100, clamped to [0, 100]; 0 when total is unknown. */
  percentComplete: number;
}

/**
 * Response from GET /api/stats. Queue counts are always returned; `batch` is
 * null when no batchId is supplied (the UI polls queue depth even while idle).
 */
export interface StatsResponse {
  queue: QueueJobCounts;
  batch: BatchProgress | null;
}
