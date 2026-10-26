/** Thrown when a sleep is interrupted because the worker is shutting down. */
export class ShutdownAbortError extends Error {
  constructor() {
    super('worker is shutting down');
    this.name = 'ShutdownAbortError';
  }
}

/**
 * Sleep for `ms`, but reject immediately if `signal` aborts (SIGTERM).
 * A rejected process() lets BullMQ requeue the job for retry on another worker,
 * which is why a pod killed mid-job does not lose work (at-least-once).
 */
export function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(new ShutdownAbortError());
      return;
    }
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(new ShutdownAbortError());
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}
