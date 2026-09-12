import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { OutboxModule } from '../outbox/outbox.module';
import { PrismaModule } from '../prisma/prisma.module';
import { InternalOrdersController } from './internal-orders.controller';
import { OrderMaintenanceScheduler } from './order-maintenance.scheduler';
import { OrderReconciliationService } from './order-reconciliation.service';
import { PaymentsService } from './payments.service';
import { StripeService } from './stripe.service';
import { StripeWebhookController } from './stripe-webhook.controller';

@Module({
  imports: [ConfigModule, PrismaModule, OutboxModule],
  controllers: [StripeWebhookController, InternalOrdersController],
  providers: [
    StripeService,
    PaymentsService,
    OrderReconciliationService,
    OrderMaintenanceScheduler,
  ],
  exports: [StripeService, PaymentsService, OrderReconciliationService],
})
export class PaymentsModule {}
