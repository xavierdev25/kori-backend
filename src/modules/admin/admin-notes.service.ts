import { Injectable, NotFoundException } from '@nestjs/common';

import { sanitizePlainText } from '../../common/utils/text-sanitize.util';
import { NotesRepository } from '../notes/notes.repository';
import { StorageService } from '../storage/storage.service';
import { AdminNotesQueryDto } from './dto/admin-notes-query.dto';

export interface PaginatedAdminNotesResponse {
  data: Awaited<ReturnType<NotesRepository['findAdminNotes']>>['data'];
  meta: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface DeleteNoteResponse {
  deleted: true;
  id: string;
}

@Injectable()
export class AdminNotesService {
  constructor(
    private readonly notesRepository: NotesRepository,
    private readonly storageService: StorageService,
  ) {}

  async findNotes(
    query: AdminNotesQueryDto,
  ): Promise<PaginatedAdminNotesResponse> {
    const page = Math.max(Math.trunc(query.page), 1);
    const limit = Math.max(Math.trunc(query.limit), 1);
    const search = query.search ? sanitizePlainText(query.search) : undefined;

    const result = await this.notesRepository.findAdminNotes({
      type: query.type,
      status: query.status,
      search: search || undefined,
      page,
      limit,
    });

    return {
      data: result.data,
      meta: {
        page,
        limit,
        total: result.total,
        totalPages: Math.ceil(result.total / limit),
      },
    };
  }

  async findNoteById(id: string) {
    const note = await this.notesRepository.findAdminNoteById(id);

    if (!note) {
      throw new NotFoundException('Nota no encontrada');
    }

    return note;
  }

  async approveNote(id: string) {
    const note = await this.notesRepository.findNoteById(id);

    if (!note) {
      throw new NotFoundException('Nota no encontrada');
    }

    return this.notesRepository.approveNoteById(id);
  }

  async deleteNote(id: string): Promise<DeleteNoteResponse> {
    const note = await this.notesRepository.findNoteById(id);

    if (!note) {
      throw new NotFoundException('Nota no encontrada');
    }

    if (note.storagePath) {
      await this.storageService.deleteFile(note.storagePath);
    }

    await this.notesRepository.deleteNoteById(id);

    return {
      deleted: true,
      id,
    };
  }

  getStats() {
    return this.notesRepository.getStats();
  }
}
