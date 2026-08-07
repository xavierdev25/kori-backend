import { NotFoundException } from '@nestjs/common';
import { NoteStatus, NoteType } from '@prisma/client';

import { NotesRepository } from '../notes/notes.repository';
import { StorageService } from '../storage/storage.service';
import { AdminNotesService } from './admin-notes.service';

describe('AdminNotesService', () => {
  const createdAt = new Date('2026-05-24T00:00:00.000Z');

  let repository: jest.Mocked<
    Pick<
      NotesRepository,
      | 'findNoteById'
      | 'deleteNoteById'
      | 'getStats'
      | 'findAdminNotes'
      | 'findAdminNoteById'
      | 'approveNoteById'
      | 'rejectNoteById'
    >
  >;
  let storageService: jest.Mocked<Pick<StorageService, 'deleteFile'>>;
  let service: AdminNotesService;

  beforeEach(() => {
    repository = {
      findNoteById: jest.fn(),
      deleteNoteById: jest.fn(),
      getStats: jest.fn(),
      findAdminNotes: jest.fn(),
      findAdminNoteById: jest.fn(),
      approveNoteById: jest.fn(),
      rejectNoteById: jest.fn(),
    };
    storageService = {
      deleteFile: jest.fn(),
    };
    service = new AdminNotesService(
      repository as unknown as NotesRepository,
      storageService as unknown as StorageService,
    );
  });

  it('rejectNote sends an approved note back to PENDING', async () => {
    repository.findNoteById.mockResolvedValue({
      id: 'note-id',
      type: NoteType.TEXT,
      status: NoteStatus.APPROVED,
      recipientName: 'Kori',
      message: 'hola',
      imageUrl: null,
      storagePath: null,
      color: 'yellow',
      rotation: 0,
      positionX: 0,
      positionY: 0,
      zIndex: 1,
      ipHash: null,
      userAgentHash: null,
      createdAt,
    });

    await service.rejectNote('note-id');

    expect(repository.rejectNoteById).toHaveBeenCalledWith('note-id');
  });

  it('rejectNote throws NotFoundException for a missing note', async () => {
    repository.findNoteById.mockResolvedValue(null);

    await expect(service.rejectNote('note-id')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(repository.rejectNoteById).not.toHaveBeenCalled();
  });

  it('deleteNote deletes the note', async () => {
    repository.findNoteById.mockResolvedValue({
      id: 'note-id',
      type: NoteType.TEXT,
      recipientName: 'Kori',
      message: 'hola',
      imageUrl: null,
      storagePath: null,
      color: 'yellow',
      rotation: 0,
      zIndex: 1,
      ipHash: null,
      userAgentHash: null,
      createdAt,
    });
    repository.deleteNoteById.mockResolvedValue({
      id: 'note-id',
      type: NoteType.TEXT,
      recipientName: 'Kori',
      message: 'hola',
      imageUrl: null,
      storagePath: null,
      color: 'yellow',
      rotation: 0,
      zIndex: 1,
      ipHash: null,
      userAgentHash: null,
      createdAt,
    });

    await expect(service.deleteNote('note-id')).resolves.toEqual({
      deleted: true,
      id: 'note-id',
    });
    expect(repository.deleteNoteById).toHaveBeenCalledWith('note-id');
    expect(storageService.deleteFile).not.toHaveBeenCalled();
  });

  it('deleteNote deletes associated storage file when storagePath exists', async () => {
    repository.findNoteById.mockResolvedValue({
      id: 'note-id',
      type: NoteType.DRAWING,
      recipientName: 'Kori',
      message: null,
      imageUrl: 'https://example.com/drawing.png',
      storagePath: 'drawings/file.png',
      color: null,
      rotation: 0,
      zIndex: 1,
      ipHash: null,
      userAgentHash: null,
      createdAt,
    });
    repository.deleteNoteById.mockResolvedValue({
      id: 'note-id',
      type: NoteType.DRAWING,
      recipientName: 'Kori',
      message: null,
      imageUrl: 'https://example.com/drawing.png',
      storagePath: 'drawings/file.png',
      color: null,
      rotation: 0,
      zIndex: 1,
      ipHash: null,
      userAgentHash: null,
      createdAt,
    });

    await service.deleteNote('note-id');

    expect(storageService.deleteFile).toHaveBeenCalledWith('drawings/file.png');
  });

  it('returns stats from repository', async () => {
    repository.getStats.mockResolvedValue({
      total: 3,
      totalText: 2,
      totalDrawing: 1,
    });

    await expect(service.getStats()).resolves.toEqual({
      total: 3,
      totalText: 2,
      totalDrawing: 1,
    });
  });
});
