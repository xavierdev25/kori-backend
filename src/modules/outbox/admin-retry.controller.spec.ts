import {
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';
import { AdminRetryController } from './admin-retry.controller';
import { OutboxScheduler } from './outbox.scheduler';
import { OutboxService } from './outbox.service';
import { argDe } from '../../../test/helpers/mock-args';

describe('AdminRetryController', () => {
  let prisma: { order: { findUnique: jest.Mock; update: jest.Mock } };
  let outbox: { reencolarFallidos: jest.Mock };
  let scheduler: { trigger: jest.Mock };
  let controller: AdminRetryController;

  beforeEach(() => {
    prisma = {
      order: {
        findUnique: jest.fn().mockResolvedValue({ status: 'NEEDS_REVIEW' }),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    outbox = { reencolarFallidos: jest.fn().mockResolvedValue(1) };
    scheduler = { trigger: jest.fn() };

    controller = new AdminRetryController(
      outbox as unknown as OutboxService,
      scheduler as unknown as OutboxScheduler,
      prisma as unknown as PrismaService,
    );
  });

  it('un pedido que no existe da 404', async () => {
    prisma.order.findUnique.mockResolvedValue(null);

    await expect(controller.retry('o1')).rejects.toThrow(NotFoundException);
  });

  it.each(['PENDING_PAYMENT', 'PAID', 'DELIVERED', 'REFUNDED'])(
    'no se reintenta un pedido en %s',
    async (status) => {
      // Esto no es un editor de estados: solo saca de NEEDS_REVIEW, que es el
      // unico sitio del que un pedido no puede salir por si mismo.
      prisma.order.findUnique.mockResolvedValue({ status });

      await expect(controller.retry('o1')).rejects.toThrow(
        UnprocessableEntityException,
      );
      expect(outbox.reencolarFallidos).not.toHaveBeenCalled();
    },
  );

  it('sin trabajos agotados no se mueve el pedido', async () => {
    // Devolverlo a PAID sin nada que lo entregue seria dejarlo pagado y en
    // silencio, que es exactamente lo que NEEDS_REVIEW existe para evitar.
    outbox.reencolarFallidos.mockResolvedValue(0);

    await expect(controller.retry('o1')).rejects.toThrow(
      UnprocessableEntityException,
    );
    expect(prisma.order.update).not.toHaveBeenCalled();
  });

  it('reencola, devuelve el pedido a PAID y despierta la cola', async () => {
    await expect(controller.retry('o1')).resolves.toEqual({ requeued: 1 });

    expect(outbox.reencolarFallidos).toHaveBeenCalledWith('o1');

    const args = argDe<{ data: { reviewReason: null; status: string } }>(
      prisma.order.update,
    );
    expect(args.data.status).toBe('PAID');
    // Se limpia el motivo: si el reintento vuelve a fallar, el nuevo mensaje
    // sera el de esta vez y no el de la anterior.
    expect(args.data.reviewReason).toBeNull();

    // Sin esperar al siguiente tic: quien pulsa el boton esta mirando.
    expect(scheduler.trigger).toHaveBeenCalled();
  });

  it('el orden importa: primero encolar, despues mover el pedido', async () => {
    // Al reves, un fallo al reencolar dejaria el pedido en PAID sin trabajo:
    // pagado, sin entregar y sin que nada lo delate.
    const orden: string[] = [];
    outbox.reencolarFallidos.mockImplementation(() => {
      orden.push('encolar');
      return Promise.resolve(1);
    });
    prisma.order.update.mockImplementation(() => {
      orden.push('mover');
      return Promise.resolve({});
    });

    await controller.retry('o1');

    expect(orden).toEqual(['encolar', 'mover']);
  });
});
