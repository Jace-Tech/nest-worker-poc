import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import {
  BATCH_KEY_TTL_SECONDS,
  CHUNK_SIZE,
  DURATION_SECONDS_MAX,
  DURATION_SECONDS_MIN,
  ENQUEUE_CAP_DEFAULT,
  JITTER_PERCENT_MAX,
  JITTER_PERCENT_MIN,
  JOB_COUNT_MAX,
  JOB_COUNT_MIN,
  batchKeys,
  jobIdFor,
  type CreateJobsResponse,
  type JobPayload,
} from '@queue-lab/shared';
import { getConnection, getQueue } from '@/lib/queue';

// Never edge: BullMQ + ioredis need the Node.js runtime and raw TCP.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  count: z.number().int().min(JOB_COUNT_MIN).max(JOB_COUNT_MAX),
  durationSeconds: z.number().min(DURATION_SECONDS_MIN).max(DURATION_SECONDS_MAX),
  jitterPercent: z
    .number()
    .min(JITTER_PERCENT_MIN)
    .max(JITTER_PERCENT_MAX)
    .optional()
    .default(0),
});

function enqueueCap(): number {
  const raw = process.env.MAX_JOBS_PER_REQUEST;
  const parsed = raw ? Number(raw) : ENQUEUE_CAP_DEFAULT;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : ENQUEUE_CAP_DEFAULT;
}

/** Per-job duration with symmetric jitter baked in (payload carries no jitter). */
function jitteredDurationMs(baseMs: number, jitterPercent: number): number {
  if (jitterPercent <= 0) return baseMs;
  const factor = 1 + (Math.random() * 2 - 1) * (jitterPercent / 100);
  return Math.max(0, Math.round(baseMs * factor));
}

export async function POST(request: Request): Promise<NextResponse> {
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ error: 'Body must be valid JSON' }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid input', details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { count, durationSeconds, jitterPercent } = parsed.data;

  const cap = enqueueCap();
  if (count > cap) {
    return NextResponse.json(
      {
        error: `Too many jobs for a single request. Max is ${cap}. ` +
          `Lower "Number of jobs" or raise MAX_JOBS_PER_REQUEST on the server.`,
      },
      { status: 400 },
    );
  }

  const batchId = randomUUID();
  const baseDurationMs = Math.round(durationSeconds * 1000);
  const createdAt = Date.now();

  const connection = getConnection();
  const queue = getQueue();

  // Record the batch total so the stats route can compute % complete.
  await connection.set(
    batchKeys.total(batchId),
    count,
    'EX',
    BATCH_KEY_TTL_SECONDS,
  );

  // Enqueue in chunks, awaiting each so the whole request is durable before we
  // respond. Deterministic jobId makes a retried request idempotent.
  for (let start = 0; start < count; start += CHUNK_SIZE) {
    const end = Math.min(start + CHUNK_SIZE, count);
    const chunk = [];
    for (let index = start; index < end; index++) {
      const data: JobPayload = {
        batchId,
        index,
        durationMs: jitteredDurationMs(baseDurationMs, jitterPercent),
        createdAt,
      };
      chunk.push({
        name: 'load-test',
        data,
        opts: {
          jobId: jobIdFor(batchId, index),
          attempts: 3,
          backoff: { type: 'exponential', delay: 2000 },
          removeOnComplete: { age: 86400, count: 5000 },
          removeOnFail: { age: 604800 },
        },
      });
    }
    await queue.addBulk(chunk);
  }

  const response: CreateJobsResponse = {
    batchId,
    count,
    durationMs: baseDurationMs,
    jitterPercent,
  };
  return NextResponse.json(response, { status: 201 });
}
