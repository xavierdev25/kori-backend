import { Module } from '@nestjs/common';

import { StorageModule } from '../storage/storage.module';
import { NotesController } from './notes.controller';
import { NotesRepository } from './notes.repository';
import { NotesService } from './notes.service';

@Module({
  imports: [StorageModule],
  controllers: [NotesController],
  providers: [NotesService, NotesRepository],
  exports: [NotesService, NotesRepository],
})
export class NotesModule {}
