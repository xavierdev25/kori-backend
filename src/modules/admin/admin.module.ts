import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { NotesModule } from '../notes/notes.module';
import { SettingsModule } from '../settings/settings.module';
import { StorageModule } from '../storage/storage.module';
import { SubscribersModule } from '../subscribers/subscribers.module';
import { AdminNotesController } from './admin-notes.controller';
import { AdminNotesService } from './admin-notes.service';
import { AdminSettingsController } from './admin-settings.controller';
import { AdminSubscribersController } from './admin-subscribers.controller';

@Module({
  imports: [
    AuthModule,
    NotesModule,
    StorageModule,
    SettingsModule,
    SubscribersModule,
  ],
  controllers: [
    AdminNotesController,
    AdminSettingsController,
    AdminSubscribersController,
  ],
  providers: [AdminNotesService],
})
export class AdminModule {}
