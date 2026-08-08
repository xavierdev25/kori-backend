import { Injectable, NotFoundException } from '@nestjs/common';
import { OrderStatus, Prisma } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { AdminOrdersQueryDto } from './dto/admin-orders-query.dto';

/**
 * Estados que cuentan como venta cerrada. `PENDING_PAYMENT` no entra porque
 * nadie pagó, y `CANCELLED`/`REFUNDED` tampoco porque el dinero no se quedó.
 * `NEEDS_REVIEW` sí: está pagado, solo que atascado.
 */
const SOLD_STATUSES: OrderStatus[] = [
  'PAID',
  'IN_PRODUCTION',
  'SHIPPED',
  'DELIVERED',
  'NEEDS_REVIEW',
];

/**
 * Comisión estimada de Stripe México. Son estimaciones para el panel, no
 * contabilidad: la cifra real llega en la liquidación de Stripe.
 *
 * No incluye el coste de producción, que hoy no se guarda en la base de datos.
 * Para margen real haría falta registrar lo que cobra el proveedor por pedido.
 */
const STRIPE_PERCENTAGE_FEE = 0.036;
const STRIPE_FIXED_FEE_CENTS = 300;

@Injectable()
export class OrdersService {
  constructor(private readonly prismaService: PrismaService) {}

  async findOrders(query: AdminOrdersQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const where = this.buildWhere(query);

    const [items, total] = await this.prismaService.$transaction([
      this.prismaService.order.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true,
          orderNumber: true,
          status: true,
          source: true,
          customerEmail: true,
          customerName: true,
          totalCents: true,
          currency: true,
          createdAt: true,
          paidAt: true,
          _count: { select: { items: true } },
        },
      }),
      this.prismaService.order.count({ where }),
    ]);

    // Mismo envoltorio que /admin/notes: ver comentario en CatalogService.
    return {
      data: items,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
    };
  }

  async findOrderById(id: string) {
    const order = await this.prismaService.order.findUnique({
      where: { id },
      include: {
        // Las copias congeladas: el historial se lee de aquí, nunca del
        // precio actual del producto.
        items: { orderBy: { productName: 'asc' } },
        events: { orderBy: { createdAt: 'asc' } },
        fulfillmentOrders: { orderBy: { createdAt: 'asc' } },
        jobs: {
          select: {
            type: true,
            status: true,
            attempts: true,
            lastError: true,
            nextAttemptAt: true,
            completedAt: true,
          },
        },
      },
    });

    if (!order) {
      throw new NotFoundException('El pedido no existe');
    }

    return order;
  }

  async getStats(query: AdminOrdersQueryDto) {
    const where = this.buildWhere(query);

    // Promise.all y no $transaction: `groupBy` no encaja en el array tipado de
    // transacciones de Prisma, y aquí son tres lecturas de estadísticas, no
    // algo que necesite aislamiento.
    const [byStatus, sold, refunded] = await Promise.all([
      this.prismaService.order.groupBy({
        by: ['status'],
        where,
        _count: true,
      }),
      // AND explícito y no un spread: `{ ...where, status: ... }` pisaría el
      // filtro de estado que venga en la consulta, y las estadísticas
      // ignorarían silenciosamente el filtro del panel.
      this.prismaService.order.aggregate({
        where: { AND: [where, { status: { in: SOLD_STATUSES } }] },
        _count: { _all: true },
        _sum: { totalCents: true, subtotalCents: true, shippingCents: true },
      }),
      this.prismaService.order.aggregate({
        where: { AND: [where, { status: 'REFUNDED' }] },
        _count: { _all: true },
        _sum: { totalCents: true },
      }),
    ]);

    const salesCount = sold._count._all;
    const grossRevenueCents = sold._sum.totalCents ?? 0;

    // Comisión por pedido: porcentaje sobre el total más una parte fija.
    const estimatedFeesCents = Math.round(
      grossRevenueCents * STRIPE_PERCENTAGE_FEE +
        salesCount * STRIPE_FIXED_FEE_CENTS,
    );

    // El conteo se rellena con ceros: un panel que oculta los estados sin
    // pedidos hace creer que no existen.
    const countByStatus = Object.fromEntries(
      Object.values(OrderStatus).map((status) => [
        status,
        byStatus.find((row) => row.status === status)?._count ?? 0,
      ]),
    ) as Record<OrderStatus, number>;

    return {
      currency: 'MXN',
      salesCount,
      grossRevenueCents,
      productsRevenueCents: sold._sum.subtotalCents ?? 0,
      shippingRevenueCents: sold._sum.shippingCents ?? 0,
      estimatedFeesCents,
      estimatedNetRevenueCents: grossRevenueCents - estimatedFeesCents,
      refundedCount: refunded._count._all,
      refundedCents: refunded._sum.totalCents ?? 0,
      countByStatus,
      // Se devuelven los supuestos para que el panel pueda decir "estimado"
      // con letra pequeña en vez de presentarlo como un dato exacto.
      assumptions: {
        stripePercentageFee: STRIPE_PERCENTAGE_FEE,
        stripeFixedFeeCents: STRIPE_FIXED_FEE_CENTS,
        excludesProductionCost: true,
      },
    };
  }

  private buildWhere(query: AdminOrdersQueryDto): Prisma.OrderWhereInput {
    const createdAt: Prisma.DateTimeFilter = {};

    if (query.from) {
      createdAt.gte = new Date(query.from);
    }

    if (query.to) {
      createdAt.lte = this.endOfDayIfDateOnly(query.to);
    }

    return {
      ...(query.status ? { status: query.status } : {}),
      ...(query.from || query.to ? { createdAt } : {}),
    };
  }

  /**
   * "2026-08-08" pasa a ser el último instante de ese día. Con hora explícita
   * se respeta tal cual.
   *
   * Las fechas se interpretan en UTC, no en hora de México: un pedido de las
   * 19:00 del día 8 en CDMX cae en el 9 en UTC. Para el v1 es aceptable; si
   * llega a molestar, se resuelve pasando la zona horaria desde el panel.
   */
  private endOfDayIfDateOnly(value: string): Date {
    return /^\d{4}-\d{2}-\d{2}$/.test(value)
      ? new Date(`${value}T23:59:59.999Z`)
      : new Date(value);
  }
}
