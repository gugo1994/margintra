import { Injectable, Logger, NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { NextFunction, Request, Response } from 'express';
import { MetricsService } from './metrics.service';

export interface ObservedRequest extends Request {
  requestId?: string;
  user?: { organizationId?: string };
  ingestion?: { organizationId?: string };
}
const safeId = /^[A-Za-z0-9._-]{1,100}$/;
const normalizeRoute = (path: string): string =>
  path.replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, ':id');

@Injectable()
export class RequestObservabilityMiddleware implements NestMiddleware {
  private readonly logger = new Logger(RequestObservabilityMiddleware.name);
  constructor(private readonly metrics: MetricsService) {}
  use(request: ObservedRequest, response: Response, next: NextFunction): void {
    const supplied = request.header('x-request-id');
    const requestId = supplied && safeId.test(supplied) ? supplied : randomUUID();
    request.requestId = requestId;
    response.setHeader('X-Request-Id', requestId);
    const started = process.hrtime.bigint();
    response.once('finish', () => {
      const durationMs = Number(process.hrtime.bigint() - started) / 1_000_000;
      const route = normalizeRoute(request.path);
      const organizationId = request.user?.organizationId ?? request.ingestion?.organizationId;
      this.metrics.recordHttp(request.method, route, response.statusCode, durationMs / 1000);
      this.logger.log({
        event: 'HttpRequest',
        requestId,
        method: request.method,
        route,
        status: response.statusCode,
        durationMs: Number(durationMs.toFixed(2)),
        ...(organizationId ? { organizationId } : {}),
      });
    });
    next();
  }
}
