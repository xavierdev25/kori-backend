import type Stripe from 'stripe';

import { PrismaService } from '../prisma/prisma.service';
import { OrderReconciliationService } from './order-reconciliation.service';
import { PaymentsService } from './payments.service';
import { StripeService } from './stripe.service';
import { argDe } from '../../../test/helpers/mock-args';

const HACE_UNA_HORA = new Date(Date.now() - 60 * 60 * 1000);

describe('OrderReconciliationService', () => {
  let prisma: {
    order: {
      findMany: jest.Mock;
      updateMany: jest.Mock;
      deleteMany: jest.Mock;
    };
    orderEvent: { create: jest.Mock };
  };
  let pagos: {
    handlePaymentSucceeded: jest.Mock;
    handleSessionExpired: jest.Mock;
  };
  let retrieve: jest.Mock;
  let stripeService: { stripe: unknown };
  let service: OrderReconciliationService;

  const pedido = (extra: Record<string, unknown> = {}) => ({
    id: 'o1',
    orderNumber: 1,
    stripeCheckoutSessionId: 'cs_1',
    createdAt: HACE_UNA_HORA,
    ...extra,
  });

  const sesion = (extra: Record<string, unknown>) =>
    ({ id: 'cs_1', ...extra }) as unknown as Stripe.Checkout.Session;

  beforeEach(() => {
    prisma = {
      order: {
        findMany: jest.fn().mockResolvedValue([]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      orderEvent: { create: jest.fn().mockResolvedValue({}) },
    };
    pagos = {
      handlePaymentSucceeded: jest.fn().mockResolvedValue(undefined),
      handleSessionExpired: jest.fn().mockResolvedValue(undefined),
    };
    retrieve = jest.fn();
    stripeService = { stripe: { checkout: { sessions: { retrieve } } } };

    service = new OrderReconciliationService(
      pagos as unknown as PaymentsService,
      prisma as unknown as PrismaService,
      stripeService as unknown as StripeService,
    );
  });

  it('sin cliente de Stripe no toca nada', async () => {
    service = new OrderReconciliationService(
      pagos as unknown as PaymentsService,
      prisma as unknown as PrismaService,
      { stripe: null } as unknown as StripeService,
    );

    await expect(service.run()).resolves.toMatchObject({ revisados: 0 });
    expect(prisma.order.findMany).not.toHaveBeenCalled();
  });

  it('solo mira pendientes con mas de 35 minutos', async () => {
    await service.run();

    const filtro = argDe<{
      where: { createdAt: { lt: Date }; status: string };
    }>(prisma.order.findMany);

    expect(filtro.where.status).toBe('PENDING_PAYMENT');
    const margenMinutos =
      (Date.now() - filtro.where.createdAt.lt.getTime()) / 60000;
    // La vida de la sesion (30) mas cinco de gracia, para que el webhook de
    // caducidad tenga tiempo de llegar antes que nosotros.
    expect(Math.round(margenMinutos)).toBe(35);
  });

  it('una sesion caducada cierra el pedido por la via de siempre', async () => {
    prisma.order.findMany.mockResolvedValue([pedido()]);
    retrieve.mockResolvedValue(sesion({ status: 'expired' }));

    await expect(service.run()).resolves.toMatchObject({ caducados: 1 });
    // Reutiliza el manejador del webhook: no duplica la transicion.
    expect(pagos.handleSessionExpired).toHaveBeenCalledTimes(1);
  });

  it('una sesion abierta se deja en paz', async () => {
    prisma.order.findMany.mockResolvedValue([pedido()]);
    retrieve.mockResolvedValue(sesion({ status: 'open' }));

    await expect(service.run()).resolves.toMatchObject({
      caducados: 0,
      enCurso: 1,
    });
    expect(pagos.handleSessionExpired).not.toHaveBeenCalled();
    expect(prisma.order.updateMany).not.toHaveBeenCalled();
  });

  it('recupera un pago que el webhook nunca trajo', async () => {
    // El caso grave: alguien pago y no recibio nada porque el evento se
    // perdio. El barrido existe sobre todo para esto.
    const intento = { id: 'pi_1', metadata: { orderId: 'o1' } };
    prisma.order.findMany.mockResolvedValue([pedido()]);
    retrieve.mockResolvedValue(
      sesion({
        status: 'complete',
        payment_status: 'paid',
        payment_intent: intento,
      }),
    );

    await expect(service.run()).resolves.toMatchObject({ recuperados: 1 });
    expect(pagos.handlePaymentSucceeded).toHaveBeenCalledWith(intento);
  });

  it('si el PaymentIntent no viene expandido no escribe un PAID a medias', async () => {
    prisma.order.findMany.mockResolvedValue([pedido()]);
    retrieve.mockResolvedValue(
      sesion({
        status: 'complete',
        payment_status: 'paid',
        payment_intent: 'pi_1',
      }),
    );

    await expect(service.run()).resolves.toMatchObject({
      fallos: 1,
      recuperados: 0,
    });
    expect(pagos.handlePaymentSucceeded).not.toHaveBeenCalled();
  });

  it('un pedido sin sesion se cierra sin preguntarle a Stripe', async () => {
    prisma.order.findMany.mockResolvedValue([
      pedido({ stripeCheckoutSessionId: null }),
    ]);

    await expect(service.run()).resolves.toMatchObject({ sinSesion: 1 });
    expect(retrieve).not.toHaveBeenCalled();
    expect(prisma.order.updateMany).toHaveBeenCalled();
  });

  it('cerrar exige que el pedido siga sin cobro', async () => {
    // Si el pago entra entre la consulta y el cierre, el filtro deja de
    // cumplirse y no se pisa un PAID con un CANCELLED.
    prisma.order.findMany.mockResolvedValue([
      pedido({ stripeCheckoutSessionId: null }),
    ]);

    await service.run();

    const filtro = argDe<{
      where: {
        paidAt: null;
        status: { in: string[] };
        stripePaymentIntentId: null;
      };
    }>(prisma.order.updateMany);

    expect(filtro.where.status.in).toEqual(['PENDING_PAYMENT', 'CANCELLED']);
    expect(filtro.where.paidAt).toBeNull();
    expect(filtro.where.stripePaymentIntentId).toBeNull();
  });

  it('un pedido que falla no detiene a los demas', async () => {
    prisma.order.findMany.mockResolvedValue([
      pedido({ id: 'o1', orderNumber: 1 }),
      pedido({ id: 'o2', orderNumber: 2, stripeCheckoutSessionId: 'cs_2' }),
    ]);
    retrieve
      .mockRejectedValueOnce(new Error('Stripe caido'))
      .mockResolvedValueOnce(sesion({ status: 'expired' }));

    await expect(service.run()).resolves.toMatchObject({
      revisados: 2,
      fallos: 1,
      caducados: 1,
    });
  });

  describe('purga', () => {
    it('exige las tres senales de sin cobro, no solo la fecha', async () => {
      prisma.order.deleteMany.mockResolvedValue({ count: 3 });

      await expect(service.purgarSinCobro()).resolves.toBe(3);

      const filtro = argDe<{
        where: {
          createdAt: { lt: Date };
          paidAt: null;
          status: { in: string[] };
          stripePaymentIntentId: null;
        };
      }>(prisma.order.deleteMany);

      expect(filtro.where.status.in).toEqual(['PENDING_PAYMENT', 'CANCELLED']);
      expect(filtro.where.paidAt).toBeNull();
      expect(filtro.where.stripePaymentIntentId).toBeNull();

      const dias =
        (Date.now() - filtro.where.createdAt.lt.getTime()) /
        (24 * 60 * 60 * 1000);
      expect(Math.round(dias)).toBe(30);
    });
  });
});
