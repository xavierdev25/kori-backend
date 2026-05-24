import { BadRequestException } from '@nestjs/common';
import { NoteType } from '@prisma/client';

import { StorageService } from '../storage/storage.service';
import { NotesRepository, PublicNoteRecord } from './notes.repository';
import { NotesService } from './notes.service';

describe('NotesService', () => {
  const createdAt = new Date('2026-05-24T00:00:00.000Z');

  let repository: jest.Mocked<
    Pick<
      NotesRepository,
      'createTextNote' | 'createDrawingNote' | 'findPublicNotes'
    >
  >;
  let storageService: jest.Mocked<Pick<StorageService, 'uploadDrawing'>>;
  let service: NotesService;

  beforeEach(() => {
    repository = {
      createTextNote: jest.fn(),
      createDrawingNote: jest.fn(),
      findPublicNotes: jest.fn(),
    };
    storageService = {
      uploadDrawing: jest.fn(),
    };
    service = new NotesService(
      repository as unknown as NotesRepository,
      storageService as unknown as StorageService,
    );
  });

  it('createTextNote creates a TEXT note with sanitized data', async () => {
    repository.createTextNote.mockResolvedValue({
      id: 'note-id',
      type: NoteType.TEXT,
      recipientName: 'Kori',
      message: 'hola',
      imageUrl: null,
      color: 'yellow',
      rotation: 0,
      positionX: 0,
      positionY: 0,
      zIndex: 1,
      createdAt,
    });

    const note = await service.createTextNote(
      {
        recipientName: '<b>Kori</b>',
        message: '<i>hola</i>',
      },
      {
        ip: '127.0.0.1',
        userAgent: 'jest',
      },
    );

    expect(note.type).toBe(NoteType.TEXT);
    expect(note).not.toHaveProperty('ipHash');
    expect(note).not.toHaveProperty('userAgentHash');
    expect(note).not.toHaveProperty('storagePath');
    const createPayload = repository.createTextNote.mock.calls[0]?.[0];

    expect(createPayload).toMatchObject({
      recipientName: 'Kori',
      message: 'hola',
    });
    expect(typeof createPayload?.ipHash).toBe('string');
    expect(typeof createPayload?.userAgentHash).toBe('string');
  });

  it('createTextNote rejects empty fields after sanitization', async () => {
    await expect(
      service.createTextNote({
        recipientName: '<script>alert("x")</script>',
        message: 'hola',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('createDrawingNote uploads the file and creates a DRAWING note', async () => {
    const file = createPngFile();

    storageService.uploadDrawing.mockResolvedValue({
      imageUrl: 'https://example.com/drawing.png',
      storagePath: 'drawings/file.png',
    });
    repository.createDrawingNote.mockResolvedValue({
      id: 'note-id',
      type: NoteType.DRAWING,
      recipientName: 'Kori',
      message: null,
      imageUrl: 'https://example.com/drawing.png',
      color: null,
      rotation: 0,
      positionX: 0,
      positionY: 0,
      zIndex: 1,
      createdAt,
    });

    const note = await service.createDrawingNote(
      {
        recipientName: '<b>Kori</b>',
      },
      file,
    );

    expect(storageService.uploadDrawing).toHaveBeenCalledWith(file);
    expect(note.type).toBe(NoteType.DRAWING);
    expect(note).not.toHaveProperty('ipHash');
    expect(note).not.toHaveProperty('userAgentHash');
    expect(note).not.toHaveProperty('storagePath');
    expect(repository.createDrawingNote).toHaveBeenCalledWith(
      expect.objectContaining({
        recipientName: 'Kori',
        imageUrl: 'https://example.com/drawing.png',
        storagePath: 'drawings/file.png',
      }),
    );
  });

  it('findPublicNotes returns only public fields from repository mapper', async () => {
    const publicNotes: PublicNoteRecord[] = [
      {
        id: 'note-id',
        type: NoteType.TEXT,
        recipientName: 'Kori',
        message: 'hola',
        imageUrl: null,
        color: 'yellow',
        rotation: 0,
        positionX: 0,
        positionY: 0,
        zIndex: 1,
        createdAt,
      },
    ];
    repository.findPublicNotes.mockResolvedValue(publicNotes);

    const result = await service.findPublicNotes();

    expect(result[0]).not.toHaveProperty('ipHash');
    expect(result[0]).not.toHaveProperty('userAgentHash');
    expect(result[0]).not.toHaveProperty('storagePath');
  });
});

function createPngFile(): Express.Multer.File {
  const buffer = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  return {
    fieldname: 'file',
    originalname: 'drawing.png',
    encoding: '7bit',
    mimetype: 'image/png',
    size: buffer.length,
    buffer,
    destination: '',
    filename: '',
    path: '',
    stream: undefined as unknown as Express.Multer.File['stream'],
  };
}
