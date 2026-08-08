import {
  Controller,
  ForbiddenException,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SkipThrottle } from '@nestjs/throttler';

import { AuthService } from '../auth/auth.service';
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
export class OutboxController {
  constructor(
    private readonly outboxService: OutboxService,
    private readonly configService: ConfigService,
    private readonly prismaService: PrismaService,
  ) {}

  @Post('run')
  @HttpCode(HttpStatus.OK)
  async run(
    @Headers('x-internal-secret') secret: string | undefined,
  ): Promise<OutboxRunSummary> {
    // Sin secreto configurado el endpoint queda cerrado, no abierto: un fallo
    // de configuración no debe dejar expuesta la ejecución de trabajos.
    this.assertSecret(secret);

    return this.outboxService.runPending();
  }

  /**
   * Estado de salud del negocio, no del proceso.
   *
   * `/health` dice si el servidor responde; esto dice si hay dinero cobrado
   * que se quedo sin producir. Lo consulta un cron y falla si algo no cuadra,
   * que es lo que convierte un problema silencioso en un correo.
   */
  @Get('alerts')
  async alerts(@Headers('x-internal-secret') secret: string | undefined) {
    this.assertSecret(secret);

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

  private assertSecret(secret: string | undefined): void {
    const expected = this.configService.get<string>('INTERNAL_TASK_SECRET');

    if (!expected) {
      throw new ServiceUnavailableException(
        'El barrido de la cola no está configurado',
      );
    }

    if (!secret || !AuthService.safeCompare(secret, expected)) {
      throw new ForbiddenException('Secreto inválido');
    }
  }
}
