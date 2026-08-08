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
    order: { findUnique: jest.Mock; update: jest.Mock; updateMany: jest.Mock };
    orderEvent: { create: jest.Mock };
    outboxJob: { createMany: jest.Mock };
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
});
