import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { OutboxModule } from '../outbox/outbox.module';
import { PrismaModule } from '../prisma/prisma.module';
import { PaymentsService } from './payments.service';
import { StripeService } from './stripe.service';
import { StripeWebhookController } from './stripe-webhook.controller';

@Module({
  imports: [ConfigModule, PrismaModule, OutboxModule],
  controllers: [StripeWebhookController],
  providers: [StripeService, PaymentsService],
  exports: [StripeService, PaymentsService],
})
export class PaymentsModule {}
