import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import type { Request } from 'express';
import { Observable, tap } from 'rxjs';

import { LatencyRegistry } from '../observability/latency.registry';

/**
 * Mide cuánto tarda cada petición y se lo cuenta al registro.
 *
 * Se agrupa por la RUTA del controlador, no por la URL: `/products/:slug` y
 * no `/products/diciembre-drumkit`. Con la URL real habría una entrada por
 * producto, cada una con dos muestras, y ningún percentil significaría nada.
 */
@Injectable()
export class LatencyInterceptor implements NestInterceptor {
  constructor(private readonly registry: LatencyRegistry) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<Request>();
    const started = Date.now();

    // `route.path` lo pone Express al resolver el controlador; si no está
    // —404, por ejemplo— se agrupa aparte en vez de inventar una ruta.
    const label = () =>
      `${request.method} ${(request.route as { path?: string } | undefined)?.path ?? '(sin ruta)'}`;

    return next.handle().pipe(
      tap({
        next: () => this.registry.record(label(), Date.now() - started, false),
        // Un error también es tiempo que alguien esperó, y suele ser el más
        // largo: un timeout contra Stripe tarda más que cualquier éxito.
        error: () => this.registry.record(label(), Date.now() - started, true),
      }),
    );
  }
}
