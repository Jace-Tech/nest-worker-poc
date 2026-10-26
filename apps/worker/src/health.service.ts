import {
  Injectable,
  Logger,
  OnApplicationShutdown,
  OnModuleInit,
} from '@nestjs/common';
import { createServer, type Server } from 'node:http';

/**
 * Minimal HTTP server exposing GET /healthz for Kubernetes liveness/readiness.
 * Deliberately separate from the job logic — no Nest HTTP adapter, no framework.
 */
@Injectable()
export class HealthService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(HealthService.name);
  private server?: Server;

  onModuleInit(): void {
    const port = Number(process.env.PORT ?? 3001);
    this.server = createServer((req, res) => {
      if (req.method === 'GET' && req.url === '/healthz') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok' }));
        return;
      }

      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ status: 'not_found' }));
    });

    this.server.listen(port, () =>
      this.logger.log(`health endpoint listening on :${port}/healthz`),
    );
  }

  async onApplicationShutdown(): Promise<void> {
    if (!this.server) {
      return;
    }

    await new Promise<void>((resolve) => this.server!.close(() => resolve()));
  }

}
