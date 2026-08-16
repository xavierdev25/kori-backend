import { Injectable } from '@nestjs/common';

/**
 * Cuánto tarda cada endpoint, en memoria.
 *
 * Existe porque hasta ahora no había forma de responder a "¿el checkout va
 * lento?" salvo probándolo a mano. Sentry recoge lo que revienta, pero un
 * endpoint que tarda cuatro segundos y responde 200 no revienta: solo hace
 * que la gente se vaya.
 *
 * En memoria y sin Prometheus a propósito: montar un servidor de métricas
 * para una instancia es más pieza que mantener que valor obtenido. Esto se
 * consulta cuando hace falta y se pierde al reiniciar, que para decidir
 * "¿tengo un problema de latencia?" es suficiente.
 *
 * Se guardan las muestras crudas y no una media: una media esconde justo lo
 * que importa. Si una de cada veinte compras tarda ocho segundos, la media
 * sigue pareciendo buena y esas personas se van igual. Por eso p95 y p99.
 */

/** Muestras por ruta. Suficientes para un p99 con sentido, sin comerse RAM. */
const MAX_SAMPLES = 500;

export interface RouteStats {
  route: string;
  count: number;
  p50: number;
  p95: number;
  p99: number;
  max: number;
  errors: number;
}

@Injectable()
export class LatencyRegistry {
  private readonly samples = new Map<string, number[]>();
  private readonly errors = new Map<string, number>();
  private startedAt = Date.now();

  /**
   * `route` tiene que ser el patrón (`/products/:slug`), nunca la URL real.
   * Con la URL real habría una entrada por producto y ninguna diría nada.
   */
  record(route: string, ms: number, failed: boolean): void {
    const list = this.samples.get(route) ?? [];

    // Ventana deslizante: interesa cómo va ahora, no cómo iba al arrancar.
    if (list.length >= MAX_SAMPLES) list.shift();
    list.push(ms);
    this.samples.set(route, list);

    if (failed) {
      this.errors.set(route, (this.errors.get(route) ?? 0) + 1);
    }
  }

  snapshot(): { since: string; routes: RouteStats[] } {
    const routes: RouteStats[] = [];

    for (const [route, list] of this.samples) {
      const sorted = [...list].sort((a, b) => a - b);

      routes.push({
        route,
        count: sorted.length,
        p50: percentile(sorted, 0.5),
        p95: percentile(sorted, 0.95),
        p99: percentile(sorted, 0.99),
        max: sorted[sorted.length - 1] ?? 0,
        errors: this.errors.get(route) ?? 0,
      });
    }

    // Lo más lento primero: es lo que se mira cuando algo va mal.
    routes.sort((a, b) => b.p95 - a.p95);

    return { since: new Date(this.startedAt).toISOString(), routes };
  }

  reset(): void {
    this.samples.clear();
    this.errors.clear();
    this.startedAt = Date.now();
  }
}

/**
 * Percentil sobre una lista YA ordenada.
 *
 * Con `ceil` y no `round`: el p95 tiene que dejar por debajo al menos al 95 %
 * de las muestras. Redondear hacia abajo daría un número más bonito y menos
 * cierto.
 */
export function percentile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;

  const index = Math.ceil(q * sorted.length) - 1;

  return sorted[Math.min(Math.max(index, 0), sorted.length - 1)];
}
