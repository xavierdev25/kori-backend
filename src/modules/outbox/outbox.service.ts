import { Injectable, Logger } from '@nestjs/common';
import { OutboxJobType, Prisma } from '@prisma/client';

import { OrderEmailsService } from '../notifications/order-emails.service';
import {
  DOWNLOAD_GRANT_MAX_USES,
  DOWNLOAD_GRANT_TTL_HOURS,
} from '../../common/constants/digital.constants';
import { DigitalDeliveryService } from '../orders/digital-delivery.service';
import { PrismaService } from '../prisma/prisma.service';

/** Cuántos trabajos se toman por pasada. */
const BATCH_SIZE = 10;

/** Backoff exponencial: 1, 2, 4, 8… minutos, con techo de una hora. */
const BASE_BACKOFF_MS = 60_000;
const MAX_BACKOFF_MS = 60 * 60 * 1000;

export interface OutboxRunSummary {
  taken: number;
  done: number;
  failed: number;
  retrying: number;
}

@Injectable()
export class OutboxService {
  private readonly logger = new Logger(OutboxService.name);

  /** Evita que dos disparos solapados procesen el mismo trabajo. */
  private running = false;

  constructor(
    private readonly prismaService: PrismaService,
    private readonly orderEmailsService: OrderEmailsService,
    private readonly digitalDeliveryService: DigitalDeliveryService,
  ) {}

  /**
   * Procesa una tanda de trabajos pendientes.
   *
   * Se dispara desde tres sitios: tras un webhook (el contenedor ya está
   * despierto), por el temporizador interno, y desde el endpoint de barrido
   * que llama GitHub Actions. Los tres pueden coincidir, de ahí el cerrojo.
   */
  async runPending(): Promise<OutboxRunSummary> {
    if (this.running) {
      return { taken: 0, done: 0, failed: 0, retrying: 0 };
    }

    this.running = true;

    try {
      const jobs = await this.claimBatch();
      const summary: OutboxRunSummary = {
        taken: jobs.length,
        done: 0,
        failed: 0,
        retrying: 0,
      };

      for (const job of jobs) {
        const outcome = await this.process(
          job.id,
          job.type,
          job.orderId,
          job.payload,
        );
        summary[outcome] += 1;
      }

      return summary;
    } finally {
      this.running = false;
    }
  }

  /**
   * Marca los trabajos como PROCESSING antes de tocarlos.
   *
   * `updateMany` sobre ids ya filtrados por estado es lo que evita que dos
   * instancias se lleven el mismo: el segundo actualiza 0 filas.
   */
  private async claimBatch() {
    const candidates = await this.prismaService.outboxJob.findMany({
      where: { status: 'PENDING', nextAttemptAt: { lte: new Date() } },
      orderBy: { nextAttemptAt: 'asc' },
      take: BATCH_SIZE,
      select: { id: true, type: true, orderId: true, payload: true },
    });

    if (candidates.length === 0) {
      return [];
    }

    const ids = candidates.map((job) => job.id);
    const claimed = await this.prismaService.outboxJob.updateMany({
      where: { id: { in: ids }, status: 'PENDING' },
      data: { status: 'PROCESSING' },
    });

    return claimed.count === ids.length ? candidates : [];
  }

  private async process(
    jobId: string,
    type: OutboxJobType,
    orderId: string | null,
    payload: Prisma.JsonValue,
  ): Promise<'done' | 'failed' | 'retrying'> {
    try {
      await this.execute(type, orderId, payload);

      await this.prismaService.outboxJob.update({
        where: { id: jobId },
        data: {
          status: 'DONE',
          completedAt: new Date(),
          attempts: { increment: 1 },
          lastError: null,
        },
      });

      return 'done';
    } catch (error) {
      return this.recordFailure(jobId, error, orderId);
    }
  }

  private async execute(
    type: OutboxJobType,
    orderId: string | null,
    payload: Prisma.JsonValue,
  ): Promise<void> {
    // Antes del cierre por pedido: este trabajo no cuelga de ninguno, y la
    // comprobación de abajo lo daría por roto para siempre. Al salir aquí,
    // TypeScript lo descarta del switch de abajo — por eso no aparece allí.
    if (type === 'SEND_CONTACT_MESSAGE') {
      await this.sendContactMessage(payload);
      return;
    }

    if (!orderId) {
      throw new Error(`El trabajo ${type} llegó sin pedido asociado`);
    }

    const order = await this.prismaService.order.findUnique({
      where: { id: orderId },
      include: { items: true, fulfillmentOrders: true },
    });

    if (!order) {
      throw new Error(`El pedido ${orderId} no existe`);
    }

    switch (type) {
      case 'SEND_ORDER_CONFIRMATION':
        await this.orderEmailsService.sendOrderConfirmation(order);
        break;

      case 'SEND_SHIPPING_NOTIFICATION':
        await this.orderEmailsService.sendShippingNotification(order);
        break;

      case 'FULFILL_ORDER':
        // Sin API de proveedor todavía: el pedido se coloca a mano y el
        // sistema avisa por correo con todo lo necesario. Cuando exista la
        // API, se sustituye esta línea y nada más cambia.
        await this.orderEmailsService.sendManualFulfillmentRequest(order);

        await this.prismaService.order.update({
          where: { id: orderId },
          data: {
            status: 'IN_PRODUCTION',
            fulfillmentSubmittedAt: new Date(),
            events: {
              create: {
                status: 'IN_PRODUCTION',
                note: 'Enviado a producción manual',
              },
            },
          },
        });
        break;

      case 'DELIVER_DIGITAL': {
        // El equivalente digital de FULFILL_ORDER. No pasa por
        // IN_PRODUCTION: un drumkit no se produce, se entrega.
        const enlaces = await this.digitalDeliveryService.emitirEnlaces(order);

        if (enlaces.length === 0) {
          // Pagado y sin nada que entregar. Que reviente el trabajo es lo
          // correcto: acabará en NEEDS_REVIEW con aviso al admin, en vez de
          // dejar al comprador esperando un correo que no existe.
          throw new Error(
            `El pedido ${orderId} no tiene archivos que entregar`,
          );
        }

        await this.orderEmailsService.sendDownloadLinks(
          order,
          enlaces,
          DOWNLOAD_GRANT_TTL_HOURS,
          DOWNLOAD_GRANT_MAX_USES,
        );

        await this.prismaService.order.update({
          data: {
            events: {
              create: {
                note: `Enlaces de descarga enviados (${enlaces.length})`,
                status: 'DELIVERED',
              },
            },
            fulfillmentSubmittedAt: new Date(),
            status: 'DELIVERED',
          },
          where: { id: orderId },
        });
        break;
      }

      case 'SEND_ADMIN_ALERT':
        await this.orderEmailsService.sendAdminAlert(
          `Pedido #${order.orderNumber} necesita revisión`,
          `El pedido #${order.orderNumber} quedó marcado para revisión.`,
        );
        break;
    }
  }

  /**
   * Reenvía a soporte un mensaje del formulario.
   *
   * Se relee de la base en vez de llevar el texto en el payload: si alguien
   * borra el mensaje, este trabajo deja de tener sentido y termina en vez de
   * reenviar algo que ya no existe.
   */
  private async sendContactMessage(payload: Prisma.JsonValue): Promise<void> {
    const id =
      payload && typeof payload === 'object' && !Array.isArray(payload)
        ? (payload as { contactMessageId?: unknown }).contactMessageId
        : undefined;

    if (typeof id !== 'string') {
      throw new Error('El trabajo de contacto llegó sin contactMessageId');
    }

    const mensaje = await this.prismaService.contactMessage.findUnique({
      where: { id },
    });

    if (!mensaje) {
      // Borrado entre medias: no es un fallo que haya que reintentar cinco
      // veces. Se da por hecho y se sigue.
      this.logger.warn(`El mensaje de contacto ${id} ya no existe; se omite`);
      return;
    }

    await this.orderEmailsService.sendContactMessage(mensaje);
  }

  /**
   * Un trabajo agotado NO se olvida: el pedido pasa a NEEDS_REVIEW y llega una
   * alerta. Es la regla de tu §6 — nunca dejar un pedido pagado en silencio
   * sin producción.
   */
  private async recordFailure(
    jobId: string,
    error: unknown,
    orderId: string | null,
  ): Promise<'failed' | 'retrying'> {
    const message = error instanceof Error ? error.message : String(error);
    const job = await this.prismaService.outboxJob.findUniqueOrThrow({
      where: { id: jobId },
      select: { attempts: true, maxAttempts: true, type: true },
    });

    const attempts = job.attempts + 1;
    const exhausted = attempts >= job.maxAttempts;

    await this.prismaService.outboxJob.update({
      where: { id: jobId },
      data: {
        status: exhausted ? 'FAILED' : 'PENDING',
        attempts,
        lastError: message.slice(0, 500),
        nextAttemptAt: new Date(Date.now() + this.backoffMs(attempts)),
      },
    });

    if (!exhausted) {
      this.logger.warn(
        `Trabajo ${job.type} falló (intento ${attempts}/${job.maxAttempts}): ${message}`,
      );
      return 'retrying';
    }

    this.logger.error(
      `Trabajo ${job.type} agotó sus ${job.maxAttempts} intentos: ${message}`,
    );

    if (orderId) {
      await this.escalate(orderId, job.type, message);
    }

    return 'failed';
  }

  private async escalate(
    orderId: string,
    type: OutboxJobType,
    message: string,
  ): Promise<void> {
    await this.prismaService.order.update({
      where: { id: orderId },
      data: {
        status: 'NEEDS_REVIEW',
        reviewReason: `El trabajo ${type} falló: ${message}`.slice(0, 500),
        fulfillmentError: message.slice(0, 500),
        events: {
          create: {
            status: 'NEEDS_REVIEW',
            note: `Trabajo ${type} agotado tras varios intentos`,
          },
        },
      },
    });

    try {
      const order = await this.prismaService.order.findUniqueOrThrow({
        where: { id: orderId },
        select: { orderNumber: true },
      });

      await this.orderEmailsService.sendAdminAlert(
        `Pedido #${order.orderNumber} atascado — ${type}`,
        [
          `El pedido #${order.orderNumber} está pagado pero su trabajo ${type}`,
          'falló definitivamente y ya no se reintentará.',
          '',
          `Error: ${message}`,
          '',
          'El pedido quedó en NEEDS_REVIEW. Hay que resolverlo a mano.',
        ].join('\n'),
      );
    } catch (alertError) {
      // Si ni la alerta se puede mandar, al menos queda en el log y el pedido
      // ya está marcado en la base de datos.
      this.logger.error(
        `No se pudo avisar del pedido ${orderId}: ${
          alertError instanceof Error ? alertError.message : String(alertError)
        }`,
      );
    }
  }

  /**
   * Espera creciente con azar.
   *
   * Lo importante es el azar, no la curva. Sin él, todos los trabajos que
   * fallaron a la vez —porque Stripe o Resend estuvieron caídos un rato—
   * reintentan exactamente en el mismo instante, y otra vez, y otra: se
   * golpea en bloque a un servicio que justamente está mal, y el
   * cortacircuitos se reabre solo para volver a cerrarse.
   *
   * Se usa "full jitter": un valor al azar entre cero y el techo de esa
   * tentativa. Reparte los reintentos a lo largo de toda la ventana en vez de
   * amontonarlos, y de paso hace que dos trabajos que empezaron juntos dejen
   * de ir sincronizados para siempre.
   */
  private backoffMs(attempts: number): number {
    const techo = Math.min(
      BASE_BACKOFF_MS * 2 ** (attempts - 1),
      MAX_BACKOFF_MS,
    );

    // Con suelo de un cuarto del techo: sin él, un `Math.random()` bajo
    // devolvería un reintento casi inmediato, que es lo contrario de esperar.
    return Math.round(techo * (0.25 + Math.random() * 0.75));
  }

  /** Encola un trabajo sin duplicar si ya existe. */
  async enqueue(
    type: OutboxJobType,
    orderId: string,
    payload: Prisma.InputJsonValue = {},
  ): Promise<void> {
    await this.prismaService.outboxJob.createMany({
      data: [{ type, dedupeKey: `${type}:${orderId}`, payload, orderId }],
      skipDuplicates: true,
    });
  }

  /**
   * Encola algo que no cuelga de un pedido, como un mensaje de contacto.
   *
   * `orderId` queda a null: la relación es opcional en el modelo y forzar un
   * pedido inventado para poder encolar sería mentirle a la base de datos. La
   * clave de deduplicación la pone quien llama con el id de su propio
   * registro, que es lo que da la idempotencia.
   */
  async enqueueStandalone(
    type: OutboxJobType,
    dedupeId: string,
    payload: Prisma.InputJsonValue = {},
  ): Promise<void> {
    await this.prismaService.outboxJob.createMany({
      data: [{ type, dedupeKey: `${type}:${dedupeId}`, payload }],
      skipDuplicates: true,
    });
  }
}
