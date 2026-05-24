import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { NoteType } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import request from 'supertest';
import type { App } from 'supertest/types';

import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/modules/prisma/prisma.service';
import { StorageService } from '../src/modules/storage/storage.service';

interface PublicNoteResponse {
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
}

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
  };
}

type PrismaMock = {
  $connect: jest.Mock<Promise<void>, []>;
  $disconnect: jest.Mock<Promise<void>, []>;
  $transaction: jest.Mock<Promise<unknown[]>, [Promise<unknown>[]]>;
  note: {
    create: jest.Mock<Promise<PublicNoteResponse>, [NoteCreateArgs]>;
    findMany: jest.Mock<Promise<PublicNoteResponse[]>, []>;
    count: jest.Mock<Promise<number>, []>;
    findUnique: jest.Mock<Promise<PublicNoteResponse | null>, []>;
    delete: jest.Mock<Promise<PublicNoteResponse>, []>;
  };
};

describe('Kori backend (e2e)', () => {
  let app: INestApplication;
  let httpServer: App;
  let prismaMock: PrismaMock;

  beforeEach(async () => {
    process.env.JWT_SECRET = 'test-secret-with-at-least-32-characters';
    process.env.ADMIN_USERNAME = 'kori';
    process.env.ADMIN_PASSWORD_HASH = bcrypt.hashSync('diciembre2026', 10);
    process.env.JWT_EXPIRES_IN = '2h';
    process.env.SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key';
    process.env.SUPABASE_STORAGE_BUCKET = 'notes';
    process.env.LANDING_ORIGIN = 'http://localhost:4321';
    process.env.DASHBOARD_ORIGIN = 'http://localhost:3000';

    prismaMock = createPrismaMock();

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue(prismaMock)
      .overrideProvider(StorageService)
      .useValue({
        uploadDrawing: jest.fn(),
        deleteFile: jest.fn(),
      })
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

  it('POST /notes/text creates a note', async () => {
    const response = await request(httpServer)
      .post('/notes/text')
      .send({
        recipientName: 'Kori',
        message: 'hola',
      })
      .expect(201);
    const body = response.body as Partial<PublicNoteResponse>;

    expect(body).toMatchObject({
      id: 'note-id',
      type: NoteType.TEXT,
      recipientName: 'Kori',
      message: 'hola',
    });
  });

  it('GET /notes/public returns an array', async () => {
    await request(httpServer)
      .get('/notes/public')
      .expect(200)
      .expect((response) => {
        const body = response.body as PublicNoteResponse[];

        expect(Array.isArray(body)).toBe(true);
        expect(body[0]).not.toHaveProperty('ipHash');
        expect(body[0]).not.toHaveProperty('userAgentHash');
      });
  });

  it('POST /auth/login returns a token with valid credentials', async () => {
    const response = await request(httpServer)
      .post('/auth/login')
      .send({
        username: 'kori',
        password: 'diciembre2026',
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
});

function createPrismaMock(): PrismaMock {
  const createdAt = new Date('2026-05-24T00:00:00.000Z');
  const publicNote: PublicNoteResponse = {
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
  };

  return {
    $connect: jest.fn<Promise<void>, []>().mockResolvedValue(undefined),
    $disconnect: jest.fn<Promise<void>, []>().mockResolvedValue(undefined),
    $transaction: jest
      .fn<Promise<unknown[]>, [Promise<unknown>[]]>()
      .mockImplementation((operations) => Promise.all(operations)),
    note: {
      create: jest
        .fn<Promise<PublicNoteResponse>, [NoteCreateArgs]>()
        .mockImplementation(({ data }) =>
          Promise.resolve({
            ...publicNote,
            ...data,
            id: 'note-id',
            createdAt,
            storagePath: data.storagePath ?? null,
            imageUrl: data.imageUrl ?? null,
            message: data.message ?? null,
            color: data.color ?? null,
          }),
        ),
      findMany: jest
        .fn<Promise<PublicNoteResponse[]>, []>()
        .mockResolvedValue([publicNote]),
      count: jest.fn<Promise<number>, []>().mockResolvedValue(1),
      findUnique: jest
        .fn<Promise<PublicNoteResponse | null>, []>()
        .mockResolvedValue(null),
      delete: jest
        .fn<Promise<PublicNoteResponse>, []>()
        .mockResolvedValue(publicNote),
    },
  };
}
