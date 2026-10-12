import { ConflictException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { argDe } from '../../../test/helpers/mock-args';
import { PrismaService } from '../prisma/prisma.service';
import { CreateSignalSignupDto } from './dto/create-signal-signup.dto';
import { SignalService } from './signal.service';

const VALIDO = {
  name: 'Ana',
  email: 'ana@correo.com',
  locale: 'es',
  marketingOptIn: false,
  consent: true,
  privacyVersion: '2026-10-12',
};

/** Lo que haría el ValidationPipe global: transformar y validar. */
async function validar(cuerpo: Record<string, unknown>) {
  const dto = plainToInstance(CreateSignalSignupDto, cuerpo);
  const errores = await validate(dto, {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  return { dto, campos: errores.map((e) => e.property) };
}

describe('CreateSignalSignupDto', () => {
  it('acepta un envío completo', async () => {
    await expect(validar(VALIDO)).resolves.toMatchObject({ campos: [] });
  });

  it('normaliza el correo y limpia el nombre antes de validar', async () => {
    const { dto, campos } = await validar({
      ...VALIDO,
      name: '  <b>Ana</b>   María ',
      email: '  Ana@Correo.COM ',
    });

    expect(campos).toEqual([]);
    expect(dto.name).toBe('Ana María');
    expect(dto.email).toBe('ana@correo.com');
  });

  it('rechaza un nombre sin letras o que solo era marcado', async () => {
    for (const name of ['123', '...', '<script></script>', '   ']) {
      const { campos } = await validar({ ...VALIDO, name });
      expect(campos).toContain('name');
    }
  });

  it('acepta nombres con acentos y letras de otros alfabetos', async () => {
    for (const name of ['Ñoño', 'José Ángel', 'Zoë', 'Łukasz']) {
      await expect(validar({ ...VALIDO, name })).resolves.toMatchObject({
        campos: [],
      });
    }
  });

  it('rechaza un nombre de más de 60 caracteres', async () => {
    const { campos } = await validar({ ...VALIDO, name: 'a'.repeat(61) });
    expect(campos).toContain('name');
  });

  it('sin el consentimiento obligatorio no hay registro', async () => {
    for (const consent of [false, 'true', undefined]) {
      const { campos } = await validar({ ...VALIDO, consent });
      expect(campos).toContain('consent');
    }
  });

  it('exige la versión del aviso en formato AAAA-MM-DD', async () => {
    const { campos } = await validar({ ...VALIDO, privacyVersion: 'ayer' });
    expect(campos).toContain('privacyVersion');
  });

  it('solo admite los idiomas del sitio', async () => {
    const { campos } = await validar({ ...VALIDO, locale: 'fr' });
    expect(campos).toContain('locale');
  });

  it('rechaza campos que no existen', async () => {
    const { campos } = await validar({ ...VALIDO, isAdmin: true });
    expect(campos).toContain('isAdmin');
  });
});

describe('SignalService', () => {
  let service: SignalService;
  let prisma: {
    signalSignup: {
      create: jest.Mock;
      count: jest.Mock;
      findMany: jest.Mock;
      delete: jest.Mock;
    };
    $transaction: jest.Mock;
  };

  beforeEach(() => {
    prisma = {
      signalSignup: {
        create: jest.fn().mockResolvedValue({ id: 'abc' }),
        count: jest.fn(),
        findMany: jest.fn(),
        delete: jest.fn(),
      },
      $transaction: jest.fn(),
    };

    const config = {
      get: jest
        .fn()
        .mockReturnValue('un-pepper-de-pruebas-suficientemente-largo'),
    };

    service = new SignalService(
      prisma as unknown as PrismaService,
      config as unknown as ConfigService,
    );
  });

  it('guarda el registro sin devolver los datos de vuelta', async () => {
    const dto = plainToInstance(CreateSignalSignupDto, {
      ...VALIDO,
      marketingOptIn: true,
      locale: 'en',
    });

    await expect(service.signUp(dto, '1.2.3.4')).resolves.toEqual({
      signedUp: true,
    });

    const { data } = argDe<{ data: Record<string, unknown> }>(
      prisma.signalSignup.create,
    );
    expect(data).toMatchObject({
      name: 'Ana',
      email: 'ana@correo.com',
      locale: 'en',
      marketingOptIn: true,
      privacyVersion: '2026-10-12',
    });
    // la IP nunca se guarda en claro
    expect(data.ipHash).not.toContain('1.2.3.4');
    expect(data.ipHash).toHaveLength(64);
    // el consentimiento obligatorio no es una columna: la fila es la prueba
    expect(data).not.toHaveProperty('consent');
  });

  it('sin idioma ni novedades usa los valores por defecto', async () => {
    const dto = plainToInstance(CreateSignalSignupDto, {
      name: 'Ana',
      email: 'ana@correo.com',
      consent: true,
      privacyVersion: '2026-10-12',
    });

    await service.signUp(dto);

    const { data } = argDe<{ data: Record<string, unknown> }>(
      prisma.signalSignup.create,
    );
    expect(data).toMatchObject({
      locale: 'es',
      marketingOptIn: false,
      ipHash: null,
    });
  });

  it('responde 409 si el correo ya está y no toca lo guardado', async () => {
    prisma.signalSignup.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('duplicado', {
        code: 'P2002',
        clientVersion: 'test',
      }),
    );

    await expect(
      service.signUp(plainToInstance(CreateSignalSignupDto, VALIDO)),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('pagina el listado y cuenta los que aceptaron novedades', async () => {
    const rows = [{ id: '1', name: 'Ana', email: 'a@b.c' }];
    prisma.$transaction.mockResolvedValue([41, 7, rows]);

    await expect(service.findAll(2, 20)).resolves.toEqual({
      data: rows,
      meta: {
        page: 2,
        limit: 20,
        total: 41,
        totalPages: 3,
        marketingOptIn: 7,
      },
    });
  });

  it('nunca pide la huella de la IP para el panel', async () => {
    prisma.$transaction.mockResolvedValue([0, 0, []]);
    await service.findAll(1, 20);

    const args = argDe<{ select: Record<string, boolean> }>(
      prisma.signalSignup.findMany,
    );
    expect(args.select).not.toHaveProperty('ipHash');
  });

  it('acota la página y el tamaño a valores razonables', async () => {
    prisma.$transaction.mockResolvedValue([0, 0, []]);

    const { meta } = await service.findAll(-3, 5_000);

    expect(meta.page).toBe(1);
    expect(meta.limit).toBe(100);
  });

  it('borrar algo que ya no existe no es un error', async () => {
    prisma.signalSignup.delete.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('no existe', {
        code: 'P2025',
        clientVersion: 'test',
      }),
    );

    await expect(service.remove('x')).resolves.toEqual({
      deleted: true,
      id: 'x',
    });
  });
});
