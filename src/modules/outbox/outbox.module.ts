import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { NotificationsModule } from '../notifications/notifications.module';
import { PrismaModule } from '../prisma/prisma.module';
import { OutboxController } from './outbox.controller';
import { OutboxScheduler } from './outbox.scheduler';
import { OutboxService } from './outbox.service';

@Module({
  imports: [ConfigModule, PrismaModule, NotificationsModule],
  controllers: [OutboxController],
  providers: [OutboxService, OutboxScheduler],
  exports: [OutboxService, OutboxScheduler],
})
export class OutboxModule {}
