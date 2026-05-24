import {
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
  UseGuards,
} from '@nestjs/common';

import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AdminNotesService } from './admin-notes.service';
import { AdminNotesQueryDto } from './dto/admin-notes-query.dto';

@Controller('admin/notes')
@UseGuards(JwtAuthGuard)
export class AdminNotesController {
  constructor(private readonly adminNotesService: AdminNotesService) {}

  @Get()
  findNotes(@Query() query: AdminNotesQueryDto) {
    return this.adminNotesService.findNotes(query);
  }

  @Get('stats')
  getStats() {
    return this.adminNotesService.getStats();
  }

  @Get(':id')
  findNoteById(@Param('id', ParseUUIDPipe) id: string) {
    return this.adminNotesService.findNoteById(id);
  }

  @Delete(':id')
  deleteNote(@Param('id', ParseUUIDPipe) id: string) {
    return this.adminNotesService.deleteNote(id);
  }
}
