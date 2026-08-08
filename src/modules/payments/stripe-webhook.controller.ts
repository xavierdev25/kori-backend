import {
  BadRequestException,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  Req,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import type Stripe from 'stripe';

import { OutboxScheduler } from '../outbox/outbox.scheduler';
import { PaymentsService } from './payments.service';
import { StripeService } from './stripe.service';

/**
 * Webhook de Stripe.
 *
 * Queda FUERA del guard de autenticación (Stripe no manda nuestro JWT) pero
 * DENTRO de la verificación de firma, que es lo que hace de autenticación.
 *
 * `@SkipThrottle()` es imprescindible: el ThrottlerGuard global corta a 60
 * peticiones por minuto, y una ráfaga de reintentos de Stripe se comería esa
 * cuota. Un webhook rechazado con 429 es un pedido que se queda sin producir.
 */
@Controller('webhooks/stripe')
@SkipThrottle()
export class StripeWebhookController {
  private readonly logger = new Logger(StripeWebhookController.name);

  constructor(
    private readonly stripeService: StripeService,
    private readonly paymentsService: PaymentsService,
    private readonly outboxScheduler: OutboxScheduler,
  ) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  async handle(
    @Req() request: RawBodyRequest<Request>,
    @Headers('stripe-signature') signature: string | undefined,
  ): Promise<{ received: true }> {
    if (!signature || !request.rawBody) {
      throw new BadRequestException('Falta la firma del webhook');
    }

    let event: Stripe.Event;

    try {
      event = this.stripeService.constructEvent(request.rawBody, signature);
    } catch (error) {
      // 400 a propósito: Stripe no reintenta los 4xx, y si la firma no cuadra
      // reintentar no va a arreglarlo.
      this.logger.warn(
        `Firma de webhook inválida: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );

      throw new BadRequestException('Firma inválida');
    }

    const isNew = await this.paymentsService.claimEvent(event);

    // Duplicado: 200 para que Stripe deje de reintentar, sin hacer nada más.
    if (!isNew) {
      return { received: true };
    }

    try {
      await this.dispatch(event);
      await this.paymentsService.markEventProcessed(event.id);

      // Sin esperar: el 200 sale ya y la cola se procesa aparte. El contenedor
      // está despierto justo ahora, que es el mejor momento para vaciarla.
      this.outboxScheduler.trigger();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      this.logger.error(
        `Error procesando ${event.type} ${event.id}: ${message}`,
      );
      await this.paymentsService.markEventProcessed(event.id, message);

      // Se devuelve 200 igualmente: el evento ya quedó registrado, así que un
      // reintento de Stripe lo descartaría como duplicado y no arreglaría
      // nada. La recuperación es del barrido, que ve el pedido pagado sin
      // encolar y lo repara.
    }

    return { received: true };
  }

  private async dispatch(event: Stripe.Event): Promise<void> {
    switch (event.type) {
      case 'payment_intent.succeeded':
        await this.paymentsService.handlePaymentSucceeded(event.data.object);
        break;

      case 'checkout.session.expired':
        await this.paymentsService.handleSessionExpired(event.data.object);
        break;

      default:
        // checkout.session.completed entra aquí y se ignora a propósito: con
        // OXXO o SPEI se completa al emitir el voucher, días antes de que
        // llegue el dinero.
        this.logger.log(`Evento ${event.type} recibido y no accionado`);
    }
  }
}
