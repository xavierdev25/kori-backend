import { OrderEmailsService } from '../notifications/order-emails.service';
import { PrismaService } from '../prisma/prisma.service';
import { OutboxService } from './outbox.service';

describe('OutboxService', () => {
  function callArg<T>(mock: jest.Mock, index = 0): T {
    return (mock.mock.calls as unknown[][])[index][0] as T;
  }

  let prisma: {
    outboxJob: {
      findMany: jest.Mock;
      updateMany: jest.Mock;
      update: jest.Mock;
      findUniqueOrThrow: jest.Mock;
      createMany: jest.Mock;
    };
    order: {
      findUnique: jest.Mock;
      update: jest.Mock;
      findUniqueOrThrow: jest.Mock;
    };
  };
  let emails: {
    sendOrderConfirmation: jest.Mock;
    sendShippingNotification: jest.Mock;
    sendManualFulfillmentRequest: jest.Mock;
    sendAdminAlert: jest.Mock;
  };
  let service: OutboxService;

  const job = (overrides: Record<string, unknown> = {}) => ({
    id: 'job-1',
    type: 'SEND_ORDER_CONFIRMATION',
    orderId: 'order-1',
    ...overrides,
  });

  beforeEach(() => {
    prisma = {
      outboxJob: {
        findMany: jest.fn().mockResolvedValue([]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: jest.fn().mockResolvedValue({}),
        findUniqueOrThrow: jest
          .fn()
          .mockResolvedValue({ attempts: 0, maxAttempts: 5, type: 'X' }),
        createMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      order: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'order-1',
          orderNumber: 7,
          items: [],
          fulfillmentOrders: [],
        }),
        update: jest.fn().mockResolvedValue({}),
        findUniqueOrThrow: jest.fn().mockResolvedValue({ orderNumber: 7 }),
      },
    };

    emails = {
      sendOrderConfirmation: jest.fn().mockResolvedValue(undefined),
      sendShippingNotification: jest.fn().mockResolvedValue(undefined),
      sendManualFulfillmentRequest: jest.fn().mockResolvedValue(undefined),
      sendAdminAlert: jest.fn().mockResolvedValue(undefined),
    };

    service = new OutboxService(
      prisma as unknown as PrismaService,
      emails as unknown as OrderEmailsService,
    );
  });

  describe('toma de trabajos', () => {
    it('solo toma los vencidos', async () => {
      await service.runPending();

      const where = callArg<{
        where: { status: string; nextAttemptAt: unknown };
      }>(prisma.outboxJob.findMany).where;

      expect(where.status).toBe('PENDING');
      expect(where.nextAttemptAt).toHaveProperty('lte');
    });

    it('los marca PROCESSING antes de tocarlos', async () => {
      // Si no, dos instancias (o dos disparos) procesan el mismo trabajo.
      prisma.outboxJob.findMany.mockResolvedValue([job()]);

      await service.runPending();

      const claim = callArg<{
        where: { status: string };
        data: { status: string };
      }>(prisma.outboxJob.updateMany);
      expect(claim.where.status).toBe('PENDING');
      expect(claim.data.status).toBe('PROCESSING');
    });

    it('si otro se los llevó, no procesa nada', async () => {
      prisma.outboxJob.findMany.mockResolvedValue([job()]);
      prisma.outboxJob.updateMany.mockResolvedValue({ count: 0 });

      const summary = await service.runPending();

      expect(summary.done).toBe(0);
      expect(emails.sendOrderConfirmation).not.toHaveBeenCalled();
    });

    it('dos pasadas solapadas no se pisan', async () => {
      prisma.outboxJob.findMany.mockResolvedValue([job()]);

      const [a, b] = await Promise.all([
        service.runPending(),
        service.runPending(),
      ]);

      expect(a.taken + b.taken).toBe(1);
    });
  });

  describe('ejecución', () => {
    it('manda la confirmación de compra', async () => {
      prisma.outboxJob.findMany.mockResolvedValue([job()]);

      const summary = await service.runPending();

      expect(emails.sendOrderConfirmation).toHaveBeenCalled();
      expect(summary.done).toBe(1);
    });

    it('FULFILL_ORDER avisa al admin y pasa a producción', async () => {
      prisma.outboxJob.findMany.mockResolvedValue([
        job({ type: 'FULFILL_ORDER' }),
      ]);

      await service.runPending();

      expect(emails.sendManualFulfillmentRequest).toHaveBeenCalled();

      const update = callArg<{ data: { status: string } }>(prisma.order.update);
      expect(update.data.status).toBe('IN_PRODUCTION');
      expect(update.data).toHaveProperty('fulfillmentSubmittedAt');
    });

    it('marca DONE con su timestamp', async () => {
      prisma.outboxJob.findMany.mockResolvedValue([job()]);

      await service.runPending();

      const done = callArg<{ data: { status: string; completedAt: Date } }>(
        prisma.outboxJob.update,
      );
      expect(done.data.status).toBe('DONE');
      expect(done.data.completedAt).toBeInstanceOf(Date);
    });
  });

  describe('fallos y reintentos', () => {
    beforeEach(() => {
      prisma.outboxJob.findMany.mockResolvedValue([job()]);
      emails.sendOrderConfirmation.mockRejectedValue(new Error('Resend caído'));
    });

    it('reintenta con backoff exponencial', async () => {
      prisma.outboxJob.findUniqueOrThrow.mockResolvedValue({
        attempts: 2,
        maxAttempts: 5,
        type: 'SEND_ORDER_CONFIRMATION',
      });

      const summary = await service.runPending();

      const retry = callArg<{
        data: { status: string; attempts: number; nextAttemptAt: Date };
      }>(prisma.outboxJob.update);

      expect(summary.retrying).toBe(1);
      expect(retry.data.status).toBe('PENDING');
      expect(retry.data.attempts).toBe(3);
      // 3er intento → 4 minutos
      const delay = retry.data.nextAttemptAt.getTime() - Date.now();
      expect(delay).toBeGreaterThan(3.5 * 60_000);
      expect(delay).toBeLessThan(4.5 * 60_000);
    });

    it('guarda el error para poder diagnosticar', async () => {
      await service.runPending();

      expect(
        callArg<{ data: { lastError: string } }>(prisma.outboxJob.update).data
          .lastError,
      ).toContain('Resend caído');
    });

    it('agotado: FAILED, pedido a NEEDS_REVIEW y alerta al admin', async () => {
      // La regla del §6: un pedido pagado nunca se queda en silencio.
      prisma.outboxJob.findUniqueOrThrow.mockResolvedValue({
        attempts: 4,
        maxAttempts: 5,
        type: 'FULFILL_ORDER',
      });

      const summary = await service.runPending();

      expect(summary.failed).toBe(1);
      expect(
        callArg<{ data: { status: string } }>(prisma.outboxJob.update).data
          .status,
      ).toBe('FAILED');

      const order = callArg<{ data: { status: string; reviewReason: string } }>(
        prisma.order.update,
      );
      expect(order.data.status).toBe('NEEDS_REVIEW');
      expect(order.data.reviewReason).toContain('Resend caído');
      expect(emails.sendAdminAlert).toHaveBeenCalled();
    });

    it('si ni la alerta se puede mandar, el pedido queda marcado igual', async () => {
      prisma.outboxJob.findUniqueOrThrow.mockResolvedValue({
        attempts: 4,
        maxAttempts: 5,
        type: 'FULFILL_ORDER',
      });
      emails.sendAdminAlert.mockRejectedValue(new Error('sin correo'));

      await expect(service.runPending()).resolves.toMatchObject({ failed: 1 });
      expect(prisma.order.update).toHaveBeenCalled();
    });

    it('un pedido inexistente no bloquea la cola', async () => {
      prisma.order.findUnique.mockResolvedValue(null);

      await expect(service.runPending()).resolves.toMatchObject({ taken: 1 });
    });
  });
});
