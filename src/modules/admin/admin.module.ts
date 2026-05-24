import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { NotesModule } from '../notes/notes.module';
import { StorageModule } from '../storage/storage.module';
import { AdminNotesController } from './admin-notes.controller';
import { AdminNotesService } from './admin-notes.service';

@Module({
  imports: [AuthModule, NotesModule, StorageModule],
  controllers: [AdminNotesController],
  providers: [AdminNotesService],
})
export class AdminModule {}
