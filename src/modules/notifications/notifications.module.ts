import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { EmailService } from './email.service';
import { OrderEmailsService } from './order-emails.service';

@Module({
  imports: [ConfigModule],
  providers: [EmailService, OrderEmailsService],
  exports: [EmailService, OrderEmailsService],
})
export class NotificationsModule {}
