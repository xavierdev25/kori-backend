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

/** La tienda vende solo en México: los días se cortan en su hora. */
const TIENDA_TIMEZONE = 'America/Mexico_City';

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

  /**
   * Ventas por día, para la gráfica del panel.
   *
   * El agregado se hace aquí y no en el navegador por lo mismo que el resto
   * del dinero: el panel solo pagina veinte pedidos, así que sumar en el
   * cliente daría una curva construida con la página que toque mirar.
   *
   * Los días se cortan en hora de México y no en UTC. Es una tienda que
   * vende solo en México: una venta de las 19:00 del día 8 en CDMX es del
   * día 8, y en UTC aparecería como del 9. En un filtro de rango eso casi no
   * se nota; en una gráfica diaria se ve, porque mueve las barras de sitio.
   */
  async getSalesTimeseries(query: AdminOrdersQueryDto) {
    // El rango se maneja como días de calendario de la tienda, no como
    // instantes. Es lo que pide una gráfica diaria, y de paso evita el lío de
    // convertir "principio del día 1 en CDMX" a un instante UTC.
    const desde =
      this.asPlainDate(query.from) ??
      // Por defecto, los últimos 30 días.
      this.toStoreDate(new Date(Date.now() - 29 * 24 * 60 * 60 * 1000));
    const hasta = this.asPlainDate(query.to) ?? this.toStoreDate(new Date());

    // `created_at` es `timestamp without time zone` y guarda UTC, así que la
    // conversión lleva dos pasos. Sin el `AT TIME ZONE 'UTC'` de delante, el
    // segundo *interpreta* la marca como hora de México en vez de
    // convertirla, y una venta de las 22:00 del día 7 en CDMX acaba contada
    // en el día 8: justo el error que esta función existe para evitar.
    //
    // Filtrar por el día ya convertido, y no por el instante, quita además la
    // dependencia de la zona horaria de la sesión de Postgres, que cambia
    // según dónde corra la base.
    const rows = await this.prismaService.$queryRaw<
      { day: Date; salesCount: bigint; grossRevenueCents: bigint }[]
    >`
      SELECT
        (created_at AT TIME ZONE 'UTC' AT TIME ZONE ${TIENDA_TIMEZONE})::date AS "day",
        COUNT(*) AS "salesCount",
        COALESCE(SUM(total_cents), 0) AS "grossRevenueCents"
      FROM orders
      WHERE status = ANY(${SOLD_STATUSES}::"OrderStatus"[])
        AND (created_at AT TIME ZONE 'UTC' AT TIME ZONE ${TIENDA_TIMEZONE})::date
              BETWEEN ${desde}::date AND ${hasta}::date
      GROUP BY "day"
      ORDER BY "day"
    `;

    // `row.day` es una fecha de calendario: el driver la entrega como Date a
    // medianoche UTC, así que se lee en UTC sin más conversiones.
    const porDia = new Map(
      rows.map((row) => [
        row.day.toISOString().slice(0, 10),
        {
          grossRevenueCents: Number(row.grossRevenueCents),
          salesCount: Number(row.salesCount),
        },
      ]),
    );

    // Los días sin ventas se rellenan con ceros. Si se omiten, la gráfica
    // une el día 3 con el día 9 en una línea recta y parece que hubo
    // actividad continua donde no la hubo.
    const dias: {
      date: string;
      grossRevenueCents: number;
      salesCount: number;
    }[] = [];
    const ultimo = hasta;
    const cursor = new Date(`${desde}T00:00:00Z`);

    while (cursor.toISOString().slice(0, 10) <= ultimo) {
      const date = cursor.toISOString().slice(0, 10);

      dias.push({
        date,
        grossRevenueCents: porDia.get(date)?.grossRevenueCents ?? 0,
        salesCount: porDia.get(date)?.salesCount ?? 0,
      });
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }

    return { currency: 'MXN', days: dias, timeZone: TIENDA_TIMEZONE };
  }

  /**
   * El día de calendario al que pertenece un instante, en hora de la tienda.
   *
   * Con `toISOString()` bastaría si todo fuera UTC, pero entonces "hoy" a las
   * 21:00 de CDMX ya sería mañana y la gráfica cerraría con un día vacío de
   * relleno. `en-CA` se usa porque da el formato AAAA-MM-DD directamente.
   */
  private toStoreDate(value: Date): string {
    return new Intl.DateTimeFormat('en-CA', {
      day: '2-digit',
      month: '2-digit',
      timeZone: TIENDA_TIMEZONE,
      year: 'numeric',
    }).format(value);
  }

  /**
   * Una fecha suelta ("2026-08-01") se toma tal cual, sin pasarla por `Date`.
   *
   * Si se convierte, JS la lee como medianoche UTC, que en México todavía es
   * el día anterior, y la gráfica arrancaba con un 31 de julio vacío que
   * nadie había pedido. Cuando viene un instante completo sí se convierte,
   * porque ahí sí hay una hora que situar.
   */
  private asPlainDate(value?: string): string | null {
    if (!value) {
      return null;
    }

    return /^\d{4}-\d{2}-\d{2}$/.test(value)
      ? value
      : this.toStoreDate(new Date(value));
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
