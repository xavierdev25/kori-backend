import {
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Query,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';

import { NoCacheInterceptor } from '../../common/interceptors/no-cache.interceptor';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AdminNotesService } from './admin-notes.service';
import { AdminNotesQueryDto } from './dto/admin-notes-query.dto';

@Controller('admin/notes')
@UseGuards(JwtAuthGuard)
@UseInterceptors(NoCacheInterceptor)
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

  @Patch(':id/approve')
  approveNote(@Param('id', ParseUUIDPipe) id: string) {
    return this.adminNotesService.approveNote(id);
  }

  @Delete(':id')
  deleteNote(@Param('id', ParseUUIDPipe) id: string) {
    return this.adminNotesService.deleteNote(id);
  }
}
