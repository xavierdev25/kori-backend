import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type Stripe from 'stripe';

import { PrismaService } from '../prisma/prisma.service';

const UNIQUE_VIOLATION = 'P2002';

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(private readonly prismaService: PrismaService) {}

  /**
   * Registra el evento ANTES de procesarlo. La violación de unicidad es lo que
   * detecta el duplicado.
   *
   * Hacerlo al revés —procesar y luego marcar— deja una ventana en la que dos
   * reintentos simultáneos de Stripe entran los dos. Y Render en plan gratuito
   * tarda ~50 s en despertar, así que los reintentos solapados no son
   * hipotéticos: son lo normal tras un rato sin tráfico.
   *
   * @returns false si ya se había registrado (duplicado, no hacer nada).
   */
  async claimEvent(event: Stripe.Event): Promise<boolean> {
    try {
      await this.prismaService.webhookEvent.create({
        data: {
          eventId: event.id,
          provider: 'STRIPE',
          payload: event as unknown as Prisma.InputJsonValue,
        },
      });

      return true;
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === UNIQUE_VIOLATION
      ) {
        this.logger.log(`Evento ${event.id} ya procesado, se ignora`);
        return false;
      }

      throw error;
    }
  }

  async markEventProcessed(eventId: string, error?: string): Promise<void> {
    await this.prismaService.webhookEvent.update({
      where: { eventId },
      data: { processedAt: new Date(), error },
    });
  }

  /**
   * El pago se confirmó de verdad.
   *
   * Se dispara SOLO desde `payment_intent.succeeded`, nunca desde
   * `checkout.session.completed`: con OXXO o SPEI la sesión se completa al
   * generar el voucher y el dinero llega días después. Producir en ese momento
   * significaría imprimir pedidos que nadie ha pagado.
   */
  async handlePaymentSucceeded(
    paymentIntent: Stripe.PaymentIntent,
  ): Promise<void> {
    const orderId = paymentIntent.metadata?.orderId;

    if (!orderId) {
      this.logger.error(
        `PaymentIntent ${paymentIntent.id} sin orderId en metadata: no se puede asociar a un pedido`,
      );
      return;
    }

    const order = await this.prismaService.order.findUnique({
      where: { id: orderId },
      include: { items: true },
    });

    if (!order) {
      this.logger.error(
        `PaymentIntent ${paymentIntent.id} apunta al pedido ${orderId}, que no existe`,
      );
      return;
    }

    // Segunda barrera de idempotencia: aunque el evento fuese nuevo, si el
    // pedido ya salió de PENDING_PAYMENT no se vuelve a tocar.
    if (order.status !== 'PENDING_PAYMENT') {
      this.logger.log(
        `El pedido ${orderId} ya está en ${order.status}, no se reprocesa`,
      );
      return;
    }

    const charge = paymentIntent.latest_charge;
    const shipping = paymentIntent.shipping;

    await this.prismaService.$transaction(async (tx) => {
      await tx.order.update({
        where: { id: orderId },
        data: {
          status: 'PAID',
          paidAt: new Date(),
          // Único en la base de datos: la defensa final contra el doble cobro.
          stripePaymentIntentId: paymentIntent.id,
          customerEmail:
            paymentIntent.receipt_email ?? order.customerEmail ?? '',
          customerName: shipping?.name ?? order.customerName,
          customerPhone: shipping?.phone ?? order.customerPhone,
          shipName: shipping?.name,
          shipLine1: shipping?.address?.line1,
          shipLine2: shipping?.address?.line2,
          shipCity: shipping?.address?.city,
          shipState: shipping?.address?.state,
          shipPostalCode: shipping?.address?.postal_code,
          shipCountry: shipping?.address?.country,
          events: {
            create: {
              status: 'PAID',
              note: `Pago confirmado (${paymentIntent.id}${
                typeof charge === 'string' ? `, cargo ${charge}` : ''
              })`,
            },
          },
        },
      });

      // El trabajo pesado no se hace aquí: se encola. El webhook tiene que
      // responder 200 rápido, y la cola vive en Postgres para sobrevivir a que
      // el contenedor se duerma.
      await tx.outboxJob.createMany({
        data: [
          {
            type: 'SEND_ORDER_CONFIRMATION',
            dedupeKey: `SEND_ORDER_CONFIRMATION:${orderId}`,
            payload: { orderId },
            orderId,
          },
          {
            type: 'FULFILL_ORDER',
            dedupeKey: `FULFILL_ORDER:${orderId}`,
            payload: { orderId },
            orderId,
          },
        ],
        // Si un reintento llega hasta aquí, no duplica los trabajos.
        skipDuplicates: true,
      });
    });

    this.logger.log(`Pedido ${orderId} pagado y encolado para producción`);
  }

  /** La sesión caducó sin pagar: el pedido pendiente deja de tener sentido. */
  async handleSessionExpired(session: Stripe.Checkout.Session): Promise<void> {
    const orderId = session.metadata?.orderId;

    if (!orderId) {
      return;
    }

    const updated = await this.prismaService.order.updateMany({
      where: { id: orderId, status: 'PENDING_PAYMENT' },
      data: { status: 'CANCELLED' },
    });

    if (updated.count > 0) {
      await this.prismaService.orderEvent.create({
        data: {
          orderId,
          status: 'CANCELLED',
          note: 'La sesión de pago caducó sin completarse',
        },
      });
    }
  }
}
