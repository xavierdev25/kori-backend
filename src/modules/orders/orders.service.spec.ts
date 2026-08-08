import { NotFoundException } from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';
import { OrdersService } from './orders.service';

describe('OrdersService', () => {
  /** jest.Mock devuelve `any`; se acota aquí una vez. */
  function callArg<T>(mock: jest.Mock, argIndex = 0): T {
    return (mock.mock.calls as unknown[][])[0][argIndex] as T;
  }

  let prisma: {
    order: {
      findMany: jest.Mock;
      findUnique: jest.Mock;
      count: jest.Mock;
      groupBy: jest.Mock;
      aggregate: jest.Mock;
    };
    $transaction: jest.Mock;
  };
  let service: OrdersService;

  beforeEach(() => {
    prisma = {
      order: {
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn().mockResolvedValue({ id: 'o1' }),
        count: jest.fn().mockResolvedValue(0),
        groupBy: jest.fn().mockResolvedValue([]),
        aggregate: jest.fn().mockResolvedValue({
          _count: { _all: 0 },
          _sum: { totalCents: null, subtotalCents: null, shippingCents: null },
        }),
      },
      $transaction: jest.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
    };

    service = new OrdersService(prisma as unknown as PrismaService);
  });

  describe('listado', () => {
    it('pagina y ordena por fecha descendente', async () => {
      prisma.order.count.mockResolvedValue(45);

      const result = await service.findOrders({ page: 2, limit: 20 });

      const args = callArg<{ skip: number; take: number; orderBy: unknown }>(
        prisma.order.findMany,
      );
      expect(args.skip).toBe(20);
      expect(args.take).toBe(20);
      expect(args.orderBy).toEqual({ createdAt: 'desc' });
      expect(result.meta).toMatchObject({ total: 45, totalPages: 3 });
    });

    it('filtra por estado', async () => {
      await service.findOrders({ status: 'PAID' });

      expect(callArg<{ where: unknown }>(prisma.order.findMany).where).toEqual({
        status: 'PAID',
      });
    });

    it('"hasta el día 8" incluye las ventas del propio día 8', async () => {
      // Sin esto, un filtro por fecha se comería silenciosamente las ventas
      // del último día del rango.
      await service.findOrders({ from: '2026-08-01', to: '2026-08-08' });

      const { where } = callArg<{
        where: { createdAt: { gte: Date; lte: Date } };
      }>(prisma.order.findMany);

      expect(where.createdAt.lte.toISOString()).toBe(
        '2026-08-08T23:59:59.999Z',
      );
      expect(where.createdAt.gte.toISOString()).toBe(
        '2026-08-01T00:00:00.000Z',
      );
    });

    it('sin filtros de fecha no añade condición', async () => {
      await service.findOrders({});

      expect(callArg<{ where: unknown }>(prisma.order.findMany).where).toEqual(
        {},
      );
    });

    it('el listado no expone la dirección del comprador', async () => {
      // Es dato personal y en una tabla no hace falta; está en el detalle.
      await service.findOrders({});

      const { select } = callArg<{ select: Record<string, unknown> }>(
        prisma.order.findMany,
      );

      for (const campo of ['shipLine1', 'shipPostalCode', 'customerPhone']) {
        expect(select[campo]).toBeUndefined();
      }
    });
  });

  describe('detalle', () => {
    it('un pedido inexistente responde 404', async () => {
      prisma.order.findUnique.mockResolvedValue(null);

      await expect(service.findOrderById('o1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('incluye copias congeladas, línea de tiempo y estado de los trabajos', async () => {
      await service.findOrderById('o1');

      const { include } = callArg<{ include: Record<string, unknown> }>(
        prisma.order.findUnique,
      );

      expect(include.items).toBeDefined();
      expect(include.events).toBeDefined();
      expect(include.fulfillmentOrders).toBeDefined();
      expect(include.jobs).toBeDefined();
    });
  });

  describe('estadísticas', () => {
    const conVentas = (count: number, total: number) => {
      prisma.order.aggregate
        .mockResolvedValueOnce({
          _count: { _all: count },
          _sum: {
            totalCents: total,
            subtotalCents: total,
            shippingCents: 0,
          },
        })
        .mockResolvedValueOnce({
          _count: { _all: 0 },
          _sum: { totalCents: null },
        });
    };

    it('estima la comisión de Stripe sobre el bruto', async () => {
      conVentas(10, 599_000); // 10 ventas de 599 MXN

      const stats = await service.getStats({});

      // 3.6% de 599000 = 21564, más 300 por pedido x10 = 3000 → 24564
      expect(stats.grossRevenueCents).toBe(599_000);
      expect(stats.estimatedFeesCents).toBe(24_564);
      expect(stats.estimatedNetRevenueCents).toBe(574_436);
    });

    it('deja claro que es una estimación y qué no incluye', async () => {
      conVentas(1, 59_900);

      const stats = await service.getStats({});

      expect(stats.assumptions.excludesProductionCost).toBe(true);
      expect(stats.assumptions.stripePercentageFee).toBe(0.036);
    });

    it('sin ventas devuelve ceros, no null', async () => {
      const stats = await service.getStats({});

      expect(stats.grossRevenueCents).toBe(0);
      expect(stats.salesCount).toBe(0);
      expect(stats.estimatedNetRevenueCents).toBe(0);
    });

    it('los pendientes de pago no cuentan como venta', async () => {
      await service.getStats({});

      const { where } = callArg<{
        where: { AND: [unknown, { status: { in: string[] } }] };
      }>(prisma.order.aggregate);
      const sold = where.AND[1].status.in;

      expect(sold).not.toContain('PENDING_PAYMENT');
      expect(sold).not.toContain('CANCELLED');
      expect(sold).not.toContain('REFUNDED');
      expect(sold).toContain('PAID');
      // Pagado pero atascado sigue siendo dinero cobrado.
      expect(sold).toContain('NEEDS_REVIEW');
    });

    it('el filtro del panel NO se pierde al calcular el bruto', async () => {
      // Con un spread, `status: { in: SOLD }` pisaba el `status` de la
      // consulta y las cifras salían como si no hubiera filtro.
      await service.getStats({ status: 'DELIVERED', from: '2026-08-01' });

      const { where } = callArg<{ where: { AND: unknown[] } }>(
        prisma.order.aggregate,
      );

      expect(where.AND[0]).toMatchObject({ status: 'DELIVERED' });
      expect(where.AND[1]).toEqual({
        status: { in: expect.arrayContaining(['PAID']) as string[] },
      });
    });

    it('todos los estados aparecen aunque estén a cero', async () => {
      prisma.order.groupBy.mockResolvedValue([{ status: 'PAID', _count: 3 }]);

      const stats = await service.getStats({});

      expect(stats.countByStatus.PAID).toBe(3);
      // Un panel que esconde los estados vacíos hace creer que no existen.
      expect(stats.countByStatus.CANCELLED).toBe(0);
      expect(Object.keys(stats.countByStatus)).toHaveLength(8);
    });
  });
});
