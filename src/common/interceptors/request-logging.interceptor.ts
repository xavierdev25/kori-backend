import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import { Observable, finalize } from 'rxjs';

@Injectable()
export class RequestLoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');
  private readonly enabled: boolean;

  constructor(configService: ConfigService) {
    const raw = configService.get<string>('ENABLE_REQUEST_LOGGING');
    this.enabled = raw === 'true' || raw === '1';
  }

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (!this.enabled) {
      return next.handle();
    }

    const http = context.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();
    const start = Date.now();
    const { method, path, requestId } = req;

    return next.handle().pipe(
      finalize(() => {
        this.logger.log(
          JSON.stringify({
            requestId,
            method,
            path,
            statusCode: res.statusCode,
            durationMs: Date.now() - start,
          }),
        );
      }),
    );
  }
}
