import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { StorageModule } from '../storage/storage.module';
import {
  AdminOrdersController,
  AdminStatsController,
} from './admin-orders.controller';
import { DigitalDeliveryService } from './digital-delivery.service';
import { DownloadsController } from './downloads.controller';
import { OrdersService } from './orders.service';

@Module({
  controllers: [
    AdminOrdersController,
    AdminStatsController,
    // Público y sin guard: la credencial del comprador es su token.
    DownloadsController,
  ],
  exports: [DigitalDeliveryService, OrdersService],
  imports: [ConfigModule, PrismaModule, AuthModule, StorageModule],
  providers: [DigitalDeliveryService, OrdersService],
})
export class OrdersModule {}
