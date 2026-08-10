import { GoneException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { DigitalDeliveryService } from './digital-delivery.service';
import { OrderEmailsService } from '../notifications/order-emails.service';
import { PrismaService } from '../prisma/prisma.service';
import { PurchasesService } from './purchases.service';

describe('PurchasesService', () => {
  let prisma: {
    order: { findFirst: jest.Mock; findMany: jest.Mock };
    purchaseAccessToken: {
      create: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
    };
  };
  let emails: {
    sendDownloadLinks: jest.Mock;
    sendPurchaseAccessLink: jest.Mock;
  };
  let delivery: { emitirEnlaces: jest.Mock };
  let service: PurchasesService;

  const enUnaHora = () => new Date(Date.now() + 3_600_000);
  const haceUnaHora = () => new Date(Date.now() - 3_600_000);

  const acceso = (overrides: Record<string, unknown> = {}) => ({
    email: 'ana@ejemplo.mx',
    expiresAt: enUnaHora(),
    id: 'a1',
    usedAt: null,
    ...overrides,
  });

  beforeEach(() => {
    prisma = {
      order: {
        findFirst: jest.fn().mockResolvedValue({ locale: 'es' }),
        findMany: jest.fn().mockResolvedValue([]),
      },
      purchaseAccessToken: {
        create: jest.fn().mockResolvedValue({}),
        findUnique: jest.fn().mockResolvedValue(acceso()),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    emails = {
      sendDownloadLinks: jest.fn().mockResolvedValue(undefined),
      sendPurchaseAccessLink: jest.fn().mockResolvedValue(undefined),
    };
    delivery = {
      emitirEnlaces: jest
        .fn()
        .mockResolvedValue([{ nombre: 'DICIEMBRE', url: 'https://x/d/1' }]),
    };

    service = new PurchasesService(
      {
        get: () => 'https://insecurekori.com',
      } as unknown as ConfigService,
      delivery as unknown as DigitalDeliveryService,
      emails as unknown as OrderEmailsService,
      prisma as unknown as PrismaService,
    );
  });

  describe('pedir acceso', () => {
    it('un correo con compras recibe su enlace', async () => {
      await service.requestAccess('ana@ejemplo.mx');

      expect(emails.sendPurchaseAccessLink).toHaveBeenCalled();
    });

    it('un correo SIN compras no recibe nada, y tampoco revienta', async () => {
      prisma.order.findFirst.mockResolvedValue(null);

      await expect(
        service.requestAccess('desconocido@ejemplo.mx'),
      ).resolves.toBeUndefined();

      // Si respondiera distinto, cualquiera podría averiguar quién le ha
      // comprado a Kori probando direcciones.
      expect(emails.sendPurchaseAccessLink).not.toHaveBeenCalled();
      expect(prisma.purchaseAccessToken.create).not.toHaveBeenCalled();
    });

    it('el correo se normaliza antes de buscar', async () => {
      await service.requestAccess('  ANA@Ejemplo.MX  ');

      const { where } = (
        prisma.order.findFirst.mock.calls as unknown[][]
      )[0][0] as {
        where: { customerEmail: string };
      };

      expect(where.customerEmail).toBe('ana@ejemplo.mx');
    });

    it('el token se guarda hasheado, nunca en claro', async () => {
      await service.requestAccess('ana@ejemplo.mx');

      const { data } = (
        prisma.purchaseAccessToken.create.mock.calls as unknown[][]
      )[0][0] as { data: { tokenHash: string } };
      const [, url] = (
        emails.sendPurchaseAccessLink.mock.calls as unknown[][]
      )[0] as [string, string];

      const tokenEnClaro = url.split('/').pop()!;
      expect(data.tokenHash).not.toBe(tokenEnClaro);
      expect(data.tokenHash).toBe(PurchasesService.hashToken(tokenEnClaro));
    });
  });

  describe('ver las compras', () => {
    it('un enlace caducado responde 410', async () => {
      prisma.purchaseAccessToken.findUnique.mockResolvedValue(
        acceso({ expiresAt: haceUnaHora() }),
      );

      await expect(service.findByToken('t')).rejects.toThrow(GoneException);
    });

    it('un token inexistente responde 410, sin decir por qué', async () => {
      prisma.purchaseAccessToken.findUnique.mockResolvedValue(null);

      await expect(service.findByToken('t')).rejects.toThrow(GoneException);
    });

    it('nunca devuelve la ruta del archivo, solo si es descargable', async () => {
      prisma.order.findMany.mockResolvedValue([
        {
          createdAt: new Date(),
          currency: 'USD',
          items: [
            {
              digitalAssetPath: 'variants/v1/secreto.zip',
              id: 'i1',
              productName: 'DICIEMBRE',
              quantity: 1,
              variantLabel: 'Descarga',
            },
          ],
          orderNumber: 7,
          status: 'PAID',
          totalCents: 5000,
        },
      ]);

      const resultado = await service.findByToken('t');
      const serializado = JSON.stringify(resultado);

      expect(serializado).not.toContain('secreto.zip');
      expect(serializado).not.toContain('digitalAssetPath');
      expect(resultado.orders[0].items[0].isDownloadable).toBe(true);
    });

    it('recargar la página no invalida el enlace', async () => {
      prisma.purchaseAccessToken.findUnique.mockResolvedValue(
        acceso({ usedAt: new Date() }),
      );

      await expect(service.findByToken('t')).resolves.toBeDefined();
    });
  });

  describe('reenviar descargas', () => {
    it('reemite y manda los enlaces al correo del pedido', async () => {
      prisma.order.findFirst.mockResolvedValue({ id: 'o1', items: [] });

      await service.resendDownloads('t', 7);

      expect(delivery.emitirEnlaces).toHaveBeenCalled();
      expect(emails.sendDownloadLinks).toHaveBeenCalled();
    });

    it('el pedido tiene que ser del mismo correo que el token', async () => {
      prisma.order.findFirst.mockResolvedValue({ id: 'o1', items: [] });

      await service.resendDownloads('t', 7);

      const { where } = (
        prisma.order.findFirst.mock.calls as unknown[][]
      )[0][0] as {
        where: { customerEmail: string; orderNumber: number };
      };

      // Sin esta condición, un enlace válido serviría para sacar los
      // archivos de cualquier pedido probando números.
      expect(where.customerEmail).toBe('ana@ejemplo.mx');
      expect(where.orderNumber).toBe(7);
    });

    it('un pedido ajeno responde 410 sin mandar nada', async () => {
      prisma.order.findFirst.mockResolvedValue(null);

      await expect(service.resendDownloads('t', 999)).rejects.toThrow(
        GoneException,
      );
      expect(emails.sendDownloadLinks).not.toHaveBeenCalled();
    });

    it('un pedido sin archivos no manda un correo vacío', async () => {
      prisma.order.findFirst.mockResolvedValue({ id: 'o1', items: [] });
      delivery.emitirEnlaces.mockResolvedValue([]);

      await expect(service.resendDownloads('t', 7)).rejects.toThrow(
        GoneException,
      );
      expect(emails.sendDownloadLinks).not.toHaveBeenCalled();
    });
  });
});
