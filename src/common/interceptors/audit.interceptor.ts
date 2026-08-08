import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import type { Request } from 'express';
import { Observable, tap } from 'rxjs';

import { hmacSha256OrNull } from '../utils/hash.util';
import type { AuthenticatedUser } from '../../modules/auth/auth.service';
import { PrismaService } from '../../modules/prisma/prisma.service';

/** Solo se audita lo que cambia algo. Las lecturas llenarian la tabla. */
const WRITE_METHODS = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);

/**
 * Claves que no se guardan nunca, ni aunque lleguen en el cuerpo. Es un
 * registro de auditoria, no un sitio donde filtrar credenciales.
 */
const REDACTED_KEYS = new Set([
  'password',
  'passwordHash',
  'token',
  'accessToken',
  'refreshToken',
  'secret',
  'apiKey',
]);

/** Recorta valores largos: una descripcion de 2 000 caracteres no aporta. */
const MAX_VALUE_LENGTH = 200;

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  private readonly logger = new Logger(AuditInterceptor.name);

  constructor(
    private readonly prismaService: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context
      .switchToHttp()
      .getRequest<Request & { user?: AuthenticatedUser }>();

    if (!WRITE_METHODS.has(request.method)) {
      return next.handle();
    }

    return next.handle().pipe(
      // Solo en exito: un intento rechazado por validacion no es un cambio.
      tap((result) => {
        void this.record(request, result);
      }),
    );
  }

  private async record(
    request: Request & { user?: AuthenticatedUser },
    result: unknown,
  ): Promise<void> {
    const user = request.user;

    // Sin usuario no es una accion del panel (webhooks, endpoints publicos).
    if (!user) {
      return;
    }

    try {
      await this.prismaService.auditLog.create({
        data: {
          userId: user.id,
          userEmail: user.email,
          userRole: user.role,
          action: `${request.method} ${this.resolveRoutePath(request)}`,
          entity: this.resolveEntity(request.path),
          entityId: this.resolveEntityId(request, result),
          metadata: this.sanitize(request.body) as Prisma.InputJsonValue,
          ipHash: hmacSha256OrNull(
            request.ip,
            this.configService.get<string>('HASH_PEPPER'),
          ),
        },
      });
    } catch (error) {
      // La auditoria nunca puede tumbar la operacion que audita: si falla,
      // queda en el log del servidor y la peticion sigue su curso.
      this.logger.error(
        `No se pudo registrar la auditoria: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  /**
   * La plantilla de la ruta ("/admin/products/:id") y no la URL concreta: asi
   * las acciones se agrupan en vez de generar una variante por cada id.
   * `request.route` no esta tipado en Express 5.
   */
  private resolveRoutePath(request: Request): string {
    const route = (request as { route?: { path?: unknown } }).route;

    return typeof route?.path === 'string' ? route.path : request.path;
  }

  private resolveEntity(path: string): string {
    if (path.includes('/images')) return 'image';
    if (path.includes('/variants')) return 'variant';
    if (path.includes('/products')) return 'product';
    if (path.includes('/orders')) return 'order';
    if (path.includes('/notes')) return 'note';
    if (path.includes('/settings')) return 'setting';

    return 'unknown';
  }

  /**
   * Al crear, el id todavia no esta en la ruta: se lee del recurso devuelto.
   * Sin esto, un POST quedaria registrado sin decir que creo.
   */
  private resolveEntityId(request: Request, result: unknown): string | null {
    const params = request.params as Record<string, string | undefined>;
    const fromPath = params.imageId ?? params.variantId ?? params.id;

    if (fromPath) {
      return fromPath;
    }

    if (result && typeof result === 'object' && 'id' in result) {
      const id = (result as { id?: unknown }).id;

      return typeof id === 'string' ? id : null;
    }

    return null;
  }

  private sanitize(body: unknown): Record<string, unknown> | null {
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return null;
    }

    const clean: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(body)) {
      if (REDACTED_KEYS.has(key)) {
        clean[key] = '[redactado]';
        continue;
      }

      clean[key] =
        typeof value === 'string' && value.length > MAX_VALUE_LENGTH
          ? `${value.slice(0, MAX_VALUE_LENGTH)}…`
          : value;
    }

    return Object.keys(clean).length > 0 ? clean : null;
  }
}
