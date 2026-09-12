import { Injectable, Logger } from '@nestjs/common';
import type Stripe from 'stripe';

import {
  DIAS_RETENCION_SIN_COBRO,
  MINUTOS_GRACIA_CONCILIACION,
  NUNCA_COBRADO,
} from '../../common/constants/order.constants';
import { PrismaService } from '../prisma/prisma.service';
import { PaymentsService } from './payments.service';
import { StripeService } from './stripe.service';

/** Cuántos pedidos se revisan por pasada. */
const LOTE = 50;

export interface ResumenConciliacion {
  revisados: number;
  /** Pagos que el webhook no nos trajo y hemos recuperado preguntando. */
  recuperados: number;
  caducados: number;
  /** Pedidos cuya sesión nunca llegó a crearse. */
  sinSesion: number;
  /** Siguen abiertos: todavía se pueden pagar, no se tocan. */
  enCurso: number;
  fallos: number;
}

/**
 * Le pregunta a Stripe qué pasó de verdad con los pedidos que llevan mucho
 * rato sin pagar.
 *
 * Existe porque un webhook no puede ser el único camino a un estado que se
 * puede deducir preguntando. Hasta ahora, un pedido salía de
 * `PENDING_PAYMENT` solo si Stripe conseguía entregarnos
 * `checkout.session.expired`: si el evento no estaba activado en el destino,
 * si el servidor estaba caído mientras Stripe reintentaba, o si el pedido se
 * quedó sin sesión porque fallo la llamada de creación, ese pedido se quedaba
 * pendiente para siempre. Y un pendiente eterno no es solo ruido: sus líneas
 * bloquean el borrado del producto por la clave foránea.
 *
 * No duplica ninguna transición. Cuando averigua qué pasó, llama a los mismos
 * manejadores que usa el webhook, con sus mismas guardas de idempotencia: si
 * el evento acaba llegando después, no ocurre nada dos veces.
 */
@Injectable()
export class OrderReconciliationService {
  private readonly logger = new Logger(OrderReconciliationService.name);

  constructor(
    private readonly paymentsService: PaymentsService,
    private readonly prismaService: PrismaService,
    private readonly stripeService: StripeService,
  ) {}

  async run(): Promise<ResumenConciliacion> {
    const resumen: ResumenConciliacion = {
      revisados: 0,
      recuperados: 0,
      caducados: 0,
      sinSesion: 0,
      enCurso: 0,
      fallos: 0,
    };

    const stripe = this.stripeService.stripe;

    if (!stripe) {
      this.logger.warn('Sin cliente de Stripe: no se concilia nada');
      return resumen;
    }

    const limite = new Date(
      Date.now() - MINUTOS_GRACIA_CONCILIACION * 60 * 1000,
    );

    const pendientes = await this.prismaService.order.findMany({
      where: {
        status: 'PENDING_PAYMENT',
        createdAt: { lt: limite },
      },
      orderBy: { createdAt: 'asc' },
      take: LOTE,
      select: { id: true, orderNumber: true, stripeCheckoutSessionId: true },
    });

    resumen.revisados = pendientes.length;

    for (const pedido of pendientes) {
      try {
        if (!pedido.stripeCheckoutSessionId) {
          // La sesión nunca se creó: falló la llamada a Stripe después de
          // guardar el pedido. No hay nada que preguntar ni forma de que
          // alguien lo pague, así que se cierra.
          await this.cancelar(
            pedido.id,
            'Se cerró en la conciliación: nunca llegó a crearse la sesión de pago',
          );
          resumen.sinSesion += 1;
          continue;
        }

        const sesion = await stripe.checkout.sessions.retrieve(
          pedido.stripeCheckoutSessionId,
          { expand: ['payment_intent'] },
        );

        await this.resolver(sesion, pedido.orderNumber, resumen);
      } catch (error) {
        // Un pedido que falla no puede parar a los demás: el siguiente barrido
        // vuelve a intentarlo dentro de diez minutos.
        resumen.fallos += 1;
        this.logger.error(
          `No se pudo conciliar el pedido #${pedido.orderNumber}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    if (resumen.recuperados > 0 || resumen.caducados > 0) {
      this.logger.log(
        `Conciliación: ${resumen.revisados} revisados · ` +
          `${resumen.recuperados} pagos recuperados · ` +
          `${resumen.caducados} caducados · ${resumen.sinSesion} sin sesión`,
      );
    }

    return resumen;
  }

  /**
   * Tira los intentos de compra viejos que nunca llegaron a pagarse.
   *
   * Un carrito abandonado no es un registro contable: es ruido con el correo
   * de alguien dentro. Se borra el pedido y la cascada se lleva sus lineas,
   * sus eventos y los trabajos que tuviera encolados.
   *
   * El filtro exige las tres senales de NUNCA_COBRADO, no solo la fecha. Un
   * `deleteMany` sobre la tabla de pedidos es de las pocas operaciones de este
   * sistema que no tienen vuelta atras.
   */
  async purgarSinCobro(): Promise<number> {
    const limite = new Date(
      Date.now() - DIAS_RETENCION_SIN_COBRO * 24 * 60 * 60 * 1000,
    );

    const { count } = await this.prismaService.order.deleteMany({
      where: { ...NUNCA_COBRADO, createdAt: { lt: limite } },
    });

    if (count > 0) {
      this.logger.log(
        `Purga: ${count} intento(s) de compra sin cobro de mas de ${DIAS_RETENCION_SIN_COBRO} dias`,
      );
    }

    return count;
  }

  private async resolver(
    sesion: Stripe.Checkout.Session,
    orderNumber: number,
    resumen: ResumenConciliacion,
  ): Promise<void> {
    if (sesion.status === 'open') {
      // Todavía se puede pagar. Los pedidos creados antes de que fijáramos
      // `expires_at` arrastran la sesión de 24 h de Stripe y pasan por aquí
      // varias veces hasta que caduca sola.
      resumen.enCurso += 1;
      return;
    }

    if (sesion.status === 'complete' && sesion.payment_status === 'paid') {
      // El webhook no llegó y el dinero sí. Es lo más grave que puede
      // encontrar este barrido: alguien pagó y no recibió nada.
      this.logger.error(
        `El pedido #${orderNumber} estaba pagado en Stripe y seguía pendiente aquí. ` +
          `Revisa que checkout.session.expired y payment_intent.succeeded estén activos en el destino de webhooks.`,
      );

      const intento = sesion.payment_intent;

      if (!intento || typeof intento === 'string') {
        // Sin el PaymentIntent expandido no se puede reconstruir el pago con
        // los mismos datos que usa el webhook. Se deja para el siguiente
        // barrido en vez de escribir un PAID a medias.
        throw new Error(
          'La sesión vino pagada pero sin PaymentIntent expandido',
        );
      }

      await this.paymentsService.handlePaymentSucceeded(intento);
      resumen.recuperados += 1;
      return;
    }

    if (sesion.status === 'expired') {
      await this.paymentsService.handleSessionExpired(sesion);
      resumen.caducados += 1;
      return;
    }

    // `complete` sin pagar: pasa con métodos de pago diferidos. No se cierra
    // por si el cobro se confirma más tarde.
    resumen.enCurso += 1;
  }

  /**
   * Cierra un pedido que nunca tuvo cobro.
   *
   * `updateMany` con el filtro completo y no `update` por id: si entre la
   * consulta y esta línea llegó el webhook del pago, la condición ya no se
   * cumple y no se toca nada, en vez de pisar un PAID con un CANCELLED.
   */
  private async cancelar(orderId: string, nota: string): Promise<void> {
    const { count } = await this.prismaService.order.updateMany({
      where: { id: orderId, ...NUNCA_COBRADO },
      data: { status: 'CANCELLED' },
    });

    if (count > 0) {
      await this.prismaService.orderEvent.create({
        data: { orderId, status: 'CANCELLED', note: nota },
      });
    }
  }
}
