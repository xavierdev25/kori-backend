import { ConflictException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { SubscribersService } from './subscribers.service';

describe('SubscribersService', () => {
  let service: SubscribersService;
  let prisma: {
    subscriber: {
      create: jest.Mock;
      count: jest.Mock;
      findMany: jest.Mock;
      delete: jest.Mock;
    };
    $transaction: jest.Mock;
  };

  beforeEach(() => {
    prisma = {
      subscriber: {
        create: jest.fn(),
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

    service = new SubscribersService(
      prisma as unknown as PrismaService,
      config as unknown as ConfigService,
    );
  });

  it('registra un correo y confirma la suscripcion', async () => {
    prisma.subscriber.create.mockResolvedValue({
      id: 'abc',
      email: 'fan@kori.mx',
      createdAt: new Date(),
    });

    await expect(service.subscribe('fan@kori.mx', '1.2.3.4')).resolves.toEqual({
      subscribed: true,
      email: 'fan@kori.mx',
    });

    const calls = prisma.subscriber.create.mock.calls as [
      [{ data: { email: string; ipHash: string } }],
    ];
    const args = calls[0][0];
    expect(args.data.email).toBe('fan@kori.mx');
    // la IP nunca se guarda en claro
    expect(args.data.ipHash).not.toContain('1.2.3.4');
    expect(args.data.ipHash).toHaveLength(64);
  });

  it('responde 409 cuando el correo ya existe', async () => {
    prisma.subscriber.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('duplicado', {
        code: 'P2002',
        clientVersion: 'test',
      }),
    );

    await expect(service.subscribe('fan@kori.mx')).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('pagina el listado y calcula totalPages', async () => {
    const rows = [{ id: '1', email: 'a@b.c', createdAt: new Date() }];
    prisma.$transaction.mockResolvedValue([41, rows]);

    const result = await service.findAll(2, 20);

    expect(result.data).toEqual(rows);
    expect(result.meta).toEqual({
      page: 2,
      limit: 20,
      total: 41,
      totalPages: 3,
    });
  });

  it('acota page y limit a valores sanos', async () => {
    prisma.$transaction.mockResolvedValue([0, []]);

    const result = await service.findAll(-5, 9999);

    expect(result.meta.page).toBe(1);
    expect(result.meta.limit).toBe(100);
  });

  it('borrar es idempotente si el correo ya no existe', async () => {
    prisma.subscriber.delete.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('no existe', {
        code: 'P2025',
        clientVersion: 'test',
      }),
    );

    await expect(service.remove('algun-id')).resolves.toEqual({
      deleted: true,
      id: 'algun-id',
    });
  });
});
