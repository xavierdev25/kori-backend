import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import {
  AdminOrdersController,
  AdminStatsController,
} from './admin-orders.controller';
import { OrdersService } from './orders.service';

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [AdminOrdersController, AdminStatsController],
  providers: [OrdersService],
  exports: [OrdersService],
})
export class OrdersModule {}
