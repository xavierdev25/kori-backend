import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { ContactModule } from '../contact/contact.module';
import { NotesModule } from '../notes/notes.module';
import { SettingsModule } from '../settings/settings.module';
import { SignalModule } from '../signal/signal.module';
import { StorageModule } from '../storage/storage.module';
import { SubscribersModule } from '../subscribers/subscribers.module';
import { AdminContactController } from './admin-contact.controller';
import { AdminNotesController } from './admin-notes.controller';
import { AdminNotesService } from './admin-notes.service';
import { AdminSettingsController } from './admin-settings.controller';
import { AdminSignalController } from './admin-signal.controller';
import { AdminSubscribersController } from './admin-subscribers.controller';

@Module({
  imports: [
    AuthModule,
    ContactModule,
    NotesModule,
    StorageModule,
    SettingsModule,
    SignalModule,
    SubscribersModule,
  ],
  controllers: [
    AdminContactController,
    AdminNotesController,
    AdminSettingsController,
    AdminSignalController,
    AdminSubscribersController,
  ],
  providers: [AdminNotesService],
})
export class AdminModule {}
