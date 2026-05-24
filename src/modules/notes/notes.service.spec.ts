import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NoteType } from '@prisma/client';

import { StorageService } from '../storage/storage.service';
import { NotesRepository, PublicNoteRecord } from './notes.repository';
import { NotesService } from './notes.service';

describe('NotesService', () => {
  const createdAt = new Date('2026-05-24T00:00:00.000Z');
  const testPepper = 'test-pepper-with-at-least-32-chars-here';

  let repository: jest.Mocked<
    Pick<
      NotesRepository,
      'createTextNote' | 'createDrawingNote' | 'findPublicNotes'
    >
  >;
  let storageService: jest.Mocked<Pick<StorageService, 'uploadDrawing'>>;
  let configService: jest.Mocked<Pick<ConfigService, 'get'>>;
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
    configService = {
      get: jest.fn().mockReturnValue(testPepper),
    };
    service = new NotesService(
      repository as unknown as NotesRepository,
      storageService as unknown as StorageService,
      configService as unknown as ConfigService,
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

  it('createTextNote rejects message exceeding max length', async () => {
    await expect(
      service.createTextNote({
        recipientName: 'Kori',
        message: 'a'.repeat(257),
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('createTextNote rejects recipientName exceeding max length', async () => {
    await expect(
      service.createTextNote({
        recipientName: 'a'.repeat(41),
        message: 'hola',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('createTextNote uses HMAC fingerprint hashes', async () => {
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

    await service.createTextNote(
      { recipientName: 'Kori', message: 'hola' },
      { ip: '1.2.3.4', userAgent: 'agent' },
    );

    const payload = repository.createTextNote.mock.calls[0]?.[0];

    // HMAC produces 64-char hex string
    expect(payload?.ipHash).toMatch(/^[0-9a-f]{64}$/);
    expect(payload?.userAgentHash).toMatch(/^[0-9a-f]{64}$/);
    // Must NOT be raw ip
    expect(payload?.ipHash).not.toBe('1.2.3.4');
  });

  it('createTextNote fingerprint hashes are null when no ip/userAgent', async () => {
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

    await service.createTextNote({ recipientName: 'Kori', message: 'hola' });

    const payload = repository.createTextNote.mock.calls[0]?.[0];

    expect(payload?.ipHash).toBeNull();
    expect(payload?.userAgentHash).toBeNull();
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

  it('createDrawingNote rejects missing file', async () => {
    await expect(
      service.createDrawingNote({ recipientName: 'Kori' }, undefined),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('createDrawingNote rejects file exceeding 2MB', async () => {
    const bigFile: Express.Multer.File = {
      ...createPngFile(),
      size: 3 * 1024 * 1024,
      buffer: Buffer.alloc(3 * 1024 * 1024),
    };

    await expect(
      service.createDrawingNote({ recipientName: 'Kori' }, bigFile),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('createDrawingNote rejects invalid MIME type', async () => {
    const file: Express.Multer.File = {
      ...createPngFile(),
      mimetype: 'application/pdf',
    };

    await expect(
      service.createDrawingNote({ recipientName: 'Kori' }, file),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('createDrawingNote rejects file with invalid magic bytes', async () => {
    const file: Express.Multer.File = {
      ...createPngFile(),
      buffer: Buffer.from([0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07]),
    };

    await expect(
      service.createDrawingNote({ recipientName: 'Kori' }, file),
    ).rejects.toBeInstanceOf(BadRequestException);
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
