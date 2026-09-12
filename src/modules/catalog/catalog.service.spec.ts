import { ConflictException, NotFoundException } from '@nestjs/common';

import { DigitalAssetsService } from '../storage/digital-assets.service';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { CatalogService } from './catalog.service';

describe('CatalogService', () => {
  let prisma: {
    product: {
      findUnique: jest.Mock;
      findUniqueOrThrow: jest.Mock;
      update: jest.Mock;
      delete: jest.Mock;
    };
    productVariant: {
      findUnique: jest.Mock;
      update: jest.Mock;
      delete: jest.Mock;
    };
    orderItem: { count: jest.Mock };
    $transaction: jest.Mock;
  };
  let service: CatalogService;
  let storage: { deleteFile: jest.Mock };
  let digitalAssets: { remove: jest.Mock };

  beforeEach(() => {
    prisma = {
      product: {
        findUnique: jest.fn().mockResolvedValue({ id: 'p1' }),
        // Por defecto, un producto sin archivos: los tests de borrado que
        // sí los tienen se lo sobrescriben.
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          images: [],
          variants: [],
        }),
        update: jest.fn().mockResolvedValue({ id: 'p1' }),
        delete: jest.fn().mockResolvedValue({ id: 'p1' }),
      },
      productVariant: {
        findUnique: jest.fn().mockResolvedValue({ productId: 'p1' }),
        update: jest.fn().mockResolvedValue({ id: 'v1' }),
        delete: jest.fn().mockResolvedValue({}),
      },
      orderItem: { count: jest.fn().mockResolvedValue(0) },
      // Las mutaciones de variante van en transacción para poder revertir si
      // el resultado deja un producto publicado sin poder producirse.
      $transaction: jest.fn((fn: (tx: unknown) => unknown) => fn(prisma)),
    };

    storage = { deleteFile: jest.fn().mockResolvedValue(undefined) };
    digitalAssets = { remove: jest.fn().mockResolvedValue(undefined) };

    service = new CatalogService(
      digitalAssets as unknown as DigitalAssetsService,
      prisma as unknown as PrismaService,
      storage as unknown as StorageService,
    );
  });

  describe('un producto con ventas no se borra', () => {
    it('lanza 409 cuando ya se vendio', async () => {
      prisma.orderItem.count.mockResolvedValue(3);

      await expect(service.deleteProduct('p1')).rejects.toThrow(
        ConflictException,
      );
      expect(prisma.product.delete).not.toHaveBeenCalled();
    });

    it('el mensaje dice cuantas ventas y que hacer', async () => {
      prisma.orderItem.count.mockResolvedValue(3);

      await expect(service.deleteProduct('p1')).rejects.toThrow(
        /3 venta\(s\).*[Dd]espubl[ií]ca/s,
      );
    });

    it.each([
      ['producto', () => service.deleteProduct('p1')],
      ['variante', () => service.deleteVariant('p1', 'v1')],
    ])(
      'el aviso del %s no le enseña sintaxis de API a nadie',
      async (_caso, accion) => {
        // Este texto sale tal cual en un aviso del panel, que usa Guillermo.
        // Decia `Desactivalo con PATCH { "isActive": false }`: instrucciones
        // para un cliente HTTP delante de alguien que solo queria borrar algo.
        prisma.orderItem.count.mockResolvedValue(1);

        const error: unknown = await accion().catch((e: unknown) => e);
        const mensaje = error instanceof Error ? error.message : String(error);

        expect(mensaje).not.toMatch(/PATCH|POST|DELETE|isActive|[{}]/);
      },
    );

    it('sin ventas si se borra', async () => {
      await expect(service.deleteProduct('p1')).resolves.toEqual({
        deleted: true,
      });
      expect(prisma.product.delete).toHaveBeenCalled();
    });

    it('borrar el producto se lleva sus archivos de los dos buckets', async () => {
      prisma.product.findUniqueOrThrow.mockResolvedValue({
        images: [{ storagePath: 'products/p1/foto.webp' }],
        variants: [{ digitalAssetPath: 'privado/p1/kit.zip' }],
      });

      await service.deleteProduct('p1');

      expect(storage.deleteFile).toHaveBeenCalledWith('products/p1/foto.webp');
      expect(digitalAssets.remove).toHaveBeenCalledWith('privado/p1/kit.zip');
    });

    it('las rutas se leen antes de borrar, no despues', async () => {
      // Al borrar en cascada desaparecen las filas que guardan las rutas: si
      // se consultaran despues, no habria nada que limpiar y el archivo del
      // drumkit se quedaria en el bucket privado para siempre.
      const orden: string[] = [];

      prisma.product.findUniqueOrThrow.mockImplementation(() => {
        orden.push('leer');
        return Promise.resolve({
          images: [{ storagePath: 'products/p1/foto.webp' }],
          variants: [],
        });
      });
      prisma.product.delete.mockImplementation(() => {
        orden.push('borrar');
        return Promise.resolve({ id: 'p1' });
      });

      await service.deleteProduct('p1');

      expect(orden).toEqual(['leer', 'borrar']);
    });

    it('si el bucket falla, el borrado sigue siendo correcto', async () => {
      // La fila ya no existe: devolver error aqui le diria al panel que el
      // borrado fallo, y el reintento respondería 404.
      prisma.product.findUniqueOrThrow.mockResolvedValue({
        images: [{ storagePath: 'products/p1/foto.webp' }],
        variants: [],
      });
      storage.deleteFile.mockRejectedValue(new Error('S3 caido'));

      await expect(service.deleteProduct('p1')).resolves.toEqual({
        deleted: true,
      });
    });

    it('un producto con ventas no llega a tocar los buckets', async () => {
      prisma.orderItem.count.mockResolvedValue(2);

      await expect(service.deleteProduct('p1')).rejects.toThrow(
        ConflictException,
      );
      expect(storage.deleteFile).not.toHaveBeenCalled();
      expect(digitalAssets.remove).not.toHaveBeenCalled();
    });

    it('lo mismo aplica a una variante', async () => {
      prisma.orderItem.count.mockResolvedValue(1);

      await expect(service.deleteVariant('p1', 'v1')).rejects.toThrow(
        ConflictException,
      );
      expect(prisma.productVariant.delete).not.toHaveBeenCalled();
    });
  });

  describe('no se publica un producto que no se puede producir', () => {
    const buildProduct = (overrides: Record<string, unknown> = {}) => ({
      id: 'p1',
      fulfillmentType: 'POD',
      variants: [
        {
          label: 'M / Negro',
          providerProductUid: 'uid',
          printFileUrl: 'https://x/print.png',
        },
      ],
      _count: { images: 1 },
      ...overrides,
    });

    it('bloquea si una variante no tiene providerProductUid', async () => {
      prisma.product.findUniqueOrThrow.mockResolvedValue(
        buildProduct({
          variants: [
            {
              label: 'M / Negro',
              providerProductUid: null,
              printFileUrl: 'https://x/p.png',
            },
          ],
        }),
      );

      await expect(
        service.updateProduct('p1', { isActive: true }),
      ).rejects.toThrow(/M \/ Negro/);
      expect(prisma.product.update).not.toHaveBeenCalled();
    });

    it('bloquea si falta el archivo de impresion', async () => {
      prisma.product.findUniqueOrThrow.mockResolvedValue(
        buildProduct({
          variants: [
            {
              label: 'S / Negro',
              providerProductUid: 'uid',
              printFileUrl: null,
            },
          ],
        }),
      );

      await expect(
        service.updateProduct('p1', { isActive: true }),
      ).rejects.toThrow(ConflictException);
    });

    it('bloquea si no hay imagenes', async () => {
      prisma.product.findUniqueOrThrow.mockResolvedValue(
        buildProduct({ _count: { images: 0 } }),
      );

      await expect(
        service.updateProduct('p1', { isActive: true }),
      ).rejects.toThrow(/imagen/);
    });

    it('bloquea si no hay variantes activas', async () => {
      prisma.product.findUniqueOrThrow.mockResolvedValue(
        buildProduct({ variants: [] }),
      );

      await expect(
        service.updateProduct('p1', { isActive: true }),
      ).rejects.toThrow(/variantes activas/);
    });

    it('publica cuando todo esta completo', async () => {
      prisma.product.findUniqueOrThrow.mockResolvedValue(buildProduct());

      await expect(
        service.updateProduct('p1', { isActive: true }),
      ).resolves.toEqual({ id: 'p1' });
    });

    it('desactivar nunca se bloquea', async () => {
      await expect(
        service.updateProduct('p1', { isActive: false }),
      ).resolves.toEqual({ id: 'p1' });
      expect(prisma.product.findUniqueOrThrow).not.toHaveBeenCalled();
    });
  });

  describe('un producto publicado no se puede romper', () => {
    it('vaciar el providerProductUid de una variante revierte el cambio', async () => {
      prisma.product.findUniqueOrThrow
        .mockResolvedValueOnce({ isActive: true })
        .mockResolvedValueOnce({
          id: 'p1',
          fulfillmentType: 'POD',
          variants: [
            { label: 'M / Negro', providerProductUid: null, printFileUrl: 'u' },
          ],
          _count: { images: 1 },
        });

      await expect(
        service.updateVariant('p1', 'v1', { providerProductUid: '' }),
      ).rejects.toThrow(ConflictException);
    });

    it('sobre un producto despublicado se puede editar a medias', async () => {
      prisma.product.findUniqueOrThrow.mockResolvedValueOnce({
        isActive: false,
      });

      await expect(
        service.updateVariant('p1', 'v1', { providerProductUid: '' }),
      ).resolves.toEqual({ id: 'v1' });
    });
  });

  describe('aislamiento entre productos', () => {
    it('una variante de otro producto responde 404', async () => {
      prisma.productVariant.findUnique.mockResolvedValue({
        productId: 'OTRO',
      });

      await expect(
        service.updateVariant('p1', 'v1', { priceCents: 100 }),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
