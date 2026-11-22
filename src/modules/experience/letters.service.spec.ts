import {
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { LettersService } from './letters.service';
import { argDe } from '../../../test/helpers/mock-args';

function crear() {
  const prisma = {
    experienceLetter: {
      create: jest.fn().mockResolvedValue({ id: 'c1' }),
      findUnique: jest.fn().mockResolvedValue({ id: 'c1' }),
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockResolvedValue({ id: 'c1' }),
      delete: jest.fn().mockResolvedValue({}),
      count: jest.fn().mockResolvedValue(0),
    },
    $transaction: jest.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
  };
  return {
    servicio: new LettersService(prisma as unknown as PrismaService),
    prisma,
  };
}

describe('LettersService', () => {
  it('guarda la carta sin nada de quien la escribe', async () => {
    const { servicio, prisma } = crear();
    await expect(
      servicio.create({ to: 'Ana', text: 'Te extraño.', locale: 'es' }),
    ).resolves.toEqual({ id: 'c1' });
    expect(
      argDe<{ data: Record<string, unknown> }>(prisma.experienceLetter.create)
        .data,
    ).toEqual({
      toName: 'Ana',
      text: 'Te extraño.',
      locale: 'es',
    });
  });

  it('una carta sobre hacerse daño no se guarda: 422', async () => {
    const { servicio, prisma } = crear();
    await expect(
      servicio.create({ to: 'Ana', text: 'Ya no quiero vivir.' }),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(prisma.experienceLetter.create).not.toHaveBeenCalled();
  });

  it('el archivo solo trae aprobadas y solo para, texto e id', async () => {
    const { servicio, prisma } = crear();
    prisma.experienceLetter.findMany.mockResolvedValue([
      { id: 'a', toName: 'Luis', text: 'hola' },
    ]);
    await expect(servicio.approved()).resolves.toEqual({
      data: [{ id: 'a', to: 'Luis', text: 'hola' }],
    });
    expect(
      argDe<{ where: Record<string, unknown> }>(
        prisma.experienceLetter.findMany,
      ).where,
    ).toEqual({
      status: 'APPROVED',
    });
  });

  it('rechazar borra el texto', async () => {
    const { servicio, prisma } = crear();
    await servicio.review('c1', 'rejected');
    expect(
      argDe<{ data: Record<string, unknown> }>(prisma.experienceLetter.update)
        .data,
    ).toMatchObject({
      status: 'REJECTED',
      text: '',
    });
  });

  it('revisar una que no existe: 404', async () => {
    const { servicio, prisma } = crear();
    prisma.experienceLetter.update.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('no', {
        code: 'P2025',
        clientVersion: 'x',
      }),
    );
    await expect(servicio.review('c9', 'approved')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('el estado sale en minúsculas', async () => {
    const { servicio, prisma } = crear();
    prisma.experienceLetter.findMany.mockResolvedValue([
      { id: 'c1', status: 'REJECTED' },
    ]);
    await expect(servicio.status(['c1'])).resolves.toEqual({
      data: [{ id: 'c1', status: 'rejected' }],
    });
  });

  it('la misma Idempotency-Key devuelve la carta que ya estaba (no duplica)', async () => {
    const { servicio, prisma } = crear();
    prisma.experienceLetter.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('duplicada', {
        code: 'P2002',
        clientVersion: 'x',
      }),
    );
    await expect(
      servicio.create({ to: 'Ana', text: 'hola' }, 'clave-1'),
    ).resolves.toEqual({ id: 'c1' });
    expect(prisma.experienceLetter.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { idempotencyKey: 'clave-1' } }),
    );
  });

  it('el archivo se guarda un momento y se tira al moderar', async () => {
    const { servicio, prisma } = crear();
    await servicio.approved();
    await servicio.approved();
    expect(prisma.experienceLetter.findMany).toHaveBeenCalledTimes(1);
    await servicio.review('c1', 'approved');
    await servicio.approved();
    expect(prisma.experienceLetter.findMany).toHaveBeenCalledTimes(2);
  });
});
