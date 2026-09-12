import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { OutboxService } from './outbox.service';

/** Cada cuánto revisa la cola mientras el contenedor está despierto. */
const DEFAULT_INTERVAL_MS = 60_000;

/**
 * Temporizador interno de la cola.
 *
 * Se usa `setInterval` y no `@nestjs/schedule` para no añadir una dependencia
 * por un temporizador de quince líneas.
 *
 * Este temporizador es el reloj de verdad. En EC2 el contenedor no se duerme,
 * así que mientras el proceso viva la cola se vacía cada minuto —y además cada
 * webhook de pago la dispara al instante, sin esperar al siguiente tic—.
 *
 * Lo que NO cubre es que este proceso esté muerto, y para eso está el barrido
 * externo contra /internal/outbox/run. Nació por otro motivo —cuando el
 * backend vivía en Render, el contenedor se dormía a los 15 minutos y se
 * llevaba el intervalo por delante— y ese motivo ya no existe, pero el papel
 * de red de seguridad sí: si el contenedor se cae o se queda colgado, es lo
 * único que sigue procesando un pedido ya cobrado.
 *
 * Conviene saber que ese barrido llega tarde: GitHub estira los crons cortos,
 * y el de diez minutos se ejecuta cada tres horas de mediana. Para lo que hace
 * ahora da igual; para cualquier cosa que dependa del reloj, no sirve.
 */
@Injectable()
export class OutboxScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OutboxScheduler.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly outboxService: OutboxService,
    private readonly configService: ConfigService,
  ) {}

  onModuleInit(): void {
    const raw = Number(this.configService.get<string>('OUTBOX_INTERVAL_MS'));
    const interval =
      Number.isFinite(raw) && raw >= 5_000 ? raw : DEFAULT_INTERVAL_MS;

    if (this.configService.get<string>('OUTBOX_SCHEDULER') === 'false') {
      this.logger.warn('Temporizador de la cola desactivado por configuración');
      return;
    }

    this.timer = setInterval(() => {
      void this.tick();
    }, interval);

    // No mantiene vivo el proceso: si Node no tiene nada más que hacer, debe
    // poder salir en vez de quedarse colgado por el temporizador.
    this.timer.unref();

    this.logger.log(`Cola de trabajos revisándose cada ${interval / 1000} s`);
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** Disparo inmediato tras un webhook, sin esperar al siguiente tic. */
  trigger(): void {
    void this.tick();
  }

  private async tick(): Promise<void> {
    try {
      const summary = await this.outboxService.runPending();

      if (summary.taken > 0) {
        this.logger.log(
          `Cola: ${summary.taken} tomados · ${summary.done} hechos · ` +
            `${summary.retrying} a reintentar · ${summary.failed} agotados`,
        );
      }
    } catch (error) {
      // Nunca se propaga: una excepción en un setInterval tumba el proceso.
      this.logger.error(
        `La pasada de la cola falló: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}
