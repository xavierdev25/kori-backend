import { ConflictException, ServiceUnavailableException } from '@nestjs/common';
import { UnprocessableEntityException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { PrismaService } from '../prisma/prisma.service';
import { StripeService } from '../payments/stripe.service';
import { STORE_CURRENCY } from '../../common/money/currency';
import { CheckoutService } from './checkout.service';

describe('CheckoutService', () => {
  /** jest.Mock devuelve `any`; se acota aquí una vez en vez de en cada aserción. */
  function callArg<T>(mock: jest.Mock, argIndex = 0): T {
    return (mock.mock.calls as unknown[][])[0][argIndex] as T;
  }

  let prisma: {
    productVariant: { findMany: jest.Mock };
    appSetting: { findUnique: jest.Mock };
    order: { create: jest.Mock; update: jest.Mock };
  };
  let sessionsCreate: jest.Mock;
  let service: CheckoutService;

  const variant = (overrides: Record<string, unknown> = {}) => ({
    id: 'v1',
    label: 'M / Negro',
    sku: 'KORI-TEE-M',
    priceCents: 59_900,
    isActive: true,
    providerProductUid: 'uid',
    printFileUrl: 'https://kori.mx/print.png',
    product: { name: 'Playera Kori', isActive: true, fulfillmentType: 'POD' },
    ...overrides,
  });

  beforeEach(() => {
    prisma = {
      productVariant: { findMany: jest.fn().mockResolvedValue([variant()]) },
      appSetting: { findUnique: jest.fn().mockResolvedValue(null) },
      order: {
        create: jest.fn().mockResolvedValue({ id: 'order-1' }),
        update: jest.fn().mockResolvedValue({}),
      },
    };

    sessionsCreate = jest
      .fn()
      .mockResolvedValue({ id: 'cs_1', url: 'https://checkout.stripe.com/x' });

    service = new CheckoutService(
      prisma as unknown as PrismaService,
      {
        stripe: { checkout: { sessions: { create: sessionsCreate } } },
      } as unknown as StripeService,
      {
        getOrThrow: (key: string) => `https://kori.mx/${key}`,
      } as unknown as ConfigService,
    );
  });

  const orderData = () =>
    callArg<{
      data: {
        subtotalCents: number;
        shippingCents: number;
        totalCents: number;
        items: { create: { unitPriceCents: number; lineTotalCents: number }[] };
      };
    }>(prisma.order.create).data;

  describe('el precio SIEMPRE sale de la base de datos', () => {
    it('usa el precio de la variante, no lo que mande el cliente', async () => {
      // El DTO ni siquiera admite un campo de precio, pero aunque se colara
      // por otra vía, el total se recalcula desde la variante.
      await service.createSession({
        items: [{ variantId: 'v1', quantity: 2 }],
      });

      const data = orderData();
      expect(data.subtotalCents).toBe(119_800);
      expect(data.totalCents).toBe(119_800);
      expect(data.items.create[0].unitPriceCents).toBe(59_900);
    });

    it('el line_item que va a Stripe lleva el precio de la base de datos', async () => {
      await service.createSession({
        items: [{ variantId: 'v1', quantity: 1 }],
      });

      const params = callArg<{
        line_items: { price_data: { unit_amount: number; currency: string } }[];
      }>(sessionsCreate);

      expect(params.line_items[0].price_data.unit_amount).toBe(59_900);
      expect(params.line_items[0].price_data.currency).toBe(
        STORE_CURRENCY.toLowerCase(),
      );
    });

    it('suma cantidades de la misma variante en una sola línea', async () => {
      await service.createSession({
        items: [
          { variantId: 'v1', quantity: 2 },
          { variantId: 'v1', quantity: 3 },
        ],
      });

      const data = orderData();
      expect(data.items.create).toHaveLength(1);
      expect(data.subtotalCents).toBe(299_500);
    });

    it('el envío sale de la configuración, no del cliente', async () => {
      prisma.appSetting.findUnique.mockResolvedValue({ value: '15000' });

      await service.createSession({
        items: [{ variantId: 'v1', quantity: 1 }],
      });

      const data = orderData();
      expect(data.shippingCents).toBe(15_000);
      expect(data.totalCents).toBe(74_900);
    });

    it('un valor de envío corrupto no rompe el total: cae a 0', async () => {
      prisma.appSetting.findUnique.mockResolvedValue({ value: 'gratis!' });

      await service.createSession({
        items: [{ variantId: 'v1', quantity: 1 }],
      });

      expect(orderData().shippingCents).toBe(0);
    });
  });

  describe('no se cobra lo que no se puede vender', () => {
    it('rechaza una variante inexistente', async () => {
      prisma.productVariant.findMany.mockResolvedValue([]);

      await expect(
        service.createSession({ items: [{ variantId: 'v1', quantity: 1 }] }),
      ).rejects.toThrow(ConflictException);
      expect(prisma.order.create).not.toHaveBeenCalled();
    });

    it('rechaza una variante desactivada', async () => {
      prisma.productVariant.findMany.mockResolvedValue([
        variant({ isActive: false }),
      ]);

      await expect(
        service.createSession({ items: [{ variantId: 'v1', quantity: 1 }] }),
      ).rejects.toThrow(ConflictException);
    });

    it('rechaza si el producto está despublicado', async () => {
      prisma.productVariant.findMany.mockResolvedValue([
        variant({
          product: { name: 'X', isActive: false, fulfillmentType: 'POD' },
        }),
      ]);

      await expect(
        service.createSession({ items: [{ variantId: 'v1', quantity: 1 }] }),
      ).rejects.toThrow(ConflictException);
    });

    it('rechaza si no se puede producir (sin archivo de impresión)', async () => {
      prisma.productVariant.findMany.mockResolvedValue([
        variant({ printFileUrl: null }),
      ]);

      await expect(
        service.createSession({ items: [{ variantId: 'v1', quantity: 1 }] }),
      ).rejects.toThrow(/no se puede producir/);
    });

    it('sin Stripe configurado responde 503, no un error feo', async () => {
      const sinStripe = new CheckoutService(
        prisma as unknown as PrismaService,
        { stripe: null } as unknown as StripeService,
        { getOrThrow: () => 'x' } as unknown as ConfigService,
      );

      await expect(
        sinStripe.createSession({ items: [{ variantId: 'v1', quantity: 1 }] }),
      ).rejects.toThrow(ServiceUnavailableException);
    });
  });

  describe('parámetros de la sesión de Stripe', () => {
    it('solo admite direcciones de México', async () => {
      await service.createSession({
        items: [{ variantId: 'v1', quantity: 1 }],
      });

      const params = callArg<{
        shipping_address_collection: { allowed_countries: string[] };
      }>(sessionsCreate);

      expect(params.shipping_address_collection.allowed_countries).toEqual([
        'MX',
      ]);
    });

    it('el orderId viaja en el PaymentIntent', async () => {
      // Sin esto, payment_intent.succeeded no se puede asociar a un pedido:
      // ese evento no incluye la sesión de checkout.
      await service.createSession({
        items: [{ variantId: 'v1', quantity: 1 }],
      });

      const params = callArg<{
        payment_intent_data: { metadata: { orderId: string } };
        metadata: { orderId: string };
      }>(sessionsCreate);

      expect(params.payment_intent_data.metadata.orderId).toBe('order-1');
      expect(params.metadata.orderId).toBe('order-1');
    });

    it('usa clave de idempotencia por pedido', async () => {
      await service.createSession({
        items: [{ variantId: 'v1', quantity: 1 }],
      });

      expect(callArg(sessionsCreate, 1)).toEqual({
        idempotencyKey: 'checkout-session-order-1',
      });
    });

    it('sin coste de envío no se manda shipping_options', async () => {
      await service.createSession({
        items: [{ variantId: 'v1', quantity: 1 }],
      });

      expect(
        callArg<Record<string, unknown>>(sessionsCreate).shipping_options,
      ).toBeUndefined();
    });
  });

  describe('un pedido de descargas no se envía a ninguna parte', () => {
    const digital = (overrides: Record<string, unknown> = {}) =>
      variant({
        digitalAssetPath: 'drumkits/diciembre.zip',
        printFileUrl: null,
        product: {
          fulfillmentType: 'DIGITAL',
          isActive: true,
          name: 'DICIEMBRE (drumkit)',
        },
        providerProductUid: null,
        sku: 'KORI-DK-DIC',
        ...overrides,
      });

    it('no le pide la dirección al comprador', async () => {
      prisma.productVariant.findMany.mockResolvedValue([digital()]);

      await service.createSession({
        items: [{ quantity: 1, variantId: 'v1' }],
      });

      const params = callArg<Record<string, unknown>>(sessionsCreate);

      // Pedir dirección para un archivo es fricción gratis; y limitarla a
      // México le impediría pagar a cualquiera de fuera.
      expect(params.shipping_address_collection).toBeUndefined();
    });

    it('no cobra envío aunque haya tarifa configurada', async () => {
      prisma.productVariant.findMany.mockResolvedValue([digital()]);
      prisma.appSetting.findUnique.mockResolvedValue({ value: '15000' });

      await service.createSession({
        items: [{ quantity: 1, variantId: 'v1' }],
      });

      const data = orderData();
      expect(data.shippingCents).toBe(0);
      expect(data.totalCents).toBe(data.subtotalCents);
    });

    it('congela el archivo comprado en la línea del pedido', async () => {
      prisma.productVariant.findMany.mockResolvedValue([digital()]);

      await service.createSession({
        items: [{ quantity: 1, variantId: 'v1' }],
      });

      const data = callArg<{
        data: { items: { create: { digitalAssetPath: string }[] } };
      }>(prisma.order.create).data;

      // Si mañana se sube una versión nueva del kit, quien pagó ayer sigue
      // bajando la que compró.
      expect(data.items.create[0].digitalAssetPath).toBe(
        'drumkits/diciembre.zip',
      );
    });

    it('no se cobra un digital sin archivo subido', async () => {
      prisma.productVariant.findMany.mockResolvedValue([
        digital({ digitalAssetPath: null }),
      ]);

      // Cobrar por un archivo que no existe deja al comprador esperando un
      // correo que no va a llegar nunca.
      await expect(
        service.createSession({ items: [{ quantity: 1, variantId: 'v1' }] }),
      ).rejects.toThrow(UnprocessableEntityException);
    });

    it('si el carrito mezcla descarga y playera, sí pide dirección', async () => {
      prisma.productVariant.findMany.mockResolvedValue([
        digital(),
        variant({ id: 'v2', sku: 'KORI-TEE-L' }),
      ]);

      await service.createSession({
        items: [
          { quantity: 1, variantId: 'v1' },
          { quantity: 1, variantId: 'v2' },
        ],
      });

      const params = callArg<Record<string, unknown>>(sessionsCreate);
      expect(params.shipping_address_collection).toBeDefined();
    });
  });
});
