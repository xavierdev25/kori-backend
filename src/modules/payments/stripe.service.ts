import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';

/**
 * Único punto del sistema que habla con Stripe. Ninguna otra clase importa el
 * SDK: así cambiar de versión o de proveedor toca un solo archivo.
 */
@Injectable()
export class StripeService implements OnModuleInit {
  private readonly logger = new Logger(StripeService.name);
  private readonly client: Stripe | null;
  private readonly webhookSecret: string;

  constructor(private readonly configService: ConfigService) {
    const secretKey = this.configService.get<string>('STRIPE_SECRET_KEY');
    this.webhookSecret =
      this.configService.get<string>('STRIPE_WEBHOOK_SECRET') ?? '';

    // Sin clave el módulo arranca igualmente y la tienda queda deshabilitada,
    // en vez de tumbar el backend entero: el muro de notitas no tiene por qué
    // caerse porque falte configurar los pagos.
    this.client = secretKey
      ? new Stripe(secretKey, {
          typescript: true,
          // Sin timeout, el SDK espera 80 s por defecto: el comprador se
          // queda mirando un boton bloqueado y acaba recargando.
          timeout: 15_000,
          // Reintenta solo los fallos de red idempotentes; Stripe deduplica
          // con la idempotencyKey que ya manda el checkout.
          maxNetworkRetries: 2,
        })
      : null;
  }

  onModuleInit(): void {
    if (!this.client) {
      this.logger.warn(
        'STRIPE_SECRET_KEY no definido: el checkout responderá 503. El resto del backend funciona.',
      );
      return;
    }

    if (!this.webhookSecret) {
      this.logger.warn(
        'STRIPE_WEBHOOK_SECRET no definido: los webhooks se rechazarán por falta de firma.',
      );
    }
  }

  get isEnabled(): boolean {
    return this.client !== null && this.webhookSecret !== '';
  }

  get stripe(): Stripe | null {
    return this.client;
  }

  /**
   * Verifica la firma y devuelve el evento. Lanza si no cuadra.
   *
   * Recibe el cuerpo CRUDO, nunca el objeto ya parseado: la firma se calcula
   * sobre los bytes exactos que envió Stripe y cualquier reserialización
   * (orden de claves, espacios) la invalida.
   */
  constructEvent(rawBody: Buffer, signature: string): Stripe.Event {
    if (!this.client) {
      throw new Error('Stripe no está configurado');
    }

    return this.client.webhooks.constructEvent(
      rawBody,
      signature,
      this.webhookSecret,
    );
  }
}
