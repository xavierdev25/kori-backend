import {
  MiddlewareConsumer,
  Module,
  NestModule,
  ValidationPipe,
} from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';

import { validateEnvironment } from './config/env.validation';
import { GlobalExceptionFilter } from './common/filters/http-exception.filter';
import { RequestIdMiddleware } from './common/middleware/request-id.middleware';
import { RequestLoggingInterceptor } from './common/interceptors/request-logging.interceptor';
import { AuditInterceptor } from './common/interceptors/audit.interceptor';
import { LatencyInterceptor } from './common/interceptors/latency.interceptor';
import { LatencyController } from './common/observability/latency.controller';
import { LatencyRegistry } from './common/observability/latency.registry';
import { AdminModule } from './modules/admin/admin.module';
import { AuthModule } from './modules/auth/auth.module';
import { ContactModule } from './modules/contact/contact.module';
import { CatalogModule } from './modules/catalog/catalog.module';
import { CheckoutModule } from './modules/checkout/checkout.module';
import { HealthModule } from './modules/health/health.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { NotesModule } from './modules/notes/notes.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { OutboxModule } from './modules/outbox/outbox.module';
import { OrdersModule } from './modules/orders/orders.module';
import { PrismaModule } from './modules/prisma/prisma.module';
import { PrismaService } from './modules/prisma/prisma.service';
import { SettingsModule } from './modules/settings/settings.module';
import { TelemetryModule } from './modules/telemetry/telemetry.module';
import { StorageModule } from './modules/storage/storage.module';
import { SubscribersModule } from './modules/subscribers/subscribers.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
      validate: validateEnvironment,
    }),
    ThrottlerModule.forRoot([
      {
        ttl: 60_000,
        limit: 60,
      },
    ]),
    PrismaModule,
    StorageModule,
    NotesModule,
    SubscribersModule,
    SettingsModule,
    TelemetryModule,
    AuthModule,
    AdminModule,
    CatalogModule,
    ContactModule,
    PaymentsModule,
    CheckoutModule,
    OrdersModule,
    NotificationsModule,
    OutboxModule,
    HealthModule,
  ],
  controllers: [LatencyController],
  providers: [
    {
      provide: APP_PIPE,
      useValue: new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    },
    {
      provide: APP_FILTER,
      useClass: GlobalExceptionFilter,
    },
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
    {
      provide: APP_INTERCEPTOR,
      useFactory: (configService: ConfigService) =>
        new RequestLoggingInterceptor(configService),
      inject: [ConfigService],
    },
    {
      // Global a proposito: el interceptor se descarta solo en lecturas y en
      // peticiones sin usuario, asi que webhooks y endpoints publicos no
      // pasan por el. Registrarlo controlador a controlador se olvidaria en
      // el siguiente que se anada.
      provide: APP_INTERCEPTOR,
      useFactory: (prisma: PrismaService, configService: ConfigService) =>
        new AuditInterceptor(prisma, configService),
      inject: [PrismaService, ConfigService],
    },
    // Mide TODAS las peticiones, incluidas las públicas: si la tienda va
    // lenta para quien compra, es justo lo que hay que poder ver.
    LatencyRegistry,
    {
      provide: APP_INTERCEPTOR,
      useFactory: (registry: LatencyRegistry) =>
        new LatencyInterceptor(registry),
      inject: [LatencyRegistry],
    },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware).forRoutes('*path');
  }
}
