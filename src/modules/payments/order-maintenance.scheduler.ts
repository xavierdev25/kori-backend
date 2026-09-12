import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { OutboxService } from '../outbox/outbox.service';
import { OrderReconciliationService } from './order-reconciliation.service';

/** Cada cuánto se le pregunta a Stripe por los pedidos sin pagar. */
const INTERVALO_CONCILIACION_MS = 10 * 60 * 1000;

/** Las purgas miran datos de 30 y 90 días: una vez al día sobra. */
const INTERVALO_PURGA_MS = 24 * 60 * 60 * 1000;

/** Por debajo de esto el intervalo se ignora: sería martillear la base. */
const INTERVALO_MINIMO_MS = 60_000;

/**
 * Mantenimiento periódico de los pedidos, dentro del propio contenedor.
 *
 * Por qué está aquí y no solo en el cron de GitHub: porque ese cron no cumple
 * lo que promete. Medido sobre las últimas diez ejecuciones de este repo, un
 * cron de cada diez minutos se ejecutaba cada 185 de mediana —18 veces menos
 * de lo pedido— y el horario de `alerts` cada 248. Estira los crons cortos
 * tanto más cuanto más frecuentes son; el de seis horas era el único que
 * llegaba a tiempo. Un barrido que dice cada diez minutos y ocurre cada tres
 * horas no es una red de seguridad, es una falsa sensación de tenerla.
 *
 * El cron externo se queda, pero cambiando de papel: ya no es el reloj, es lo
 * único que sigue funcionando si este contenedor está muerto. Para eso su
 * cadencia real da igual.
 *
 * Se usa `setInterval` y no `@nestjs/schedule` por lo mismo que el temporizador
 * de la cola: no merece una dependencia más.
 */
@Injectable()
export class OrderMaintenanceScheduler
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(OrderMaintenanceScheduler.name);
  private readonly temporizadores: NodeJS.Timeout[] = [];
  private conciliando = false;
  private purgando = false;

  constructor(
    private readonly configService: ConfigService,
    private readonly outboxService: OutboxService,
    private readonly reconciliation: OrderReconciliationService,
  ) {}

  onModuleInit(): void {
    if (
      this.configService.get<string>('ORDER_MAINTENANCE_SCHEDULER') === 'false'
    ) {
      this.logger.warn(
        'Mantenimiento de pedidos desactivado por configuración: solo lo hará el cron externo',
      );
      return;
    }

    const intervalo = this.intervaloConciliacion();

    this.programar(() => this.conciliar(), intervalo);
    this.programar(() => this.purgar(), INTERVALO_PURGA_MS);

    this.logger.log(
      `Conciliación de pedidos cada ${intervalo / 60000} min · purgas cada 24 h`,
    );
  }

  onModuleDestroy(): void {
    for (const temporizador of this.temporizadores) {
      clearInterval(temporizador);
    }

    this.temporizadores.length = 0;
  }

  private intervaloConciliacion(): number {
    const crudo = Number(
      this.configService.get<string>('RECONCILIATION_INTERVAL_MS'),
    );

    return Number.isFinite(crudo) && crudo >= INTERVALO_MINIMO_MS
      ? crudo
      : INTERVALO_CONCILIACION_MS;
  }

  private programar(tarea: () => Promise<void>, cada: number): void {
    const temporizador = setInterval(() => {
      void tarea();
    }, cada);

    // No mantiene vivo el proceso: si Node no tiene nada más que hacer, debe
    // poder salir en vez de quedarse colgado por el temporizador.
    temporizador.unref();
    this.temporizadores.push(temporizador);
  }

  /**
   * La bandera evita que dos pasadas se solapen.
   *
   * Conciliar habla con Stripe una vez por pedido y puede tardar más que el
   * intervalo si la red va mal. Sin esto, cada tic lanzaría otra pasada sobre
   * los mismos pedidos y el problema se realimentaría justo cuando Stripe ya
   * está lento.
   */
  private async conciliar(): Promise<void> {
    if (this.conciliando) {
      return;
    }

    this.conciliando = true;

    try {
      await this.reconciliation.run();
    } catch (error) {
      // Nunca se propaga: una excepción dentro de un setInterval tumba el
      // proceso entero, y con él la tienda.
      this.logger.error(
        `La conciliación falló: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    } finally {
      this.conciliando = false;
    }
  }

  private async purgar(): Promise<void> {
    if (this.purgando) {
      return;
    }

    this.purgando = true;

    try {
      // Los dos por separado: que falle uno no debe dejar sin limpiar al otro.
      await this.reconciliation.purgarSinCobro();
      await this.outboxService.purgarCompletados();
    } catch (error) {
      this.logger.error(
        `La purga falló: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    } finally {
      this.purgando = false;
    }
  }
}
