import {
  Controller,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  UnprocessableEntityException,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';

import { NoCacheInterceptor } from '../../common/interceptors/no-cache.interceptor';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { PrismaService } from '../prisma/prisma.service';
import { OutboxScheduler } from './outbox.scheduler';
import { OutboxService } from './outbox.service';

/**
 * Sacar un pedido de NEEDS_REVIEW volviendo a encolar su trabajo.
 *
 * En `admin-orders.controller` hay escrito que un pedido nunca cambia de
 * estado a mano desde el panel, y esa regla se respeta aquí: esto no edita un
 * estado, reintenta un trabajo. El pedido vuelve a PAID porque es de donde
 * salió, no porque alguien lo elija en un desplegable, y solo puede ir a ese
 * estado y desde NEEDS_REVIEW. No hay forma de llevar un pedido a un sitio al
 * que el sistema no lo hubiera llevado solo.
 *
 * Lo que había antes era peor que una excepción a la regla: un pedido pagado
 * cuyo trabajo agotó los cinco intentos se quedaba ahí para siempre, y la
 * única salida era entrar a la base de datos por SSH. Eso choca de frente con
 * no dejar nunca una orden pagada sin entrega.
 *
 * Vive en el módulo de la cola y no junto al resto de `admin/orders` porque
 * quien reencola es quien posee los trabajos: `OutboxModule` ya importa
 * `OrdersModule`, así que al revés habría ciclo.
 */
@Controller('admin/orders')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
@UseInterceptors(NoCacheInterceptor)
export class AdminRetryController {
  constructor(
    private readonly outboxService: OutboxService,
    private readonly outboxScheduler: OutboxScheduler,
    private readonly prismaService: PrismaService,
  ) {}

  @Post(':id/retry')
  @HttpCode(HttpStatus.OK)
  async retry(@Param('id', ParseUUIDPipe) id: string) {
    const order = await this.prismaService.order.findUnique({
      where: { id },
      select: { status: true },
    });

    if (!order) {
      throw new NotFoundException('El pedido no existe');
    }

    if (order.status !== 'NEEDS_REVIEW') {
      throw new UnprocessableEntityException(
        `Solo se reintenta un pedido atascado, y este está en ${order.status}.`,
      );
    }

    const reencolados = await this.outboxService.reencolarFallidos(id);

    if (reencolados === 0) {
      // Sin trabajo que reencolar, devolverlo a PAID lo dejaría pagado y sin
      // nada que lo entregue: exactamente el silencio que hay que evitar.
      throw new UnprocessableEntityException(
        'Este pedido no tiene ningún trabajo agotado que reintentar. Míralo a mano antes de moverlo.',
      );
    }

    await this.prismaService.order.update({
      where: { id },
      data: {
        status: 'PAID',
        reviewReason: null,
        events: {
          create: {
            status: 'PAID',
            note: `Reintento manual desde el panel: ${reencolados} trabajo(s) de vuelta a la cola`,
          },
        },
      },
    });

    // Sin esperar al siguiente tic: quien pulsa el botón está mirando.
    this.outboxScheduler.trigger();

    return { requeued: reencolados };
  }
}
