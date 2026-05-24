import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';

import { AppModule } from './app.module';

type CorsOriginCallback = (error: Error | null, allow?: boolean) => void;

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const configService = app.get(ConfigService);

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
