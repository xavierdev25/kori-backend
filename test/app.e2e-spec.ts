import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { NoteType } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import request from 'supertest';
import type { App } from 'supertest/types';

import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/modules/prisma/prisma.service';
import { StorageService } from '../src/modules/storage/storage.service';

interface NoteResponse {
  id: string;
  type: NoteType;
  recipientName: string;
  message: string | null;
  imageUrl: string | null;
  color: string | null;
  rotation: number;
  positionX: number;
  positionY: number;
  zIndex: number;
  createdAt: Date;
  storagePath?: string | null;
  ipHash?: string | null;
  userAgentHash?: string | null;
}

type NoteSelect = Partial<Record<keyof NoteResponse, boolean>>;

interface NoteCreateArgs {
  data: {
    type: NoteType;
    recipientName: string;
    message?: string;
    imageUrl?: string;
    storagePath?: string;
    color?: string;
    rotation: number;
    positionX: number;
    positionY: number;
    zIndex: number;
    ipHash?: string | null;
    userAgentHash?: string | null;
  };
  select?: NoteSelect;
}

interface NoteFindManyArgs {
  select?: NoteSelect;
}

type PrismaMock = {
  $connect: jest.Mock<Promise<void>, []>;
  $disconnect: jest.Mock<Promise<void>, []>;
  $transaction: jest.Mock<Promise<unknown[]>, [Promise<unknown>[]]>;
  note: {
    create: jest.Mock<Promise<Partial<NoteResponse>>, [NoteCreateArgs]>;
    findMany: jest.Mock<Promise<Partial<NoteResponse>[]>, [NoteFindManyArgs?]>;
    count: jest.Mock<Promise<number>, []>;
    findUnique: jest.Mock<Promise<Partial<NoteResponse> | null>, []>;
    delete: jest.Mock<Promise<Partial<NoteResponse>>, []>;
  };
};

type StorageMock = {
  uploadDrawing: jest.Mock<
    Promise<{ imageUrl: string; storagePath: string }>,
    [Express.Multer.File]
  >;
  deleteFile: jest.Mock<Promise<void>, [string]>;
};

describe('Kori backend (e2e)', () => {
  const validPassword = 'admin-password-for-test';
  const textNoteId = '00000000-0000-4000-8000-000000000001';
  const drawingNoteId = '00000000-0000-4000-8000-000000000002';

  let app: INestApplication;
  let httpServer: App;
  let prismaMock: PrismaMock;
  let storageServiceMock: StorageMock;

  beforeEach(async () => {
    process.env.JWT_SECRET = 'test-secret-with-at-least-32-characters';
    process.env.ADMIN_USERNAME = 'kori';
    process.env.ADMIN_PASSWORD_HASH = bcrypt.hashSync(validPassword, 10);
    process.env.JWT_EXPIRES_IN = '2h';
    process.env.SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key';
    process.env.SUPABASE_STORAGE_BUCKET = 'notes';
    process.env.LANDING_ORIGIN = 'http://localhost:4321';
    process.env.DASHBOARD_ORIGIN = 'http://localhost:3000';

    prismaMock = createPrismaMock();
    storageServiceMock = {
      uploadDrawing: jest.fn<
        Promise<{ imageUrl: string; storagePath: string }>,
        [Express.Multer.File]
      >(),
      deleteFile: jest.fn<Promise<void>, [string]>(),
    };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue(prismaMock)
      .overrideProvider(StorageService)
      .useValue(storageServiceMock)
      .compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );

    await app.init();
    httpServer = app.getHttpServer() as App;
  });

  afterEach(async () => {
    await app.close();
  });

  it('GET /health returns ok', async () => {
    await request(httpServer)
      .get('/health')
      .expect(200)
      .expect((response) => {
        const body = response.body as {
          status?: unknown;
          service?: unknown;
          timestamp?: unknown;
        };

        expect(body.status).toBe('ok');
        expect(body.service).toBe('kori-backend');
        expect(typeof body.timestamp).toBe('string');
      });
  });

  it('POST /notes/text creates a public note response', async () => {
    const response = await request(httpServer)
      .post('/notes/text')
      .send({
        recipientName: 'Kori',
        message: 'hola',
      })
      .expect(201);
    const body = response.body as Partial<NoteResponse>;

    expect(body).toMatchObject({
      id: 'note-id',
      type: NoteType.TEXT,
      recipientName: 'Kori',
      message: 'hola',
    });
    expectPublicNoteResponse(body);
  });

  it('POST /notes/drawing creates a public note response', async () => {
    storageServiceMock.uploadDrawing.mockResolvedValue({
      imageUrl: 'https://example.com/drawing.png',
      storagePath: 'drawings/file.png',
    });

    const response = await request(httpServer)
      .post('/notes/drawing')
      .field('recipientName', 'Kori')
      .attach('file', createPngBuffer(), {
        filename: 'drawing.png',
        contentType: 'image/png',
      })
      .expect(201);
    const body = response.body as Partial<NoteResponse>;

    expect(body).toMatchObject({
      id: 'note-id',
      type: NoteType.DRAWING,
      recipientName: 'Kori',
      message: null,
      imageUrl: 'https://example.com/drawing.png',
      color: null,
    });
    expectPublicNoteResponse(body);
  });

  it('GET /notes/public returns an array', async () => {
    await request(httpServer)
      .get('/notes/public')
      .expect(200)
      .expect((response) => {
        const body = response.body as Partial<NoteResponse>[];

        expect(Array.isArray(body)).toBe(true);
        expectPublicNoteResponse(body[0]);
      });
  });

  it('POST /auth/login returns a token with valid credentials', async () => {
    const response = await request(httpServer)
      .post('/auth/login')
      .send({
        username: 'kori',
        password: validPassword,
      })
      .expect(201);
    const body = response.body as {
      accessToken?: unknown;
      expiresIn?: unknown;
    };

    expect(typeof body.accessToken).toBe('string');
    expect(body.expiresIn).toBe('2h');
  });

  it('GET /admin/notes without token returns 401', async () => {
    await request(httpServer).get('/admin/notes').expect(401);
  });

  it('GET /admin/notes with token can include storagePath', async () => {
    const loginResponse = await request(httpServer)
      .post('/auth/login')
      .send({
        username: 'kori',
        password: validPassword,
      })
      .expect(201);
    const body = loginResponse.body as { accessToken?: string };

    await request(httpServer)
      .get('/admin/notes')
      .set('Authorization', `Bearer ${body.accessToken}`)
      .expect(200)
      .expect((response) => {
        const adminBody = response.body as {
          data?: Array<Partial<NoteResponse>>;
        };

        expect(adminBody.data?.[0]).toHaveProperty('storagePath');
      });
  });

  it('DELETE /admin/notes/:id without token returns 401', async () => {
    await request(httpServer).delete(`/admin/notes/${textNoteId}`).expect(401);
  });

  it('DELETE /admin/notes/:id with invalid token returns 401 safely', async () => {
    await request(httpServer)
      .delete(`/admin/notes/${textNoteId}`)
      .set('Authorization', 'Bearer invalid-token')
      .expect(401)
      .expect((response) => {
        const body = JSON.stringify(response.body);

        expect(body).not.toContain('JWT_SECRET');
        expect(body).not.toContain('SUPABASE_SERVICE_ROLE_KEY');
        expect(body).not.toContain('DATABASE_URL');
        expect(body).not.toContain('stack');
      });
  });

  it('DELETE /admin/notes/:id deletes a TEXT note without deleting storage', async () => {
    const note = createNote({
      id: textNoteId,
      type: NoteType.TEXT,
      message: 'hola',
      imageUrl: null,
      storagePath: null,
      color: 'yellow',
    });
    prismaMock.note.findUnique.mockResolvedValueOnce(note);
    prismaMock.note.delete.mockResolvedValueOnce(note);

    const accessToken = await getAccessToken(httpServer, validPassword);

    await request(httpServer)
      .delete(`/admin/notes/${textNoteId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200)
      .expect({
        deleted: true,
        id: textNoteId,
      });

    expect(prismaMock.note.delete).toHaveBeenCalled();
    expect(storageServiceMock.deleteFile).not.toHaveBeenCalled();
  });

  it('DELETE /admin/notes/:id deletes a DRAWING note and its storage file', async () => {
    const note = createNote({
      id: drawingNoteId,
      type: NoteType.DRAWING,
      message: null,
      imageUrl: 'https://example.com/drawing.png',
      storagePath: 'drawings/file.png',
      color: null,
    });
    prismaMock.note.findUnique.mockResolvedValueOnce(note);
    prismaMock.note.delete.mockResolvedValueOnce(note);

    const accessToken = await getAccessToken(httpServer, validPassword);

    await request(httpServer)
      .delete(`/admin/notes/${drawingNoteId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200)
      .expect({
        deleted: true,
        id: drawingNoteId,
      });

    expect(storageServiceMock.deleteFile).toHaveBeenCalledWith(
      'drawings/file.png',
    );
    expect(prismaMock.note.delete).toHaveBeenCalled();
  });
});

function createPrismaMock(): PrismaMock {
  const note = createNote();

  return {
    $connect: jest.fn<Promise<void>, []>().mockResolvedValue(undefined),
    $disconnect: jest.fn<Promise<void>, []>().mockResolvedValue(undefined),
    $transaction: jest
      .fn<Promise<unknown[]>, [Promise<unknown>[]]>()
      .mockImplementation((operations) => Promise.all(operations)),
    note: {
      create: jest
        .fn<Promise<Partial<NoteResponse>>, [NoteCreateArgs]>()
        .mockImplementation(({ data, select }) =>
          Promise.resolve(
            applySelect(
              {
                ...note,
                ...data,
                id: 'note-id',
                createdAt: note.createdAt,
                storagePath: data.storagePath ?? null,
                imageUrl: data.imageUrl ?? null,
                message: data.message ?? null,
                color: data.color ?? null,
              },
              select,
            ),
          ),
        ),
      findMany: jest
        .fn<Promise<Partial<NoteResponse>[]>, [NoteFindManyArgs?]>()
        .mockImplementation((args) =>
          Promise.resolve([applySelect(note, args?.select)]),
        ),
      count: jest.fn<Promise<number>, []>().mockResolvedValue(1),
      findUnique: jest
        .fn<Promise<Partial<NoteResponse> | null>, []>()
        .mockResolvedValue(null),
      delete: jest
        .fn<Promise<Partial<NoteResponse>>, []>()
        .mockResolvedValue(note),
    },
  };
}

function createNote(overrides: Partial<NoteResponse> = {}): NoteResponse {
  const createdAt = new Date('2026-05-24T00:00:00.000Z');

  return {
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
    storagePath: 'drawings/file.png',
    ipHash: 'ip-hash',
    userAgentHash: 'user-agent-hash',
    ...overrides,
  };
}

async function getAccessToken(
  httpServer: App,
  password: string,
): Promise<string> {
  const response = await request(httpServer)
    .post('/auth/login')
    .send({
      username: 'kori',
      password,
    })
    .expect(201);
  const body = response.body as { accessToken?: unknown };

  if (typeof body.accessToken !== 'string') {
    throw new Error('Expected accessToken in login response');
  }

  return body.accessToken;
}

function applySelect(
  note: NoteResponse,
  select?: NoteSelect,
): Partial<NoteResponse> {
  if (!select) {
    return note;
  }

  const selected: Partial<NoteResponse> = {};

  for (const key of Object.keys(select) as Array<keyof NoteResponse>) {
    if (select[key]) {
      selected[key] = note[key] as never;
    }
  }

  return selected;
}

function expectPublicNoteResponse(note: Partial<NoteResponse> | undefined) {
  expect(note).toBeDefined();
  expect(note).toHaveProperty('id');
  expect(note).toHaveProperty('type');
  expect(note).toHaveProperty('recipientName');
  expect(note).toHaveProperty('message');
  expect(note).toHaveProperty('imageUrl');
  expect(note).toHaveProperty('color');
  expect(note).toHaveProperty('rotation');
  expect(note).toHaveProperty('positionX');
  expect(note).toHaveProperty('positionY');
  expect(note).toHaveProperty('zIndex');
  expect(note).toHaveProperty('createdAt');
  expect(note).not.toHaveProperty('storagePath');
  expect(note).not.toHaveProperty('ipHash');
  expect(note).not.toHaveProperty('userAgentHash');
}

function createPngBuffer(): Buffer {
  return Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
}
