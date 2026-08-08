import {
  ConflictException,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type Stripe from 'stripe';

import { PrismaService } from '../prisma/prisma.service';
import { StripeService } from '../payments/stripe.service';
import { CreateCheckoutSessionDto } from './dto/create-checkout-session.dto';

/** Moneda de la tienda. El CHECK de la base de datos solo admite esta. */
const CURRENCY = 'mxn';

/**
 * Envío de tarifa fija, en centavos, guardado en `app_settings`.
 *
 * Se midió que el envío nacional es idéntico en todo México, así que cotizar
 * en vivo no aporta información y sí añade una llamada externa en mitad del
 * pago. Por defecto 0: el precio de la playera ya lo incluye.
 */
export const SHIPPING_FLAT_CENTS_KEY = 'shipping_flat_cents';

@Injectable()
export class CheckoutService {
  private readonly logger = new Logger(CheckoutService.name);

  constructor(
    private readonly prismaService: PrismaService,
    private readonly stripeService: StripeService,
    private readonly configService: ConfigService,
  ) {}

  async createSession(dto: CreateCheckoutSessionDto): Promise<{ url: string }> {
    const stripe = this.stripeService.stripe;

    if (!stripe) {
      throw new ServiceUnavailableException(
        'La tienda no está disponible en este momento',
      );
    }

    const lines = await this.buildLinesFromDatabase(dto.items);
    const shippingCents = await this.getFlatShippingCents();
    const subtotalCents = lines.reduce(
      (sum, line) => sum + line.lineTotalCents,
      0,
    );

    // El pedido se crea ANTES de la sesión para tener un id propio que viaje
    // en los metadatos: es lo que permite reencontrarlo desde el webhook sin
    // depender de que Stripe nos devuelva nada más.
    const order = await this.prismaService.order.create({
      data: {
        status: 'PENDING_PAYMENT',
        source: 'STRIPE',
        subtotalCents,
        shippingCents,
        totalCents: subtotalCents + shippingCents,
        currency: 'MXN',
        customerEmail: dto.email ?? '',
        items: {
          create: lines.map((line) => ({
            productVariantId: line.variantId,
            productName: line.productName,
            variantLabel: line.variantLabel,
            sku: line.sku,
            unitPriceCents: line.unitPriceCents,
            quantity: line.quantity,
            lineTotalCents: line.lineTotalCents,
            providerProductUid: line.providerProductUid,
            printFileUrl: line.printFileUrl,
            fulfillmentType: line.fulfillmentType,
          })),
        },
        events: {
          create: { status: 'PENDING_PAYMENT', note: 'Checkout iniciado' },
        },
      },
    });

    try {
      const session = await stripe.checkout.sessions.create(
        this.buildSessionParams(order.id, lines, shippingCents, dto.email),
        // Si el comprador da doble clic al botón, Stripe devuelve la misma
        // sesión en vez de crear dos.
        { idempotencyKey: `checkout-session-${order.id}` },
      );

      if (!session.url) {
        throw new Error('Stripe no devolvió una URL de pago');
      }

      await this.prismaService.order.update({
        where: { id: order.id },
        data: { stripeCheckoutSessionId: session.id },
      });

      return { url: session.url };
    } catch (error) {
      // El pedido se queda en PENDING_PAYMENT sin sesión. No estorba: nadie
      // pagó y el barrido de pendientes lo limpiará.
      this.logger.error(
        `No se pudo crear la sesión de pago del pedido ${order.id}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );

      throw new ServiceUnavailableException(
        'No se pudo iniciar el pago. Inténtalo de nuevo en un momento.',
      );
    }
  }

  /**
   * Recalcula todo desde la base de datos.
   *
   * El cliente solo dice QUÉ quiere y CUÁNTO; el precio sale siempre de aquí.
   * Aunque mande un precio en el cuerpo, el DTO lo rechaza antes de llegar.
   */
  private async buildLinesFromDatabase(
    items: { variantId: string; quantity: number }[],
  ) {
    // Se agregan las cantidades por si el carrito manda la misma variante dos
    // veces: si no, se crearían dos líneas para el mismo SKU.
    const quantities = new Map<string, number>();

    for (const item of items) {
      quantities.set(
        item.variantId,
        (quantities.get(item.variantId) ?? 0) + item.quantity,
      );
    }

    const variants = await this.prismaService.productVariant.findMany({
      where: { id: { in: [...quantities.keys()] } },
      include: { product: true },
    });

    const found = new Map(variants.map((variant) => [variant.id, variant]));

    return [...quantities.entries()].map(([variantId, quantity]) => {
      const variant = found.get(variantId);

      if (!variant || !variant.isActive || !variant.product.isActive) {
        throw new ConflictException(
          'Uno de los productos de tu carrito ya no está disponible',
        );
      }

      if (
        variant.product.fulfillmentType === 'POD' &&
        (!variant.providerProductUid || !variant.printFileUrl)
      ) {
        // No debería ocurrir: publicar ya lo valida. Es la última red antes de
        // cobrarle a alguien algo que no se puede producir.
        this.logger.error(
          `La variante ${variant.id} está a la venta pero no es producible`,
        );

        throw new UnprocessableEntityException(
          'Uno de los productos de tu carrito no se puede producir ahora mismo',
        );
      }

      if (quantity > 10) {
        throw new ConflictException('Máximo 10 unidades por talla');
      }

      return {
        variantId: variant.id,
        productName: variant.product.name,
        variantLabel: variant.label,
        sku: variant.sku,
        unitPriceCents: variant.priceCents,
        quantity,
        lineTotalCents: variant.priceCents * quantity,
        providerProductUid: variant.providerProductUid,
        printFileUrl: variant.printFileUrl,
        fulfillmentType: variant.product.fulfillmentType,
      };
    });
  }

  private async getFlatShippingCents(): Promise<number> {
    const setting = await this.prismaService.appSetting.findUnique({
      where: { key: SHIPPING_FLAT_CENTS_KEY },
    });

    const parsed = Number(setting?.value ?? 0);

    return Number.isInteger(parsed) && parsed >= 0 ? parsed : 0;
  }

  private buildSessionParams(
    orderId: string,
    lines: {
      productName: string;
      variantLabel: string;
      unitPriceCents: number;
      quantity: number;
    }[],
    shippingCents: number,
    email?: string,
  ): Stripe.Checkout.SessionCreateParams {
    return {
      mode: 'payment',
      locale: 'es',
      line_items: lines.map((line) => ({
        quantity: line.quantity,
        price_data: {
          currency: CURRENCY,
          unit_amount: line.unitPriceCents,
          product_data: {
            name: `${line.productName} — ${line.variantLabel}`,
          },
        },
      })),
      // Solo México en el v1. Stripe rechaza cualquier otra dirección, así que
      // no hace falta validarlo después.
      shipping_address_collection: { allowed_countries: ['MX'] },
      ...(shippingCents > 0
        ? {
            shipping_options: [
              {
                shipping_rate_data: {
                  type: 'fixed_amount' as const,
                  display_name: 'Envío nacional',
                  fixed_amount: { amount: shippingCents, currency: CURRENCY },
                },
              },
            ],
          }
        : {}),
      ...(email ? { customer_email: email } : {}),
      client_reference_id: orderId,
      metadata: { orderId },
      // El PaymentIntent lleva también el id: `payment_intent.succeeded` no
      // incluye la sesión, así que sin esto no se puede saber qué pedido pagó.
      payment_intent_data: { metadata: { orderId } },
      success_url: this.configService.getOrThrow<string>('STRIPE_SUCCESS_URL'),
      cancel_url: this.configService.getOrThrow<string>('STRIPE_CANCEL_URL'),
    };
  }
}
