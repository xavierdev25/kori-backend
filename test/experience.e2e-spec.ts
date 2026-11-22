import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as bcrypt from 'bcrypt';
import request from 'supertest';
import type { App } from 'supertest/types';

import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/modules/prisma/prisma.service';
import { StorageService } from '../src/modules/storage/storage.service';
import { argDe } from './helpers/mock-args';

/**
 * La experiencia del caballo (la portada): registro, cartas públicas y
 * progreso del juego, con la aplicación entera delante —pipe global de
 * validación, limitador, guardia de sesión y guardia JWT del panel—.
 *
 * La base se simula; lo que hace la base de verdad (CHECKs, bloqueos,
 * arreglos) se probó contra un Postgres real al escribir la migración.
 */

const ADMIN_EMAIL = 'kori@ejemplo.mx';
const PASSWORD = 'admin-password-for-test';
const TOKEN_VALIDO = 'A'.repeat(43);
const CARTA_ID = '00000000-0000-4000-8000-000000000020';

const REGISTRO = {
  email: 'Persona@Ejemplo.com',
  country: 'MX',
  region: 'Jalisco',
  city: 'Zapopan',
  locale: 'es',
  ageConfirmed: true,
  privacyVersion: '2026-11-21',
};

const VACIO = {
  estrellas: 0,
  record: 0,
  recorridos: 0,
  camino: 0,
  recuerdos: [],
  paginas: [],
  encuentros: [],
  logros: [],
  abiertas: [],
};

function crearPrisma(passwordHash: string) {
  const admin = {
    id: 'user-e2e',
    email: ADMIN_EMAIL,
    passwordHash,
    role: 'ADMIN',
    isActive: true,
    mustChangePassword: false,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  };
  const tx = {
    signalSignup: {
      findUnique: jest.fn().mockResolvedValue(null),
      findUniqueOrThrow: jest.fn(),
      create: jest.fn().mockResolvedValue({ id: 'signup-1' }),
      update: jest.fn().mockResolvedValue({}),
    },
    experienceSession: { create: jest.fn().mockResolvedValue({}) },
    experienceProgress: {
      upsert: jest.fn().mockResolvedValue({ signupId: 'signup-1' }),
      findUniqueOrThrow: jest.fn().mockResolvedValue(VACIO),
      update: jest
        .fn()
        .mockImplementation((args: { data: unknown }) =>
          Promise.resolve(args.data),
        ),
    },
    $queryRaw: jest.fn().mockResolvedValue([]),
  };
  return {
    tx,
    $connect: jest.fn().mockResolvedValue(undefined),
    $disconnect: jest.fn().mockResolvedValue(undefined),
    $queryRaw: jest.fn().mockResolvedValue([{ '?column?': 1 }]),
    $transaction: jest
      .fn()
      .mockImplementation((arg: unknown) =>
        typeof arg === 'function'
          ? (arg as (t: typeof tx) => unknown)(tx)
          : Promise.all(arg as Promise<unknown>[]),
      ),
    experienceSession: {
      findUnique: jest.fn().mockImplementation(() =>
        Promise.resolve({
          id: 's1',
          signupId: 'signup-1',
          lastSeenAt: new Date(),
        }),
      ),
      update: jest.fn().mockResolvedValue({}),
    },
    experienceProgress: {
      findUnique: jest.fn().mockResolvedValue(null),
    },
    experienceLetter: {
      create: jest.fn().mockResolvedValue({ id: CARTA_ID }),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      update: jest.fn().mockResolvedValue({ id: CARTA_ID }),
      delete: jest.fn().mockResolvedValue({}),
    },
    user: {
      findUnique: jest.fn().mockImplementation((args: unknown) => {
        const where = (args as { where?: { email?: string; id?: string } })
          .where;
        const coincide =
          where?.email === undefined
            ? where?.id === admin.id
            : where.email === admin.email;
        return Promise.resolve(coincide ? admin : null);
      }),
    },
    refreshToken: {
      create: jest.fn().mockResolvedValue({}),
      findUnique: jest.fn().mockResolvedValue(null),
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    auditLog: { create: jest.fn().mockResolvedValue({}) },
  };
}

describe('La experiencia del caballo (e2e)', () => {
  let app: INestApplication;
  let http: App;
  let prisma: ReturnType<typeof crearPrisma>;

  beforeEach(async () => {
    process.env.ADMIN_PASSWORD_HASH = bcrypt.hashSync(PASSWORD, 10);
    prisma = crearPrisma(bcrypt.hashSync(PASSWORD, 10));
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .overrideProvider(StorageService)
      .useValue({ uploadDrawing: jest.fn(), deleteFile: jest.fn() })
      .compile();
    app = moduleFixture.createNestApplication(
      process.env.LOGS ? undefined : { logger: false },
    );
    await app.init();
    http = app.getHttpServer() as App;
  });

  afterEach(async () => {
    await app.close();
  });

  const conSesion = (r: request.Test) =>
    r.set('Authorization', `Bearer ${TOKEN_VALIDO}`);

  // ── Registro ───────────────────────────────────────────────────────

  it('POST /experience/register da un token y dice si está en la zona', async () => {
    const res = await request(http)
      .post('/experience/register')
      .send(REGISTRO)
      .expect(201);
    const cuerpo = res.body as { token: string; eventZone: boolean };
    expect(cuerpo.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(cuerpo.eventZone).toBe(true);
    expect(Object.keys(cuerpo).sort()).toEqual(['eventZone', 'token']);
    const datos = argDe<{ data: Record<string, unknown> }>(
      prisma.tx.signalSignup.create,
    ).data;
    expect(datos).toMatchObject({
      email: 'persona@ejemplo.com',
      source: 'experiencia',
      ageConfirmed: true,
    });
  });

  it('POST /experience/register sin edad confirmada, o con campos de más, no guarda', async () => {
    await request(http)
      .post('/experience/register')
      .send({ ...REGISTRO, ageConfirmed: false })
      .expect(400);
    await request(http)
      .post('/experience/register')
      .send({ ...REGISTRO, eventZone: true })
      .expect(400);
    expect(prisma.tx.signalSignup.create).not.toHaveBeenCalled();
  });

  it('POST /experience/register corta a partir del sexto intento en un minuto', async () => {
    for (let i = 0; i < 5; i += 1) {
      await request(http)
        .post('/experience/register')
        .send({ ...REGISTRO, email: `p${i}@ejemplo.com` })
        .expect(201);
    }
    await request(http).post('/experience/register').send(REGISTRO).expect(429);
  });

  // ── Sesión ─────────────────────────────────────────────────────────

  it('lo que guarda algo de alguien pide sesión válida', async () => {
    await request(http).get('/experience/progress').expect(401);
    await request(http)
      .get('/experience/progress')
      .set('Authorization', 'Bearer corto')
      .expect(401);
    prisma.experienceSession.findUnique.mockResolvedValueOnce(null);
    await conSesion(request(http).get('/experience/progress')).expect(401);
    await request(http)
      .post('/experience/letters')
      .send({ to: 'Ana', text: 'hola' })
      .expect(401);
  });

  // ── Cartas ─────────────────────────────────────────────────────────

  it('POST /experience/letters guarda la carta como texto, sin nada de quien la escribe', async () => {
    const res = await conSesion(
      request(http)
        .post('/experience/letters')
        .send({ to: 'Ana', text: '<b>Te</b> extraño.', locale: 'es' }),
    ).expect(201);
    expect(res.body).toEqual({ id: CARTA_ID });
    expect(
      argDe<{ data: Record<string, unknown> }>(prisma.experienceLetter.create)
        .data,
    ).toEqual({
      toName: 'Ana',
      text: 'Te extraño.',
      locale: 'es',
    });
  });

  it('POST /experience/letters: hacerse daño → 422 y no se guarda', async () => {
    await conSesion(
      request(http)
        .post('/experience/letters')
        .send({ to: 'Ana', text: 'Ya no quiero vivir.' }),
    ).expect(422);
    expect(prisma.experienceLetter.create).not.toHaveBeenCalled();
  });

  it('POST /experience/letters: un nombre con apellido no pasa', async () => {
    await conSesion(
      request(http)
        .post('/experience/letters')
        .send({ to: 'Ana María López', text: 'Hola.' }),
    ).expect(400);
  });

  it('GET /experience/letters es público y cacheable', async () => {
    prisma.experienceLetter.findMany.mockResolvedValue([
      { id: CARTA_ID, toName: 'Luis', text: 'hola' },
    ]);
    const res = await request(http).get('/experience/letters').expect(200);
    expect(res.body).toEqual({
      data: [{ id: CARTA_ID, to: 'Luis', text: 'hola' }],
    });
    expect(res.headers['cache-control']).toContain('public');
  });

  it('POST /experience/letters/status solo acepta ids válidos', async () => {
    await request(http)
      .post('/experience/letters/status')
      .send({ ids: ['no-es-uuid'] })
      .expect(400);
    await request(http)
      .post('/experience/letters/status')
      .send({ ids: [CARTA_ID] })
      .expect(200);
  });

  // ── Progreso ───────────────────────────────────────────────────────

  it('POST /experience/progress/run suma, valida y abre canciones', async () => {
    prisma.tx.experienceProgress.findUniqueOrThrow.mockResolvedValue({
      ...VACIO,
      recorridos: 900,
      record: 900,
    });
    const res = await conSesion(
      request(http)
        .post('/experience/progress/run')
        .send({ recorridos: 100, metros: 1000, paginas: ['p01', 'p99'] }),
    ).expect(200);
    expect(res.body).toMatchObject({
      recorridos: 1000,
      record: 1000,
      paginas: ['p01'],
    });
    expect((res.body as { abiertas: string[] }).abiertas).toContain('pista-2');
  });

  it('POST /experience/progress/run rechaza lo imposible', async () => {
    await conSesion(
      request(http)
        .post('/experience/progress/run')
        .send({ recorridos: 999_999 }),
    ).expect(400);
    await conSesion(
      request(http).post('/experience/progress/run').send({ estrellas: -1 }),
    ).expect(400);
  });

  it('POST /experience/progress/path y /memory', async () => {
    await conSesion(
      request(http).post('/experience/progress/path').send({ capitulos: 9 }),
    ).expect(400);
    await conSesion(
      request(http).post('/experience/progress/path').send({ capitulos: 3 }),
    ).expect(200);
    await conSesion(
      request(http)
        .post('/experience/progress/memory')
        .send({ recuerdo: 'dragon' }),
    ).expect(400);
    const res = await conSesion(
      request(http)
        .post('/experience/progress/memory')
        .send({ recuerdo: 'flor' }),
    ).expect(200);
    expect((res.body as { recuerdos: string[] }).recuerdos).toEqual(['flor']);
  });

  // ── Panel ──────────────────────────────────────────────────────────

  it('la moderación de cartas es solo para el equipo', async () => {
    await request(http).get('/admin/experience/letters').expect(401);

    const login = await request(http)
      .post('/auth/login')
      .send({ email: ADMIN_EMAIL, password: PASSWORD })
      .expect(201);
    const jwt = (login.body as { accessToken: string }).accessToken;

    await request(http)
      .get('/admin/experience/letters?status=pending')
      .set('Authorization', `Bearer ${jwt}`)
      .expect(200);
    await request(http)
      .patch(`/admin/experience/letters/${CARTA_ID}`)
      .set('Authorization', `Bearer ${jwt}`)
      .send({ status: 'rejected' })
      .expect(200);
    expect(
      argDe<{ data: Record<string, unknown> }>(prisma.experienceLetter.update)
        .data,
    ).toMatchObject({
      status: 'REJECTED',
      text: '',
    });
    await request(http)
      .patch(`/admin/experience/letters/${CARTA_ID}`)
      .set('Authorization', `Bearer ${jwt}`)
      .send({ status: 'publicada' })
      .expect(400);
  });
});
