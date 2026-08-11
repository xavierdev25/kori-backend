import { Prisma } from '@prisma/client';
import type Stripe from 'stripe';

import { PrismaService } from '../prisma/prisma.service';
import { PaymentsService } from './payments.service';

describe('PaymentsService', () => {
  /** jest.Mock devuelve `any`; se acota aquí una vez en vez de en cada aserción. */
  function callArg<T>(mock: jest.Mock, argIndex = 0): T {
    return (mock.mock.calls as unknown[][])[0][argIndex] as T;
  }

  let prisma: {
    webhookEvent: { create: jest.Mock; update: jest.Mock };
    order: {
      findFirst: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
      updateMany: jest.Mock;
    };
    orderEvent: { create: jest.Mock };
    outboxJob: { createMany: jest.Mock };
    downloadGrant: { updateMany: jest.Mock };
    subscriber: { createMany: jest.Mock };
    $transaction: jest.Mock;
  };
  let service: PaymentsService;

  const uniqueViolation = () =>
    new Prisma.PrismaClientKnownRequestError('duplicado', {
      code: 'P2002',
      clientVersion: '6',
    });

  const paymentIntent = (overrides: Record<string, unknown> = {}) =>
    ({
      id: 'pi_1',
      metadata: { orderId: 'order-1' },
      receipt_email: 'comprador@kori.mx',
      latest_charge: 'ch_1',
      shipping: {
        name: 'Ana Ramirez',
        phone: '5512345678',
        address: {
          line1: 'Av. Insurgentes 1',
          line2: null,
          city: 'Ciudad de Mexico',
          state: 'CDMX',
          postal_code: '06700',
          country: 'MX',
        },
      },
      ...overrides,
    }) as unknown as Stripe.PaymentIntent;

  beforeEach(() => {
    prisma = {
      webhookEvent: {
        create: jest.fn().mockResolvedValue({}),
        update: jest.fn().mockResolvedValue({}),
      },
      order: {
        findFirst: jest.fn().mockResolvedValue(null),
        findUnique: jest.fn().mockResolvedValue({
          id: 'order-1',
          status: 'PENDING_PAYMENT',
          items: [],
        }),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      orderEvent: { create: jest.fn().mockResolvedValue({}) },
      outboxJob: { createMany: jest.fn().mockResolvedValue({ count: 2 }) },
      downloadGrant: { updateMany: jest.fn().mockResolvedValue({}) },
      subscriber: { createMany: jest.fn().mockResolvedValue({ count: 1 }) },
      $transaction: jest.fn((fn: (tx: unknown) => unknown) => fn(prisma)),
    };

    service = new PaymentsService(prisma as unknown as PrismaService);
  });

  describe('idempotencia', () => {
    it('un evento nuevo se reclama', async () => {
      await expect(
        service.claimEvent({ id: 'evt_1', type: 'x' } as Stripe.Event),
      ).resolves.toBe(true);
    });

    it('el registro ocurre ANTES de procesar, no después', async () => {
      // Marcar al final dejaría una ventana en la que dos reintentos
      // simultáneos de Stripe entran los dos.
      await service.claimEvent({ id: 'evt_1', type: 'x' } as Stripe.Event);

      const { data } = callArg<{ data: { processedAt?: unknown } }>(
        prisma.webhookEvent.create,
      );
      expect(data.processedAt).toBeUndefined();
    });

    it('un evento repetido se descarta sin lanzar', async () => {
      prisma.webhookEvent.create.mockRejectedValue(uniqueViolation());

      await expect(
        service.claimEvent({ id: 'evt_1', type: 'x' } as Stripe.Event),
      ).resolves.toBe(false);
    });

    it('un error de base de datos distinto sí se propaga', async () => {
      prisma.webhookEvent.create.mockRejectedValue(new Error('conexión caída'));

      await expect(
        service.claimEvent({ id: 'evt_1', type: 'x' } as Stripe.Event),
      ).rejects.toThrow('conexión caída');
    });
  });

  describe('pago confirmado', () => {
    it('marca PAID, guarda el PaymentIntent y la dirección', async () => {
      await service.handlePaymentSucceeded(paymentIntent());

      const { data } = callArg<{ data: Record<string, unknown> }>(
        prisma.order.update,
      );

      expect(data.status).toBe('PAID');
      expect(data.stripePaymentIntentId).toBe('pi_1');
      expect(data.shipPostalCode).toBe('06700');
      expect(data.shipCountry).toBe('MX');
      expect(data.customerEmail).toBe('comprador@kori.mx');
    });

    it('encola producción y correo, sin ejecutarlos en el webhook', async () => {
      await service.handlePaymentSucceeded(paymentIntent());

      const jobs = callArg<{
        data: { type: string; dedupeKey: string }[];
        skipDuplicates: boolean;
      }>(prisma.outboxJob.createMany);

      expect(jobs.data.map((j) => j.type).sort()).toEqual([
        'FULFILL_ORDER',
        'SEND_ORDER_CONFIRMATION',
      ]);
      expect(jobs.data[0].dedupeKey).toContain('order-1');
      expect(jobs.skipDuplicates).toBe(true);
    });

    it('un pedido que ya salió de PENDING_PAYMENT no se reprocesa', async () => {
      prisma.order.findUnique.mockResolvedValue({
        id: 'order-1',
        status: 'IN_PRODUCTION',
        items: [],
      });

      await service.handlePaymentSucceeded(paymentIntent());

      expect(prisma.order.update).not.toHaveBeenCalled();
      expect(prisma.outboxJob.createMany).not.toHaveBeenCalled();
    });

    it('sin orderId en metadata no toca nada', async () => {
      await service.handlePaymentSucceeded(paymentIntent({ metadata: {} }));

      expect(prisma.order.findUnique).not.toHaveBeenCalled();
      expect(prisma.order.update).not.toHaveBeenCalled();
    });

    it('si el pedido no existe no revienta', async () => {
      prisma.order.findUnique.mockResolvedValue(null);

      await expect(
        service.handlePaymentSucceeded(paymentIntent()),
      ).resolves.toBeUndefined();
      expect(prisma.order.update).not.toHaveBeenCalled();
    });
  });

  describe('casilla de novedades', () => {
    const pedido = (newsletterOptIn: boolean) => ({
      id: 'order-1',
      items: [],
      newsletterOptIn,
      status: 'PENDING_PAYMENT',
    });

    it('sin marcar, nadie acaba en la lista', async () => {
      prisma.order.findUnique.mockResolvedValue(pedido(false));

      await service.handlePaymentSucceeded(paymentIntent());

      expect(prisma.subscriber.createMany).not.toHaveBeenCalled();
    });

    it('marcada, se apunta el correo que Stripe verificó', async () => {
      prisma.order.findUnique.mockResolvedValue(pedido(true));

      await service.handlePaymentSucceeded(paymentIntent());

      const args = callArg<{
        data: { email: string }[];
        skipDuplicates: boolean;
      }>(prisma.subscriber.createMany);

      expect(args.data).toEqual([{ email: 'comprador@kori.mx' }]);
      // Sin `skipDuplicates`, un correo ya suscrito daría error de clave
      // única y tiraría la transacción: el pedido pagado se perdería por
      // una casilla de novedades.
      expect(args.skipDuplicates).toBe(true);
    });

    it('el alta va DENTRO de la misma transacción que el pago', async () => {
      prisma.order.findUnique.mockResolvedValue(pedido(true));

      await service.handlePaymentSucceeded(paymentIntent());

      expect(prisma.$transaction).toHaveBeenCalled();
      expect(prisma.subscriber.createMany).toHaveBeenCalled();
    });

    it('sin correo no se apunta una fila vacía', async () => {
      prisma.order.findUnique.mockResolvedValue({
        ...pedido(true),
        customerEmail: '',
      });

      await service.handlePaymentSucceeded(
        paymentIntent({ receipt_email: null }),
      );

      expect(prisma.subscriber.createMany).not.toHaveBeenCalled();
      // Y aun así el pedido se cobra y se encola: lo de la lista es lo
      // accesorio, no al revés.
      expect(prisma.outboxJob.createMany).toHaveBeenCalled();
    });
  });

  describe('sesión caducada', () => {
    it('cancela solo si seguía pendiente de pago', async () => {
      await service.handleSessionExpired({
        metadata: { orderId: 'order-1' },
      } as unknown as Stripe.Checkout.Session);

      expect(callArg(prisma.order.updateMany)).toEqual({
        where: { id: 'order-1', status: 'PENDING_PAYMENT' },
        data: { status: 'CANCELLED' },
      });
    });

    it('si ya no estaba pendiente, no escribe evento', async () => {
      prisma.order.updateMany.mockResolvedValue({ count: 0 });

      await service.handleSessionExpired({
        metadata: { orderId: 'order-1' },
      } as unknown as Stripe.Checkout.Session);

      expect(prisma.orderEvent.create).not.toHaveBeenCalled();
    });
  });

  describe('reembolso', () => {
    const charge = (overrides: Record<string, unknown> = {}) =>
      ({
        amount: 2000,
        amount_refunded: 2000,
        id: 'ch_1',
        metadata: { orderId: 'o1' },
        payment_intent: 'pi_1',
        ...overrides,
      }) as unknown as Stripe.Charge;

    beforeEach(() => {
      prisma.order.findFirst.mockResolvedValue({
        id: 'o1',
        items: [{ id: 'i1' }, { id: 'i2' }],
      });
      prisma.downloadGrant.updateMany.mockResolvedValue({});
    });

    it('un reembolso total revoca los enlaces de descarga', async () => {
      await service.handleChargeRefunded(charge());

      // Sin esto, quien pide el dinero de vuelta se queda con el archivo.
      const { data, where } = (
        prisma.downloadGrant.updateMany.mock.calls as unknown[][]
      )[0][0] as {
        data: { revokedAt: Date };
        where: { orderItemId: { in: string[] }; revokedAt: null };
      };

      expect(where.orderItemId.in).toEqual(['i1', 'i2']);
      expect(where.revokedAt).toBeNull();
      expect(data.revokedAt).toBeInstanceOf(Date);
    });

    it('el pedido queda como REFUNDED', async () => {
      await service.handleChargeRefunded(charge());

      const { data } = (
        prisma.order.update.mock.calls as unknown[][]
      )[0][0] as {
        data: { status: string };
      };

      expect(data.status).toBe('REFUNDED');
    });

    it('un reembolso parcial no toca nada: lo decide una persona', async () => {
      await service.handleChargeRefunded(
        charge({ amount: 5000, amount_refunded: 1000 }),
      );

      expect(prisma.downloadGrant.updateMany).not.toHaveBeenCalled();
      expect(prisma.order.update).not.toHaveBeenCalled();
    });

    it('un cargo de un pedido desconocido no revienta', async () => {
      prisma.order.findFirst.mockResolvedValue(null);

      await expect(
        service.handleChargeRefunded(charge()),
      ).resolves.toBeUndefined();
    });
  });
});
