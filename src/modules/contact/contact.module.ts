import { Module } from '@nestjs/common';

import { OutboxModule } from '../outbox/outbox.module';
import { ContactController } from './contact.controller';
import { ContactService } from './contact.service';

@Module({
  imports: [OutboxModule],
  controllers: [ContactController],
  providers: [ContactService],
})
export class ContactModule {}
