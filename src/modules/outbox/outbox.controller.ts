import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';

import { InternalTaskGuard } from '../../common/guards/internal-task.guard';
import { PrismaService } from '../prisma/prisma.service';
import { OutboxService, type OutboxRunSummary } from './outbox.service';

/** Un pedido pagado que lleva mas de esto sin producirse esta atascado. */
const STALE_ORDER_MINUTES = 30;

/**
 * Barrido externo de la cola.
 *
 * Existe porque el temporizador interno muere cuando Render duerme el
 * contenedor. Un cron de GitHub Actions llama aquí y garantiza que un pedido
 * pagado se procese aunque no haya visitas.
 *
 * Se protege con un secreto compartido y no con JWT: quien llama es una
 * máquina, no una persona con sesión.
 */
@Controller('internal/outbox')
@SkipThrottle()
@UseGuards(InternalTaskGuard)
export class OutboxController {
  constructor(
    private readonly outboxService: OutboxService,
    private readonly prismaService: PrismaService,
  ) {}

  @Post('run')
  @HttpCode(HttpStatus.OK)
  async run(): Promise<OutboxRunSummary & { purged: number }> {
    const resumen = await this.outboxService.runPending();
    // La purga va después de la pasada, no antes: si el proceso muriera en
    // medio, lo que se pierde es una limpieza, no una entrega.
    const purged = await this.outboxService.purgarCompletados();

    return { ...resumen, purged };
  }

  /**
   * Estado de salud del negocio, no del proceso.
   *
   * `/health` dice si el servidor responde; esto dice si hay dinero cobrado
   * que se quedo sin producir. Lo consulta un cron y falla si algo no cuadra,
   * que es lo que convierte un problema silencioso en un correo.
   */
  @Get('alerts')
  async alerts() {
    const staleSince = new Date(Date.now() - STALE_ORDER_MINUTES * 60_000);

    const [needsReview, failedJobs, stuckPaid, stalledJobs] = await Promise.all(
      [
        this.prismaService.order.count({ where: { status: 'NEEDS_REVIEW' } }),
        this.prismaService.outboxJob.count({ where: { status: 'FAILED' } }),
        // Pagado hace rato y todavia sin mandar a producir.
        this.prismaService.order.count({
          where: {
            status: 'PAID',
            paidAt: { lt: staleSince },
            fulfillmentSubmittedAt: null,
          },
        }),
        // Encolado, vencido y sin tomar: senal de que nadie esta procesando.
        this.prismaService.outboxJob.count({
          where: { status: 'PENDING', nextAttemptAt: { lt: staleSince } },
        }),
      ],
    );

    const problems = needsReview + failedJobs + stuckPaid + stalledJobs;

    return {
      healthy: problems === 0,
      needsReview,
      failedJobs,
      stuckPaidOrders: stuckPaid,
      stalledJobs,
      staleAfterMinutes: STALE_ORDER_MINUTES,
    };
  }
}
