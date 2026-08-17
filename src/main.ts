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
   * Docker manda SIGTERM al recrear el contenedor en cada despliegue. Sin
   * esto, Nest no cierra la conexión de Prisma ni deja terminar lo que esté en
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

  /**
   * El contrato de la API, generado desde los DTO que ya existen.
   *
   * Solo fuera de producción, y es deliberado: publicar el mapa completo de
   * endpoints —incluidos los de `/admin` y `/internal`— le ahorra el trabajo
   * de reconocimiento a quien venga a buscar agujeros. Para el panel y la web
   * el contrato se consulta en local o se exporta a fichero; en el servidor
   * de verdad no hace falta que esté servido.
   */
  if (configService.get<string>('NODE_ENV') !== 'production') {
    const { DocumentBuilder, SwaggerModule } = await import('@nestjs/swagger');

    const config = new DocumentBuilder()
      .setTitle('Kori API')
      .setDescription(
        'API de la tienda de kor!. Los precios se leen siempre del servidor: ' +
          'ningún endpoint acepta un importe enviado por el cliente.',
      )
      .setVersion('1.0')
      .addCookieAuth('kori_access_token', {
        type: 'apiKey',
        in: 'cookie',
        description: 'Sesión del panel. Se obtiene en POST /auth/login.',
      })
      .build();

    SwaggerModule.setup(
      'docs',
      app,
      SwaggerModule.createDocument(app, config),
      { jsonDocumentUrl: 'docs/openapi.json' },
    );

    logger.log('Contrato de la API en /docs (solo fuera de producción)');
  }

  const port = Number(configService.get<string>('PORT') ?? 4000);
  await app.listen(port);
}

/**
 * La última red, para que un fallo suelto no tire la tienda entera.
 *
 * Desde Node 15 una promesa rechazada sin capturar termina el proceso. En un
 * contenedor eso son reinicios en bucle: la API deja de responder para todo el
 * mundo por un fallo en un rincón que quizá no afectaba a nadie más. Ya pasó
 * —seis horas caída— y aunque aquella causa era otra, el resultado visible
 * desde fuera es idéntico y no había nada que lo contara.
 *
 * Se registra y se sigue sirviendo. No es tragarse el error: va al log con su
 * traza y a Sentry si está configurado, así que queda a la vista. Simplemente
 * se decide que para una tienda es mejor seguir en pie con un fallo conocido
 * que caerse del todo.
 *
 * `uncaughtException` sí termina: ahí el proceso queda en un estado que no se
 * puede dar por bueno, y seguir sirviendo con la casa a medio arder es peor
 * que dejar que Docker levante uno limpio. Se sale con calma para que el
 * apagado ordenado corra.
 */
function instalarRedDeSeguridad(): void {
  const logger = new Logger('Proceso');

  process.on('unhandledRejection', (reason) => {
    logger.error(
      `Promesa rechazada sin capturar: ${
        reason instanceof Error ? reason.stack : String(reason)
      }`,
    );
    Sentry.captureException(reason);
  });

  process.on('uncaughtException', (error) => {
    logger.error(`Excepción sin capturar: ${error.stack ?? error.message}`);
    Sentry.captureException(error);

    // Se le da un margen a Sentry para que llegue a enviarlo antes de morir.
    void Sentry.close(2000).then(() => process.exit(1));
  });
}

instalarRedDeSeguridad();

void bootstrap();
