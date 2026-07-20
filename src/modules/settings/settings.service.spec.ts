import { BadRequestException } from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';
import { SETTING_KEYS, SettingsService } from './settings.service';

describe('SettingsService', () => {
  let service: SettingsService;
  let prisma: {
    appSetting: {
      findMany: jest.Mock;
      upsert: jest.Mock;
      deleteMany: jest.Mock;
    };
    $transaction: jest.Mock;
  };

  beforeEach(() => {
    prisma = {
      appSetting: {
        findMany: jest.fn().mockResolvedValue([]),
        upsert: jest.fn((args: unknown) => args),
        deleteMany: jest.fn((args: unknown) => args),
      },
      $transaction: jest.fn().mockResolvedValue([]),
    };

    service = new SettingsService(prisma as unknown as PrismaService);
  });

  it('devuelve null para claves sin configurar', async () => {
    await expect(service.getSettings()).resolves.toEqual({
      countdownTarget: null,
      albumUrl: null,
    });
  });

  it('mapea las claves almacenadas', async () => {
    prisma.appSetting.findMany.mockResolvedValue([
      { key: SETTING_KEYS.countdownTarget, value: '2026-12-01T00:00:00' },
      { key: SETTING_KEYS.albumUrl, value: 'https://spotify.com/album' },
    ]);

    await expect(service.getSettings()).resolves.toEqual({
      countdownTarget: '2026-12-01T00:00:00',
      albumUrl: 'https://spotify.com/album',
    });
  });

  it('rechaza fechas invalidas', async () => {
    await expect(
      service.updateSettings({ countdownTarget: 'no-es-fecha' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rechaza URLs invalidas o no http(s)', async () => {
    await expect(
      service.updateSettings({ albumUrl: 'no-es-url' }),
    ).rejects.toBeInstanceOf(BadRequestException);

    await expect(
      service.updateSettings({ albumUrl: 'javascript:alert(1)' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('upsertea valores validos', async () => {
    await service.updateSettings({
      countdownTarget: '2026-12-01T00:00:00',
      albumUrl: 'https://open.spotify.com/album/x',
    });

    expect(prisma.appSetting.upsert).toHaveBeenCalledTimes(2);
    expect(prisma.appSetting.deleteMany).not.toHaveBeenCalled();
  });

  it('cadena vacia borra la clave; undefined no la toca', async () => {
    await service.updateSettings({ countdownTarget: '' });

    expect(prisma.appSetting.deleteMany).toHaveBeenCalledWith({
      where: { key: SETTING_KEYS.countdownTarget },
    });
    expect(prisma.appSetting.upsert).not.toHaveBeenCalled();
  });
});
