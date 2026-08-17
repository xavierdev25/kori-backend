import { Module } from '@nestjs/common';

import { OutboxModule } from '../outbox/outbox.module';
import { ContactController } from './contact.controller';
import { ContactService } from './contact.service';

@Module({
  imports: [OutboxModule],
  controllers: [ContactController],
  providers: [ContactService],
  // Lo usa el controlador de la bandeja, en AdminModule.
  exports: [ContactService],
})
export class ContactModule {}
