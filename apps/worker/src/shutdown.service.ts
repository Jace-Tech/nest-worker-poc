import { Injectable, OnModuleDestroy } from '@nestjs/common';

/**
 * Holds a single AbortSignal that fires when the Nest context is torn down
 * (SIGTERM via enableShutdownHooks). The processor's sleep listens to it so
 * in-flight work unblocks instead of hanging until the grace period expires.
 */
@Injectable()
export class ShutdownService implements OnModuleDestroy {
  private readonly controller = new AbortController();

  get signal(): AbortSignal {
    return this.controller.signal;
  }

  onModuleDestroy(): void {
    this.controller.abort();
  }
}
