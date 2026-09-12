import {
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';

import { InternalTaskGuard } from '../../common/guards/internal-task.guard';
import {
  OrderReconciliationService,
  type ResumenConciliacion,
} from './order-reconciliation.service';

/**
 * Mantenimiento periódico de los pedidos, llamado por un cron.
 *
 * Vive en el módulo de pagos y no junto al barrido de la cola porque
 * `PaymentsModule` ya importa `OutboxModule`: meterlo en el otro lado crearía
 * un ciclo entre los dos módulos, y resolverlo con `forwardRef` es esconder el
 * problema en vez de colocarlo donde le toca. Quien concilia pagos es quien
 * habla con Stripe.
 */
@Controller('internal/orders')
@SkipThrottle()
@UseGuards(InternalTaskGuard)
export class InternalOrdersController {
  constructor(private readonly reconciliation: OrderReconciliationService) {}

  @Post('reconcile')
  @HttpCode(HttpStatus.OK)
  async reconcile(): Promise<ResumenConciliacion & { purgados: number }> {
    // Primero conciliar y después purgar, en ese orden: la conciliación es la
    // que cierra los pendientes, y así los que acaban de cerrarse ya entran en
    // el recuento de la purga sin esperar diez minutos más.
    const resumen = await this.reconciliation.run();
    const purgados = await this.reconciliation.purgarSinCobro();

    return { ...resumen, purgados };
  }
}
