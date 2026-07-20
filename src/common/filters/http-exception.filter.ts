import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
} from '@nestjs/common';
import * as Sentry from '@sentry/node';
import type { Request, Response } from 'express';

export interface ErrorEnvelope {
  success: false;
  error: {
    code: string;
    message: string;
    requestId: string;
    timestamp: string;
    path: string;
    method: string;
  };
}

@Injectable()
@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const req = ctx.getRequest<Request>();
    const res = ctx.getResponse<Response>();

    if (res.headersSent) {
      return;
    }

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    const code = this.toErrorCode(status);
    const message = this.toPublicMessage(status, exception);
    const requestId = req.requestId ?? 'unknown';

    if (status >= 500) {
      this.logger.error(
        `[${requestId}] ${req.method} ${req.path} → ${status}: ${this.toLogMessage(exception)}`,
      );
      // no-op si Sentry no fue inicializado (sin SENTRY_DSN)
      Sentry.captureException(exception, {
        tags: { requestId, path: req.path, method: req.method },
      });
    }

    const envelope: ErrorEnvelope = {
      success: false,
      error: {
        code,
        message,
        requestId,
        timestamp: new Date().toISOString(),
        path: req.path,
        method: req.method,
      },
    };

    res.status(status).json(envelope);
  }

  private toErrorCode(status: number): string {
    if (status === 400) return 'VALIDATION_ERROR';
    if (status === 401) return 'UNAUTHORIZED';
    if (status === 403) return 'FORBIDDEN';
    if (status === 404) return 'NOT_FOUND';
    if (status === 429) return 'RATE_LIMITED';
    if (status === 503) return 'SERVICE_UNAVAILABLE';
    if (status >= 500) return 'INTERNAL_ERROR';

    return 'REQUEST_ERROR';
  }

  private toPublicMessage(status: number, exception: unknown): string {
    if (exception instanceof HttpException) {
      const response = exception.getResponse();

      if (typeof response === 'string') {
        return response;
      }

      if (typeof response === 'object' && response !== null) {
        const r = response as Record<string, unknown>;

        if (typeof r['message'] === 'string') {
          return r['message'];
        }

        if (Array.isArray(r['message'])) {
          return (r['message'] as string[]).join('; ');
        }
      }
    }

    if (status >= 500) {
      return 'Internal server error';
    }

    return 'An error occurred';
  }

  private toLogMessage(exception: unknown): string {
    if (exception instanceof Error) {
      return exception.message;
    }

    return String(exception);
  }
}
