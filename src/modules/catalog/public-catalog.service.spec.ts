import { NotFoundException } from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';
import { STORE_CURRENCY } from '../../common/money/currency';
import { PublicCatalogService } from './public-catalog.service';

describe('PublicCatalogService', () => {
  let prisma: { product: { findMany: jest.Mock; findFirst: jest.Mock } };
  let service: PublicCatalogService;

  beforeEach(() => {
    prisma = {
      product: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue({ id: 'p1', slug: 'playera' }),
      },
    };

    service = new PublicCatalogService(prisma as unknown as PrismaService);
  });

  /** Los campos que nunca deben salir de la tienda pública. */
  const SECRETOS = [
    'providerProductUid',
    'printFileUrl',
    'storagePath',
    'isActive',
  ];

  /** Argumentos de la primera llamada, tipados: jest.Mock los da como `any`. */
  type QueryArgs = { where: unknown; select: Record<string, unknown> };
  const argsOf = (mock: jest.Mock): QueryArgs =>
    (mock.mock.calls as QueryArgs[][])[0][0];
  const selectOf = (mock: jest.Mock) => argsOf(mock).select;
  const nestedSelect = (field: unknown) =>
    (field as { select: Record<string, unknown> }).select;

  describe('no se filtra informacion interna', () => {
    it('el listado no pide ningun campo sensible', async () => {
      await service.findAll();

      const select = selectOf(prisma.product.findMany);

      for (const campo of SECRETOS) {
        expect(select[campo]).toBeUndefined();
      }
    });

    it('las variantes no exponen el UID del proveedor ni el diseno', async () => {
      await service.findAll();

      const select = selectOf(prisma.product.findMany);
      const variantSelect = nestedSelect(select.variants);

      expect(variantSelect.providerProductUid).toBeUndefined();
      expect(variantSelect.printFileUrl).toBeUndefined();
      // ...pero sí lo que la tienda necesita para vender.
      expect(variantSelect.priceCents).toBe(true);
      expect(variantSelect.label).toBe(true);
    });

    it('las imagenes no exponen la ruta interna del bucket', async () => {
      await service.findAll();

      const select = selectOf(prisma.product.findMany);
      const imageSelect = nestedSelect(select.images);

      expect(imageSelect.storagePath).toBeUndefined();
      expect(imageSelect.url).toBe(true);
    });

    it('el detalle usa la misma proyeccion que el listado', async () => {
      await service.findAll();
      await service.findBySlug('playera');

      expect(selectOf(prisma.product.findFirst)).toEqual(
        selectOf(prisma.product.findMany),
      );
    });
  });

  describe('solo se enseña lo que se puede comprar', () => {
    it('filtra por producto activo y con variante activa', async () => {
      await service.findAll();

      expect(argsOf(prisma.product.findMany).where).toEqual({
        isActive: true,
        variants: { some: { isActive: true } },
      });
    });

    it('solo devuelve variantes activas', async () => {
      await service.findAll();

      const select = selectOf(prisma.product.findMany);

      expect((select.variants as { where: unknown }).where).toEqual({
        isActive: true,
      });
    });

    it('un producto despublicado da 404 aunque se sepa su slug', async () => {
      prisma.product.findFirst.mockResolvedValue(null);

      await expect(service.findBySlug('secreto')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('el detalle tambien exige que sea comprable', async () => {
      await service.findBySlug('playera');

      expect(argsOf(prisma.product.findFirst).where).toEqual({
        slug: 'playera',
        isActive: true,
        variants: { some: { isActive: true } },
      });
    });
  });

  it('la moneda viaja en la respuesta, la landing no la deduce', async () => {
    await expect(service.findAll()).resolves.toMatchObject({
      currency: STORE_CURRENCY,
    });
    await expect(service.findBySlug('playera')).resolves.toMatchObject({
      currency: STORE_CURRENCY,
    });
  });
});
