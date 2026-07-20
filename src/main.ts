import type { ServerResponse } from 'http';
import { join } from 'path';

import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import * as Sentry from '@sentry/node';
import helmet from 'helmet';

import { AppModule } from './app.module';
import { LOCAL_UPLOADS_DIR } from './modules/storage/storage.service';

type CorsOriginCallback = (error: Error | null, allow?: boolean) => void;

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const configService = app.get(ConfigService);

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

  const allowedOrigins = [
    configService.get<string>('LANDING_ORIGIN'),
    configService.get<string>('DASHBOARD_ORIGIN'),
  ].filter((origin): origin is string => Boolean(origin));

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
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
        return;
      }

      callback(null, false);
    },
    methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    exposedHeaders: ['x-request-id', 'ETag'],
  });

  const port = Number(configService.get<string>('PORT') ?? 4000);
  await app.listen(port);
}

void bootstrap();
