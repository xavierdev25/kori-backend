import { ConfigService } from '@nestjs/config';

import { PrismaService } from '../prisma/prisma.service';
import { RegisterExperienceDto } from './dto/register.dto';
import { ExperienceService } from './experience.service';
import { argDe } from '../../../test/helpers/mock-args';

const PEPPER = 'p'.repeat(40);
const DTO: RegisterExperienceDto = {
  email: 'ana@correo.com',
  country: 'MX',
  region: 'Jalisco',
  city: 'Zapopan',
  locale: 'es',
  ageConfirmed: true,
  privacyVersion: '2026-11-21',
};

function crear(existente: Record<string, unknown> | null) {
  const tx = {
    signalSignup: {
      findUnique: jest.fn().mockResolvedValue(existente),
      findUniqueOrThrow: jest.fn(),
      create: jest.fn().mockResolvedValue({ id: 'nuevo' }),
      update: jest.fn().mockResolvedValue({}),
    },
    experienceSession: { create: jest.fn().mockResolvedValue({}) },
  };
  const prisma = {
    $transaction: jest.fn((fn: (t: typeof tx) => unknown) => fn(tx)),
    experienceSession: {
      findUnique: jest.fn(),
      update: jest.fn().mockResolvedValue({}),
    },
  };
  const config = { getOrThrow: () => PEPPER } as unknown as ConfigService;
  const servicio = new ExperienceService(
    prisma as unknown as PrismaService,
    config,
  );
  return { servicio, tx, prisma };
}

describe('ExperienceService.register', () => {
  it('crea el registro y una sesión; del token solo se guarda la huella', async () => {
    const { servicio, tx } = crear(null);
    const r = await servicio.register(DTO, '1.2.3.4');

    expect(r.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(r.eventZone).toBe(true);
    const datos = argDe<{ data: Record<string, unknown> }>(
      tx.signalSignup.create,
    ).data;
    expect(datos).toMatchObject({
      email: DTO.email,
      source: 'experiencia',
      country: 'MX',
      ageConfirmed: true,
      eventZone: true,
    });
    expect(datos.ipHash).not.toContain('1.2.3.4');
    const sesion = argDe<{ data: Record<string, unknown> }>(
      tx.experienceSession.create,
    ).data;
    expect(sesion.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(sesion.tokenHash).not.toContain(r.token);
  });

  it('un correo de "la señal" sin ubicación: la completa', async () => {
    const { servicio, tx } = crear({
      id: 'senal-1',
      country: null,
      region: null,
      city: null,
    });
    await servicio.register(DTO);
    expect(tx.signalSignup.create).not.toHaveBeenCalled();
    expect(tx.signalSignup.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'senal-1' } }),
    );
  });

  it('un correo que ya tiene ubicación no se reescribe (nadie cambia los datos de otro)', async () => {
    const { servicio, tx } = crear({
      id: 'ya',
      country: 'MX',
      region: 'CDMX',
      city: 'Coyoacán',
    });
    const r = await servicio.register(DTO);
    expect(tx.signalSignup.update).not.toHaveBeenCalled();
    expect(tx.experienceSession.create).toHaveBeenCalled();
    // la respuesta es la de lo que se mandó: no revela lo guardado
    expect(r.eventZone).toBe(true);
  });
});

describe('ExperienceService.sesion', () => {
  it('busca por la huella y devuelve de quién es', async () => {
    const { servicio, prisma } = crear(null);
    prisma.experienceSession.findUnique.mockResolvedValue({
      id: 's1',
      signupId: 'yo',
      lastSeenAt: new Date(),
    });
    await expect(servicio.sesion('x'.repeat(43))).resolves.toBe('yo');
    const where = argDe<{ where: Record<string, unknown> }>(
      prisma.experienceSession.findUnique,
    ).where;
    expect(where.tokenHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('una sesión que no existe es null', async () => {
    const { servicio, prisma } = crear(null);
    prisma.experienceSession.findUnique.mockResolvedValue(null);
    await expect(servicio.sesion('x'.repeat(43))).resolves.toBeNull();
  });
});
