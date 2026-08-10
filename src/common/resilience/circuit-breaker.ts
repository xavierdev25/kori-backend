import { Logger, ServiceUnavailableException } from '@nestjs/common';

/**
 * Un cortacircuitos para las llamadas a servicios de fuera.
 *
 * El problema que resuelve no es que Stripe o Backblaze fallen — eso ya se
 * maneja con reintentos. Es que se pongan *lentos*: cada petición se queda
 * treinta segundos esperando, ocupando memoria del contenedor, y con unas
 * pocas a la vez los 512 MB de Render se acaban. El proceso muere y con él
 * cae todo, no solo lo que dependía del servicio caído.
 *
 * Tras varios fallos seguidos, el circuito se abre: durante un rato las
 * llamadas fallan al instante en vez de esperar. Pasado ese rato deja pasar
 * una sola para tantear; si funciona, se cierra y todo sigue como antes.
 *
 * Sin librería: son cuarenta líneas y una dependencia menos que auditar en
 * algo que toca el camino del dinero.
 */

type Estado = 'cerrado' | 'abierto' | 'tanteando';

export interface CircuitBreakerOptions {
  /** Fallos seguidos que hacen falta para abrir. */
  failureThreshold?: number;
  /** Cuánto permanece abierto antes de tantear de nuevo. */
  resetMs?: number;
}

export class CircuitBreaker {
  private readonly logger: Logger;
  private readonly failureThreshold: number;
  private readonly resetMs: number;

  private estado: Estado = 'cerrado';
  private fallosSeguidos = 0;
  private abiertoHasta = 0;

  constructor(
    private readonly name: string,
    { failureThreshold = 5, resetMs = 30_000 }: CircuitBreakerOptions = {},
  ) {
    this.logger = new Logger(`CircuitBreaker:${name}`);
    this.failureThreshold = failureThreshold;
    this.resetMs = resetMs;
  }

  /** Para /health/readiness y para los tests. */
  get isOpen(): boolean {
    return this.estado === 'abierto' && Date.now() < this.abiertoHasta;
  }

  async run<T>(operation: () => Promise<T>): Promise<T> {
    if (this.estado === 'abierto') {
      if (Date.now() < this.abiertoHasta) {
        // Falla ya, sin esperar el timeout completo. Esto es todo el sentido
        // del patrón: no acumular peticiones colgadas.
        throw new ServiceUnavailableException(
          `${this.name} no está respondiendo. Inténtalo en un momento.`,
        );
      }

      // Se acabó el descanso: pasa una sola para ver cómo está la cosa.
      this.estado = 'tanteando';
      this.logger.log('Tanteando si el servicio volvió');
    }

    try {
      const resultado = await operation();
      this.alExito();

      return resultado;
    } catch (error) {
      this.alFallo(error);
      throw error;
    }
  }

  private alExito(): void {
    if (this.estado === 'tanteando') {
      this.logger.log('El servicio respondió: circuito cerrado de nuevo');
    }

    this.estado = 'cerrado';
    this.fallosSeguidos = 0;
  }

  private alFallo(error: unknown): void {
    // El tanteo que falla vuelve a abrir de inmediato, sin esperar a juntar
    // otros cinco fallos: ya se sabe que el servicio sigue mal.
    if (this.estado === 'tanteando') {
      this.abrir();
      return;
    }

    this.fallosSeguidos += 1;

    if (this.fallosSeguidos >= this.failureThreshold) {
      this.logger.error(
        `${this.fallosSeguidos} fallos seguidos. Último: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      this.abrir();
    }
  }

  private abrir(): void {
    this.estado = 'abierto';
    this.abiertoHasta = Date.now() + this.resetMs;
    this.logger.warn(
      `Circuito abierto ${this.resetMs / 1000} s: las llamadas fallarán al instante`,
    );
  }
}
