import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { AuthModule } from '../auth/auth.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { OrdersModule } from '../orders/orders.module';
import { PrismaModule } from '../prisma/prisma.module';
import { AdminRetryController } from './admin-retry.controller';
import { OutboxController } from './outbox.controller';
import { OutboxScheduler } from './outbox.scheduler';
import { OutboxService } from './outbox.service';

@Module({
  // `AuthModule` entra por los guards del reintento manual: `OrdersModule` lo
  // importa pero no lo reexporta, asi que heredarlo de ahi no funciona.
  imports: [
    ConfigModule,
    PrismaModule,
    NotificationsModule,
    OrdersModule,
    AuthModule,
  ],
  controllers: [OutboxController, AdminRetryController],
  providers: [OutboxService, OutboxScheduler],
  exports: [OutboxService, OutboxScheduler],
})
export class OutboxModule {}
