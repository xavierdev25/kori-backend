import { LatencyRegistry, percentile } from './latency.registry';

describe('percentile', () => {
  const cien = Array.from({ length: 100 }, (_, i) => i + 1); // 1..100

  it('deja por debajo al menos el porcentaje que promete', () => {
    // El p95 tiene que dejar fuera como mucho un 5 %. Con `round` en vez de
    // `ceil` daría 95 y dejaría fuera seis valores: un número más bonito y
    // menos cierto.
    expect(percentile(cien, 0.95)).toBe(95);
    expect(percentile(cien, 0.5)).toBe(50);
    expect(percentile(cien, 0.99)).toBe(99);
  });

  it('con una sola muestra no se sale del array', () => {
    expect(percentile([7], 0.99)).toBe(7);
  });

  it('sin muestras devuelve cero en vez de reventar', () => {
    expect(percentile([], 0.95)).toBe(0);
  });
});

describe('LatencyRegistry', () => {
  it('un caso raro y aislado solo lo caza el máximo', () => {
    // Con una sola muestra lenta de cada cien, el p99 sigue siendo el valor
    // rápido: el percentil 99 de 100 muestras es la nonagésima novena, y esa
    // todavía es buena. Es estadística correcta, y es exactamente por lo que
    // el registro publica también `max`: sin él, esa compra de ocho segundos
    // no aparecería en ningún número.
    const registry = new LatencyRegistry();

    for (let i = 0; i < 99; i++) {
      registry.record('POST /checkout/session', 100, false);
    }
    registry.record('POST /checkout/session', 8_000, false);

    const [ruta] = registry.snapshot().routes;

    expect(ruta.p50).toBe(100);
    expect(ruta.p99).toBe(100);
    expect(ruta.max).toBe(8_000);
  });

  it('cuando lo lento deja de ser anecdótico, el p95 lo delata', () => {
    // Ocho de cada cien ya no es mala suerte: es un problema, y el p95 tiene
    // que enseñarlo sin que nadie mire los máximos a mano.
    const registry = new LatencyRegistry();

    for (let i = 0; i < 92; i++) {
      registry.record('POST /checkout/session', 100, false);
    }
    for (let i = 0; i < 8; i++) {
      registry.record('POST /checkout/session', 5_000, false);
    }

    const [ruta] = registry.snapshot().routes;

    expect(ruta.p50).toBe(100);
    expect(ruta.p95).toBe(5_000);
  });

  it('cuenta los fallos aparte de los tiempos', () => {
    const registry = new LatencyRegistry();

    registry.record('GET /products', 10, false);
    registry.record('GET /products', 20, true);

    const [ruta] = registry.snapshot().routes;

    expect(ruta.count).toBe(2);
    expect(ruta.errors).toBe(1);
  });

  it('lo más lento sale primero', () => {
    const registry = new LatencyRegistry();

    registry.record('GET /rapido', 5, false);
    registry.record('GET /lento', 900, false);

    // Es lo que se mira cuando algo va mal: no hay que buscarlo.
    expect(registry.snapshot().routes[0].route).toBe('GET /lento');
  });

  it('no crece sin límite: ventana deslizante', () => {
    const registry = new LatencyRegistry();

    for (let i = 0; i < 800; i++) {
      registry.record('GET /products', i, false);
    }

    const [ruta] = registry.snapshot().routes;

    // Se quedan las últimas 500. Interesa cómo va ahora, no cómo iba al
    // arrancar hace tres semanas.
    expect(ruta.count).toBe(500);
    expect(ruta.p50).toBeGreaterThan(300);
  });
});
