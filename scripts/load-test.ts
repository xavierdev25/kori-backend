/**
 * Prueba de carga de los endpoints públicos.
 *
 * Existe para poder responder a una pregunta que hasta ahora nadie podía
 * contestar: si Guillermo anuncia un drop a toda su audiencia el mismo día,
 * ¿aguanta? La instancia es una `t4g` y la base una `db.t4g.micro`, números
 * razonables pero desconocidos.
 *
 * Solo se golpean lecturas públicas. Nada de checkout: eso crearía pedidos de
 * verdad y llamaría a Stripe. Si algún día se quiere medir el checkout,
 * hay que hacerlo contra un entorno aparte y con claves de test.
 *
 * Uso:
 *   pnpm load-test                          → contra localhost
 *   URL=https://api.insecurekori.com pnpm load-test
 *
 * Los umbrales son los que definen si el resultado es aceptable, así que
 * están arriba y a la vista: no sirve de nada un informe que nadie sabe
 * interpretar.
 */

import autocannon from 'autocannon';

const URL = process.env.URL ?? 'http://localhost:4000';

/** Segundos de golpeo por endpoint. Suficiente para estabilizar los números. */
const DURATION = Number(process.env.DURATION ?? 10);

/** Peticiones simultáneas. 50 es una campaña pequeña llegando de golpe. */
const CONNECTIONS = Number(process.env.CONNECTIONS ?? 50);

/**
 * Lo que se considera aceptable.
 *
 * p99 y no la media: si una de cada cien personas espera cuatro segundos, esa
 * persona se va aunque la media sea buena.
 */
const THRESHOLDS = {
  p99Ms: 1_500,
  /** Un solo error bajo carga ya es señal de que algo se rompe al apretar. */
  maxErrors: 0,
};

const ENDPOINTS = [
  { name: 'catálogo', path: '/products' },
  { name: 'muro', path: '/notes/public' },
  { name: 'ajustes', path: '/settings/public' },
  { name: 'salud', path: '/health' },
];

interface Resultado {
  nombre: string;
  rps: number;
  p50: number;
  p99: number;
  errores: number;
  limitados: number;
  otrosNo2xx: number;
}

async function medir(nombre: string, path: string): Promise<Resultado> {
  const r = await autocannon({
    url: `${URL}${path}`,
    connections: CONNECTIONS,
    duration: DURATION,
    // Sin `pipelining`: se quiere simular gente, y una persona no manda diez
    // peticiones por la misma conexión sin esperar respuesta.
  });

  // Los 429 se cuentan aparte y NO son un fallo: significan que el
  // limitador de tasa funciona. Toda esta carga sale de una sola IP, y el
  // backend permite 60 peticiones por minuto por IP, así que a partir de la
  // sexagésima está haciendo exactamente lo que debe.
  const limitados = r['4xx'] ?? 0;

  return {
    nombre,
    rps: Math.round(r.requests.average),
    p50: r.latency.p50,
    p99: r.latency.p99,
    errores: r.errors + r.timeouts,
    limitados,
    otrosNo2xx: Math.max(r.non2xx - limitados, 0),
  };
}

async function main() {
  console.log(`Cargando ${URL}`);
  console.log(
    `${CONNECTIONS} conexiones · ${DURATION}s por endpoint · umbral p99 ${THRESHOLDS.p99Ms}ms\n`,
  );

  const resultados: Resultado[] = [];

  // En serie y no en paralelo: golpear cuatro endpoints a la vez mide la
  // suma, no cada uno, y luego no se sabe cuál es el lento.
  for (const { name, path } of ENDPOINTS) {
    resultados.push(await medir(name, path));
  }

  console.log('endpoint      req/s     p50      p99   errores   429   otros');
  console.log('─'.repeat(64));

  let falla = false;

  for (const r of resultados) {
    // Un 429 no cuenta como fallo; un 500 sí. Es la diferencia entre "te
    // estoy frenando a propósito" y "me rompí".
    const mal =
      r.p99 > THRESHOLDS.p99Ms ||
      r.errores > THRESHOLDS.maxErrors ||
      r.otrosNo2xx > 0;

    if (mal) falla = true;

    console.log(
      `${r.nombre.padEnd(12)} ${String(r.rps).padStart(6)} ${String(r.p50 + 'ms').padStart(7)} ${String(r.p99 + 'ms').padStart(8)} ${String(r.errores).padStart(9)} ${String(r.limitados).padStart(5)} ${String(r.otrosNo2xx).padStart(7)}${mal ? '  ← revisar' : ''}`,
    );
  }

  console.log('');
  console.log(
    'Los 429 son el limitador de tasa (60/min por IP) y son buena señal:\n' +
      'toda esta carga sale de una sola IP. Para medir la capacidad real del\n' +
      'servidor hay que repartirla entre varias, o subir el límite a propósito.',
  );
  console.log('');

  if (falla) {
    console.log('Algún endpoint pasó del umbral o devolvió errores.');
    process.exitCode = 1;
    return;
  }

  console.log('Todo dentro de los umbrales.');
}

void main();
