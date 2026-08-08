import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { createHash } from 'crypto';
import type { Request, Response } from 'express';
import { EMPTY, Observable, mergeMap, of } from 'rxjs';

/**
 * ETag + Cache-Control para respuestas públicas.
 *
 * Los tiempos se parametrizan porque no todo cambia al mismo ritmo: el muro
 * recibe notitas nuevas continuamente, mientras que el catálogo pasa semanas
 * igual. Cachear más el catálogo ahorra arranques en frío de Render.
 */
@Injectable()
export class PublicCacheInterceptor implements NestInterceptor {
  constructor(
    private readonly maxAgeSeconds = 30,
    private readonly staleWhileRevalidateSeconds = 60,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();

    return next.handle().pipe(
      mergeMap((body: unknown) => {
        if (res.headersSent) {
          return of(body);
        }

        const json = JSON.stringify(body);
        const hash = createHash('sha256')
          .update(json)
          .digest('hex')
          .slice(0, 16);
        const etag = `"${hash}"`;
        const ifNoneMatch = req.headers['if-none-match'];

        res.setHeader('ETag', etag);
        res.setHeader(
          'Cache-Control',
          `public, max-age=${this.maxAgeSeconds}, stale-while-revalidate=${this.staleWhileRevalidateSeconds}`,
        );

        if (typeof ifNoneMatch === 'string' && ifNoneMatch === etag) {
          res.status(304).end();
          return EMPTY;
        }

        return of(body);
      }),
    );
  }
}
