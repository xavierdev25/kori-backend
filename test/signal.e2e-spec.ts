import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import request from 'supertest';
import type { App } from 'supertest/types';

import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/modules/prisma/prisma.service';
import { StorageService } from '../src/modules/storage/storage.service';
import { argDe } from './helpers/mock-args';

/**
 * "La señal": el registro público de la portada y su lado del panel.
 *
 * Va en su propio archivo y con su propio mock, en vez de engordar el de
 * `app.e2e-spec.ts`: lo que se prueba aquí es la aplicación entera —pipe
 * global de validación, limitador, CORS, guardia JWT— delante de una tabla
 * nueva, y el mock solo necesita lo que esa ruta toca.
 *
 * CORS no se prueba aquí: lo monta `main.ts` al arrancar, no el módulo, y es
 * global —la misma lista de orígenes para todas las rutas—, con su propia
 * prueba en `cors-origins.spec.ts`.
 */

const ADMIN_EMAIL = 'kori@ejemplo.mx';
const PASSWORD = 'admin-password-for-test';

const VALIDO = {
  name: 'Ana',
  email: 'Ana@Correo.com',
  locale: 'es',
  marketingOptIn: true,
  consent: true,
  privacyVersion: '2026-10-12',
};

type Mock = jest.Mock;

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

  return {
    $connect: jest.fn().mockResolvedValue(undefined),
    $disconnect: jest.fn().mockResolvedValue(undefined),
    $queryRaw: jest.fn().mockResolvedValue([{ '?column?': 1 }]),
    $transaction: jest
      .fn()
      .mockImplementation((ops: Promise<unknown>[]) => Promise.all(ops)),
    signalSignup: {
      create: jest.fn().mockResolvedValue({ id: 'signup-1' }),
      count: jest.fn().mockResolvedValue(1),
      findMany: jest.fn().mockResolvedValue([
        {
          id: '00000000-0000-4000-8000-000000000010',
          name: 'Ana',
          email: 'ana@correo.com',
          locale: 'es',
          marketingOptIn: true,
          privacyVersion: '2026-10-12',
          createdAt: new Date('2026-10-12T00:00:00.000Z'),
        },
      ]),
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

describe('La señal (e2e)', () => {
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

  async function token(): Promise<string> {
    const res = await request(http)
      .post('/auth/login')
      .send({ email: ADMIN_EMAIL, password: PASSWORD })
      .expect(201);
    return (res.body as { accessToken: string }).accessToken;
  }

  // ── Registro público ─────────────────────────────────────────────────────

  it('POST /signal apunta a alguien y responde 201 sin devolver sus datos', async () => {
    const res = await request(http).post('/signal').send(VALIDO).expect(201);

    expect(res.body).toEqual({ signedUp: true });

    const { data } = argDe<{ data: Record<string, unknown> }>(
      prisma.signalSignup.create as Mock,
    );
    expect(data).toMatchObject({
      name: 'Ana',
      email: 'ana@correo.com',
      marketingOptIn: true,
      privacyVersion: '2026-10-12',
    });
  });

  it('POST /signal responde 409 si el correo ya estaba', async () => {
    (prisma.signalSignup.create as Mock).mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('duplicado', {
        code: 'P2002',
        clientVersion: 'test',
      }),
    );

    const res = await request(http).post('/signal').send(VALIDO).expect(409);
    expect((res.body as { success: boolean }).success).toBe(false);
  });

  it('POST /signal sin consentimiento no guarda nada', async () => {
    await request(http)
      .post('/signal')
      .send({ ...VALIDO, consent: false })
      .expect(400);

    expect(prisma.signalSignup.create).not.toHaveBeenCalled();
  });

  it('POST /signal rechaza campos de más (p. ej. la trampa para robots)', async () => {
    await request(http)
      .post('/signal')
      .send({ ...VALIDO, web: 'http://spam.example' })
      .expect(400);

    expect(prisma.signalSignup.create).not.toHaveBeenCalled();
  });

  it('POST /signal limpia el HTML del nombre antes de guardarlo', async () => {
    await request(http)
      .post('/signal')
      .send({ ...VALIDO, name: '<img src=x onerror=alert(1)>Ana' })
      .expect(201);

    const { data } = argDe<{ data: { name: string } }>(
      prisma.signalSignup.create as Mock,
    );
    expect(data.name).toBe('Ana');
  });

  it('POST /signal corta a partir del sexto intento en un minuto', async () => {
    for (let i = 0; i < 5; i += 1) {
      await request(http)
        .post('/signal')
        .send({ ...VALIDO, email: `ana${i}@correo.com` })
        .expect(201);
    }

    await request(http).post('/signal').send(VALIDO).expect(429);
  });

  // ── Panel ────────────────────────────────────────────────────────────────

  it('GET /admin/signal sin sesión responde 401', async () => {
    await request(http).get('/admin/signal').expect(401);
  });

  it('GET /admin/signal lista los registros sin la huella de la IP', async () => {
    const res = await request(http)
      .get('/admin/signal')
      .set('Authorization', `Bearer ${await token()}`)
      .expect(200);

    expect(res.headers['cache-control']).toBe('no-store');
    const body = res.body as {
      data: Record<string, unknown>[];
      meta: Record<string, number>;
    };
    expect(body.data[0]).toMatchObject({
      name: 'Ana',
      email: 'ana@correo.com',
    });
    expect(body.data[0]).not.toHaveProperty('ipHash');
    expect(body.meta).toMatchObject({ total: 1, marketingOptIn: 1 });
  });

  it('DELETE /admin/signal/:id borra el registro (baja o cancelación)', async () => {
    const id = '00000000-0000-4000-8000-000000000010';

    await request(http)
      .delete(`/admin/signal/${id}`)
      .set('Authorization', `Bearer ${await token()}`)
      .expect(200, { deleted: true, id });

    expect(prisma.signalSignup.delete).toHaveBeenCalledWith({ where: { id } });
  });

  it('DELETE /admin/signal/:id sin sesión no borra nada', async () => {
    await request(http)
      .delete('/admin/signal/00000000-0000-4000-8000-000000000010')
      .expect(401);

    expect(prisma.signalSignup.delete).not.toHaveBeenCalled();
  });
});
