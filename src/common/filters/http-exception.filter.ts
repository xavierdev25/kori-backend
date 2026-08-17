import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
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

  catch(raw: unknown, host: ArgumentsHost): void {
    // Los errores de Prisma se traducen ANTES de mirar el estado. Hasta ahora
    // cada servicio se ocupaba del suyo a mano, y lo que no estaba contemplado
    // salía como 500 "Internal server error": un registro que ya no existe
    // —P2025, que es un 404 de manual— se le presentaba al panel como si el
    // servidor estuviera roto, y quien lo veía iba a buscar la avería donde no
    // estaba.
    const exception = this.fromPrisma(raw);

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
        `[${requestId}] ${req.method} ${req.path} → ${status}: ${this.toLogMessage(raw)}`,
      );
      // no-op si Sentry no fue inicializado (sin SENTRY_DSN)
      Sentry.captureException(raw, {
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

  /**
   * Traduce lo que lanza Prisma a un error HTTP con sentido.
   *
   * El mensaje nunca se reenvía tal cual: el de Prisma trae el nombre de la
   * tabla, de la columna y a veces el valor que chocó. Eso es un mapa de la
   * base de datos servido a quien pregunte. El detalle se queda en el log, que
   * es donde hace falta; fuera va una frase que solo dice qué hacer.
   */
  private fromPrisma(exception: unknown): unknown {
    if (!(exception instanceof Prisma.PrismaClientKnownRequestError)) {
      return exception;
    }

    switch (exception.code) {
      case 'P2002':
        return new HttpException(
          'Ese valor ya está en uso',
          HttpStatus.CONFLICT,
        );
      case 'P2025':
        return new HttpException('No se encontró', HttpStatus.NOT_FOUND);
      case 'P2003':
        // Clave foránea: se intenta borrar algo de lo que todavía cuelga otra
        // cosa, o apuntar a algo que no existe.
        return new HttpException(
          'No se puede hacer: hay datos que dependen de esto',
          HttpStatus.CONFLICT,
        );
      case 'P2000':
        return new HttpException(
          'Un valor es demasiado largo',
          HttpStatus.BAD_REQUEST,
        );
      default:
        // Lo desconocido sigue siendo un 500, que es lo honesto: si no se sabe
        // qué pasó, no se puede prometer que sea culpa de quien pregunta.
        return exception;
    }
  }

  private toErrorCode(status: number): string {
    if (status === 400) return 'VALIDATION_ERROR';
    if (status === 401) return 'UNAUTHORIZED';
    if (status === 403) return 'FORBIDDEN';
    if (status === 404) return 'NOT_FOUND';
    if (status === 409) return 'CONFLICT';
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
