import { GoneException, NotFoundException } from '@nestjs/common';

import { DigitalAssetsService } from '../storage/digital-assets.service';
import { DigitalDeliveryService } from './digital-delivery.service';
import { DownloadsController } from './downloads.controller';
import { PrismaService } from '../prisma/prisma.service';

describe('DownloadsController', () => {
  let prisma: {
    downloadGrant: { findUnique: jest.Mock; updateMany: jest.Mock };
  };
  let digitalAssets: { getSignedUrl: jest.Mock };
  let controller: DownloadsController;

  /** `mock.calls` devuelve `any`; se acota aquí una vez. */
  function callArg<T>(mock: jest.Mock, argIndex = 0): T {
    return (mock.mock.calls as unknown[][])[0][argIndex] as T;
  }

  const enUnaHora = () => new Date(Date.now() + 60 * 60 * 1000);
  const haceUnaHora = () => new Date(Date.now() - 60 * 60 * 1000);

  const grant = (overrides: Record<string, unknown> = {}) => ({
    downloadCount: 0,
    expiresAt: enUnaHora(),
    id: 'g1',
    maxDownloads: 5,
    orderItem: {
      digitalAssetPath: 'variants/v1/abc.zip',
      productName: 'DICIEMBRE (drumkit)',
    },
    revokedAt: null,
    ...overrides,
  });

  beforeEach(() => {
    prisma = {
      downloadGrant: {
        findUnique: jest.fn().mockResolvedValue(grant()),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    digitalAssets = {
      getSignedUrl: jest.fn().mockResolvedValue('https://firmada/x.zip'),
    };

    controller = new DownloadsController(
      digitalAssets as unknown as DigitalAssetsService,
      prisma as unknown as PrismaService,
    );
  });

  it('un token válido redirige a la URL firmada', async () => {
    const result = await controller.download('token-bueno');

    expect(result).toEqual({ statusCode: 302, url: 'https://firmada/x.zip' });
  });

  it('el token nunca se busca en claro: se compara su hash', async () => {
    await controller.download('token-bueno');

    const { where } = callArg<{ where: { tokenHash: string } }>(
      prisma.downloadGrant.findUnique,
    );

    // Quien lea la base de datos no puede descargar nada de nadie.
    expect(where.tokenHash).not.toBe('token-bueno');
    expect(where.tokenHash).toBe(
      DigitalDeliveryService.hashToken('token-bueno'),
    );
  });

  it('un token inexistente responde 404, sin pistas', async () => {
    prisma.downloadGrant.findUnique.mockResolvedValue(null);

    await expect(controller.download('invento')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('un enlace caducado responde 410 y dice qué hacer', async () => {
    prisma.downloadGrant.findUnique.mockResolvedValue(
      grant({ expiresAt: haceUnaHora() }),
    );

    await expect(controller.download('token-viejo')).rejects.toThrow(
      GoneException,
    );
    expect(digitalAssets.getSignedUrl).not.toHaveBeenCalled();
  });

  it('agotadas las descargas ya no entrega el archivo', async () => {
    prisma.downloadGrant.findUnique.mockResolvedValue(
      grant({ downloadCount: 5, maxDownloads: 5 }),
    );

    await expect(controller.download('token-gastado')).rejects.toThrow(
      GoneException,
    );
    expect(digitalAssets.getSignedUrl).not.toHaveBeenCalled();
  });

  it('un permiso revocado se trata como inexistente', async () => {
    prisma.downloadGrant.findUnique.mockResolvedValue(
      grant({ revokedAt: new Date() }),
    );

    await expect(controller.download('token-revocado')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('el contador sube antes de entregar la URL', async () => {
    await controller.download('token-bueno');

    const orden = [
      prisma.downloadGrant.updateMany.mock.invocationCallOrder[0],
      digitalAssets.getSignedUrl.mock.invocationCallOrder[0],
    ];

    // Si se entregara primero y fallara el contador, el enlace sería infinito.
    expect(orden[0]).toBeLessThan(orden[1]);
  });

  it('dos pestañas a la vez no se cuelan por la última descarga', async () => {
    // El update lleva la condición sobre el propio contador: si no afecta
    // ninguna fila es que otra petición se llevó el hueco.
    prisma.downloadGrant.updateMany.mockResolvedValue({ count: 0 });

    await expect(controller.download('token-bueno')).rejects.toThrow(
      GoneException,
    );
    expect(digitalAssets.getSignedUrl).not.toHaveBeenCalled();
  });

  it('el incremento va condicionado al tope, no a ciegas', async () => {
    await controller.download('token-bueno');

    const { where } = callArg<{
      where: { downloadCount: { lt: number }; id: string };
    }>(prisma.downloadGrant.updateMany);

    expect(where.id).toBe('g1');
    expect(where.downloadCount).toEqual({ lt: 5 });
  });

  it('si el archivo ya no está, no se inventa una URL', async () => {
    prisma.downloadGrant.findUnique.mockResolvedValue(
      grant({ orderItem: { digitalAssetPath: null, productName: 'X' } }),
    );

    await expect(controller.download('token-bueno')).rejects.toThrow(
      NotFoundException,
    );
  });
});
