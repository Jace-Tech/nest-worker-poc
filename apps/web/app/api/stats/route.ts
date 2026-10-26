import { NextResponse } from 'next/server';
import {
  batchKeys,
  type BatchProgress,
  type QueueJobCounts,
  type StatsResponse,
} from '@queue-lab/shared';
import { getConnection, getQueue } from '@/lib/queue';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<NextResponse> {
  const { searchParams } = new URL(request.url);
  const batchId = searchParams.get('batchId');

  const queue = getQueue();
  const connection = getConnection();

  // Queue counts are always available, with or without an active batch.
  const counts = await queue.getJobCounts(
    'waiting',
    'active',
    'delayed',
    'completed',
    'failed',
  );

  // Per-batch progress only when a batchId is supplied.
  let batch: BatchProgress | null = null;
  if (batchId) {
    const [totalRaw, doneRaw, duplicatesRaw] = await connection.mget(
      batchKeys.total(batchId),
      batchKeys.done(batchId),
      batchKeys.duplicates(batchId),
    );
    const total = totalRaw !== null ? Number(totalRaw) : null;
    const done = doneRaw !== null ? Number(doneRaw) : 0;
    const duplicates = duplicatesRaw !== null ? Number(duplicatesRaw) : 0;
    const percentComplete =
      total && total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;
    batch = { batchId, total, done, duplicates, percentComplete };
  }

  const queueCounts: QueueJobCounts = {
    waiting: counts.waiting ?? 0,
    active: counts.active ?? 0,
    delayed: counts.delayed ?? 0,
    completed: counts.completed ?? 0,
    failed: counts.failed ?? 0,
    ...counts,
  };

  const body: StatsResponse = { queue: queueCounts, batch };
  return NextResponse.json(body);
}
