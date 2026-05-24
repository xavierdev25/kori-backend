import { INestApplication } from '@nestjs/common';
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
  $queryRaw: jest.Mock<Promise<unknown[]>, []>;
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
    process.env.JWT_ISSUER = 'kori-backend';
    process.env.JWT_AUDIENCE = 'kori-dashboard';
    process.env.HASH_PEPPER = 'test-pepper-with-at-least-32-chars-here';
    process.env.SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key';
    process.env.SUPABASE_STORAGE_BUCKET = 'notes';
    process.env.LANDING_ORIGIN = 'http://localhost:4321';
    process.env.DASHBOARD_ORIGIN = 'http://localhost:3000';
    process.env.DATABASE_URL =
      'postgresql://user:pass@localhost:5432/kori?schema=public';
    process.env.DIRECT_URL =
      'postgresql://user:pass@localhost:5432/kori?schema=public';
    process.env.NODE_ENV = 'test';

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
    await app.init();
    httpServer = app.getHttpServer() as App;
  });

  afterEach(async () => {
    await app.close();
  });

  // ── Health ──────────────────────────────────────────────────────────────────

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

  it('GET /health/liveness returns ok', async () => {
    const response = await request(httpServer)
      .get('/health/liveness')
      .expect(200);
    const body = response.body as { status?: unknown };

    expect(body.status).toBe('ok');
  });

  it('GET /health/readiness returns ok when DB is healthy', async () => {
    const response = await request(httpServer)
      .get('/health/readiness')
      .expect(200);
    const body = response.body as {
      status?: unknown;
      checks?: { database?: unknown };
    };

    expect(body.status).toBe('ok');
    expect(body.checks?.database).toBe('ok');
  });

  it('GET /health/readiness returns 503 when DB is down', async () => {
    prismaMock.$queryRaw.mockRejectedValueOnce(new Error('DB unreachable'));

    await request(httpServer).get('/health/readiness').expect(503);
  });

  // ── Notes public ────────────────────────────────────────────────────────────

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

  it('POST /notes/text rejects message over 256 chars', async () => {
    const response = await request(httpServer)
      .post('/notes/text')
      .send({
        recipientName: 'Kori',
        message: 'a'.repeat(257),
      })
      .expect(400);

    expectErrorEnvelope(response.body, 'VALIDATION_ERROR');
  });

  it('POST /notes/text rejects recipientName over 40 chars', async () => {
    const response = await request(httpServer)
      .post('/notes/text')
      .send({
        recipientName: 'a'.repeat(41),
        message: 'hola',
      })
      .expect(400);

    expectErrorEnvelope(response.body, 'VALIDATION_ERROR');
  });

  it('POST /notes/text strips HTML/script in message', async () => {
    const response = await request(httpServer)
      .post('/notes/text')
      .send({
        recipientName: 'Kori',
        message: '<script>alert("xss")</script>hola',
      })
      .expect(201);
    const body = response.body as Partial<NoteResponse>;

    expect(body.message).not.toContain('<script>');
    expect(body.message).toContain('hola');
  });

  it('POST /notes/text rejects extra fields', async () => {
    await request(httpServer)
      .post('/notes/text')
      .send({
        recipientName: 'Kori',
        message: 'hola',
        extraField: 'injected',
      })
      .expect(400);
  });

  it('POST /notes/text returns x-request-id header', async () => {
    const response = await request(httpServer)
      .post('/notes/text')
      .send({ recipientName: 'Kori', message: 'hola' })
      .expect(201);

    expect(response.headers['x-request-id']).toBeDefined();
    expect(response.headers['x-request-id']).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
  });

  it('POST /notes/text propagates caller x-request-id when valid UUID', async () => {
    const callerRequestId = '11111111-2222-4333-8444-555555555555';
    const response = await request(httpServer)
      .post('/notes/text')
      .set('x-request-id', callerRequestId)
      .send({ recipientName: 'Kori', message: 'hola' })
      .expect(201);

    expect(response.headers['x-request-id']).toBe(callerRequestId);
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

  it('POST /notes/drawing rejects missing file', async () => {
    const response = await request(httpServer)
      .post('/notes/drawing')
      .field('recipientName', 'Kori')
      .expect(400);

    expectErrorEnvelope(response.body, 'VALIDATION_ERROR');
  });

  it('POST /notes/drawing rejects invalid MIME type', async () => {
    const response = await request(httpServer)
      .post('/notes/drawing')
      .field('recipientName', 'Kori')
      .attach('file', Buffer.from('pdf content'), {
        filename: 'file.pdf',
        contentType: 'application/pdf',
      })
      .expect(400);

    expectErrorEnvelope(response.body, 'VALIDATION_ERROR');
  });

  it('POST /notes/drawing rejects file with invalid magic bytes (PNG MIME, bad bytes)', async () => {
    const fakeBuffer = Buffer.from([0x00, 0x01, 0x02, 0x03, 0x04, 0x05]);
    const response = await request(httpServer)
      .post('/notes/drawing')
      .field('recipientName', 'Kori')
      .attach('file', fakeBuffer, {
        filename: 'drawing.png',
        contentType: 'image/png',
      })
      .expect(400);

    expectErrorEnvelope(response.body, 'VALIDATION_ERROR');
  });

  it('POST /notes/drawing does not expose storagePath in public response', async () => {
    storageServiceMock.uploadDrawing.mockResolvedValue({
      imageUrl: 'https://example.com/drawing.png',
      storagePath: 'drawings/secret-path.png',
    });

    const response = await request(httpServer)
      .post('/notes/drawing')
      .field('recipientName', 'Kori')
      .attach('file', createPngBuffer(), {
        filename: 'drawing.png',
        contentType: 'image/png',
      })
      .expect(201);

    expect(response.body).not.toHaveProperty('storagePath');
    expect(JSON.stringify(response.body)).not.toContain('secret-path');
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

  it('GET /notes/public returns Cache-Control and ETag headers', async () => {
    const response = await request(httpServer).get('/notes/public').expect(200);

    expect(response.headers['cache-control']).toContain('public');
    expect(response.headers['etag']).toBeDefined();
  });

  it('GET /notes/public returns 304 when ETag matches', async () => {
    const first = await request(httpServer).get('/notes/public').expect(200);
    const etag = first.headers['etag'];

    await request(httpServer)
      .get('/notes/public')
      .set('If-None-Match', etag)
      .expect(304);
  });

  // ── Auth ────────────────────────────────────────────────────────────────────

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

  it('POST /auth/login returns no-store Cache-Control', async () => {
    const response = await request(httpServer)
      .post('/auth/login')
      .send({ username: 'kori', password: validPassword })
      .expect(201);

    expect(response.headers['cache-control']).toBe('no-store');
  });

  it('POST /auth/login returns 401 for invalid password', async () => {
    const response = await request(httpServer)
      .post('/auth/login')
      .send({ username: 'kori', password: 'wrong-password' })
      .expect(401);

    expectErrorEnvelope(response.body, 'UNAUTHORIZED');
  });

  it('POST /auth/login returns 401 for invalid username', async () => {
    const response = await request(httpServer)
      .post('/auth/login')
      .send({ username: 'hacker', password: validPassword })
      .expect(401);

    expectErrorEnvelope(response.body, 'UNAUTHORIZED');
  });

  // ── Admin notes ──────────────────────────────────────────────────────────────

  it('GET /admin/notes without token returns 401', async () => {
    const response = await request(httpServer).get('/admin/notes').expect(401);

    expectErrorEnvelope(response.body, 'UNAUTHORIZED');
  });

  it('GET /admin/notes returns no-store Cache-Control', async () => {
    const token = await getAccessToken(httpServer, validPassword);
    const response = await request(httpServer)
      .get('/admin/notes')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(response.headers['cache-control']).toBe('no-store');
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

  it('GET /admin/notes/stats returns note counts', async () => {
    const token = await getAccessToken(httpServer, validPassword);
    const response = await request(httpServer)
      .get('/admin/notes/stats')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const body = response.body as {
      total?: number;
      totalText?: number;
      totalDrawing?: number;
    };

    expect(typeof body.total).toBe('number');
    expect(typeof body.totalText).toBe('number');
    expect(typeof body.totalDrawing).toBe('number');
  });

  it('GET /admin/notes/:id returns 404 for unknown note', async () => {
    prismaMock.note.findUnique.mockResolvedValueOnce(null);
    const token = await getAccessToken(httpServer, validPassword);
    const response = await request(httpServer)
      .get(`/admin/notes/${textNoteId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(404);

    expectErrorEnvelope(response.body, 'NOT_FOUND');
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

  it('DELETE /admin/notes/:id with invalid UUID returns 400', async () => {
    const token = await getAccessToken(httpServer, validPassword);
    const response = await request(httpServer)
      .delete('/admin/notes/not-a-uuid')
      .set('Authorization', `Bearer ${token}`)
      .expect(400);

    expectErrorEnvelope(response.body, 'VALIDATION_ERROR');
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

  // ── Error envelope ───────────────────────────────────────────────────────────

  it('error responses include uniform envelope fields', async () => {
    const response = await request(httpServer)
      .post('/notes/text')
      .send({})
      .expect(400);
    const body = response.body as Record<string, unknown>;

    expect(body.success).toBe(false);
    expect(typeof (body.error as Record<string, unknown>)?.requestId).toBe(
      'string',
    );
    expect(typeof (body.error as Record<string, unknown>)?.timestamp).toBe(
      'string',
    );
    expect((body.error as Record<string, unknown>)?.path).toBe('/notes/text');
    expect((body.error as Record<string, unknown>)?.method).toBe('POST');
  });
});

// ── Helpers ────────────────────────────────────────────────────────────────────

function createPrismaMock(): PrismaMock {
  const note = createNote();

  return {
    $connect: jest.fn<Promise<void>, []>().mockResolvedValue(undefined),
    $disconnect: jest.fn<Promise<void>, []>().mockResolvedValue(undefined),
    $transaction: jest
      .fn<Promise<unknown[]>, [Promise<unknown>[]]>()
      .mockImplementation((operations) => Promise.all(operations)),
    $queryRaw: jest
      .fn<Promise<unknown[]>, []>()
      .mockResolvedValue([{ '?column?': 1 }]),
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

function expectErrorEnvelope(body: unknown, expectedCode?: string) {
  const b = body as Record<string, unknown>;

  expect(b.success).toBe(false);
  expect(b.error).toBeDefined();

  const error = b.error as Record<string, unknown>;

  expect(typeof error.code).toBe('string');
  expect(typeof error.message).toBe('string');
  expect(typeof error.requestId).toBe('string');
  expect(typeof error.timestamp).toBe('string');

  if (expectedCode) {
    expect(error.code).toBe(expectedCode);
  }
}

function createPngBuffer(): Buffer {
  return Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
}
