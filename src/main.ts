import type { ServerResponse } from 'http';
import { join } from 'path';

import { Logger, VERSION_NEUTRAL, VersioningType } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import compression from 'compression';
import type { NestExpressApplication } from '@nestjs/platform-express';
import * as Sentry from '@sentry/node';
import helmet from 'helmet';

import { AppModule } from './app.module';
import {
  buildAllowedOrigins,
  isOriginAllowed,
} from './common/http/cors-origins';
import { LOCAL_UPLOADS_DIR } from './modules/storage/storage.service';

type CorsOriginCallback = (error: Error | null, allow?: boolean) => void;

async function bootstrap() {
  // rawBody: true es obligatorio para verificar la firma de los webhooks de
  // Stripe. Sin esto, Nest parsea el JSON y la firma calculada nunca coincide
  // con la de la cabecera: falla SIEMPRE, y el error no dice por qué.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    rawBody: true,
  });
  const configService = app.get(ConfigService);

  /**
   * Versionado por URI, servido en dos rutas a la vez:
   *   /products      (neutral, lo que ya consumen la landing y el panel)
   *   /v1/products   (versionado, el camino nuevo)
   *
   * Se hace ahora porque añadir /v1 con clientes ya desplegados obliga a
   * coordinar tres repos; hacerlo aquí no rompe nada. El día que /v2 cambie
   * un contrato, los clientes viejos siguen contra /v1.
   */
  app.enableVersioning({
    type: VersioningType.URI,
    defaultVersion: [VERSION_NEUTRAL, '1'],
  });

  /**
   * Gzip en las respuestas. Importa más de lo que parece en el plan gratuito:
   * el catálogo y el listado de notas son JSON muy repetitivo, y menos bytes
   * son menos milisegundos para alguien con red mala.
   */
  app.use(compression());

  /**
   * Render manda SIGTERM al desplegar y al dormir el contenedor. Sin esto,
   * Nest no cierra la conexión de Prisma ni deja terminar lo que esté en
   * curso: se corta un webhook a medias o un job del outbox sin marcar.
   */
  app.enableShutdownHooks();

  // Observabilidad opcional: solo se activa si hay SENTRY_DSN definido.
  // El tier gratuito de Sentry sobra para este proyecto.
  const sentryDsn = configService.get<string>('SENTRY_DSN');

  if (sentryDsn) {
    Sentry.init({
      dsn: sentryDsn,
      environment: configService.get<string>('NODE_ENV') ?? 'development',
      tracesSampleRate: 0, // solo errores, sin tracing (mantiene el tier gratis)
    });
  }

  const trustProxy = configService.get<string>('TRUST_PROXY') ?? '';

  if (trustProxy && trustProxy !== 'false' && trustProxy !== '0') {
    if (trustProxy === 'true' || trustProxy === '1') {
      app.set('trust proxy', 1);
    } else if (/^\d+$/.test(trustProxy)) {
      app.set('trust proxy', parseInt(trustProxy, 10));
    } else {
      app.set('trust proxy', trustProxy);
    }
  }

  const logger = new Logger('Bootstrap');
  const allowedOrigins = buildAllowedOrigins([
    configService.get<string>('LANDING_ORIGIN'),
    configService.get<string>('DASHBOARD_ORIGIN'),
  ]);

  // Se registra al arrancar: cuando el CORS falla, el navegador dice
  // "sin cabecera" y el servidor no dice nada. Tener la lista en el log
  // convierte media hora de adivinar en una línea.
  logger.log(
    `CORS permitido para: ${allowedOrigins.join(', ') || '(ninguno)'}`,
  );

  app.use(helmet());

  // Driver local de storage (solo desarrollo): sirve los dibujos subidos.
  // CORP cross-origin para que la landing (otro puerto) pueda mostrarlos.
  if (configService.get<string>('STORAGE_DRIVER') === 'local') {
    app.useStaticAssets(join(process.cwd(), LOCAL_UPLOADS_DIR), {
      prefix: '/uploads/',
      setHeaders: (res: ServerResponse) => {
        res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
        res.setHeader('Cache-Control', 'public, max-age=86400');
      },
    });
  }

  app.enableCors({
    origin: (origin: string | undefined, callback: CorsOriginCallback) => {
      callback(null, isOriginAllowed(origin, allowedOrigins));
    },
    // Sin esto el navegador no envía ni acepta las cookies de sesión del
    // panel. Es seguro porque el origen va por allowlist, nunca '*': la
    // combinación credentials + comodín la rechaza el propio navegador.
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    exposedHeaders: ['x-request-id', 'ETag'],
  });

  const port = Number(configService.get<string>('PORT') ?? 4000);
  await app.listen(port);
}

void bootstrap();
