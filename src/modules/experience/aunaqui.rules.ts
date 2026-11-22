/**
 * Las reglas de "Aún aquí", del lado del servidor.
 *
 * Copia de `public/juego/aunaqui-config.js` del frontend (la lista que usan la
 * página y el juego): qué páginas, encuentros y recuerdos existen, qué pide
 * cada canción para abrirse y cuándo se gana cada logro. El navegador manda
 * lo que trajo una carrera; aquí se valida, se topa y se suma. Así nadie
 * abre todas las canciones mandando un número inventado.
 *
 * Si cambia lo que pide una canción, se cambia aquí Y en el frontend.
 */

export interface Progreso {
  estrellas: number;
  record: number;
  recorridos: number;
  camino: number;
  recuerdos: string[];
  paginas: string[];
  encuentros: string[];
  logros: string[];
  abiertas: string[];
}

interface Abre {
  recorridos?: number;
  record?: number;
  paginas?: number;
  estrellas?: number;
  encuentro?: string;
}

export const CANCIONES: { id: string; abre: Abre | null }[] = [
  { id: 'pista-1', abre: null },
  { id: 'pista-2', abre: { recorridos: 1000 } },
  { id: 'pista-3', abre: null },
  { id: 'pista-4', abre: { paginas: 6 } },
  { id: 'pista-5', abre: { encuentro: 'iglesia' } },
  { id: 'pista-6', abre: { record: 1800, paginas: 14, estrellas: 12 } },
];

export const PAGINAS = Array.from(
  { length: 24 },
  (_, i) => `p${String(i + 1).padStart(2, '0')}`,
);

export const ENCUENTROS = [
  'iglesia',
  'gato',
  'pajaros',
  'libreta',
  'estrella',
  'casa',
  'pueblo',
  'parroquia',
];

/** Los recuerdos de EL CAMINO (capítulo IV, en `juego/camino.js`). */
export const RECUERDOS = ['hoja', 'flor', 'tela', 'marco'];

/** Capítulos de EL CAMINO. */
export const CAPITULOS = 8;

const LOGROS: { id: string; cumple: (p: Progreso) => boolean }[] = [
  { id: 'mil', cumple: (p) => p.record >= 1000 },
  { id: 'cinco', cumple: (p) => p.record >= 5000 },
  { id: 'lejos', cumple: (p) => p.recorridos >= 20000 },
  { id: 'paginas', cumple: (p) => p.paginas.length >= PAGINAS.length },
  { id: 'encuentros', cumple: (p) => p.encuentros.length >= ENCUENTROS.length },
  { id: 'canciones', cumple: (p) => CANCIONES.every((c) => abierta(c, p)) },
];

/**
 * Lo más que puede traer un solo envío. El juego guarda cada 100 m o al
 * tomar algo, así que estos topes sobran para jugar y cortan un envío
 * fabricado a mano.
 */
export const TOPES = {
  recorridosPorEnvio: 5000,
  metrosPorCarrera: 100_000,
  estrellasPorEnvio: 5,
  idsPorEnvio: 30,
  /** Más de una estrella por cada 100 m (y unas pocas de gracia) no se puede. */
  estrellasPorMetro: 1 / 100,
  estrellasDeGracia: 3,
} as const;

export const VACIO: Progreso = {
  estrellas: 0,
  record: 0,
  recorridos: 0,
  camino: 0,
  recuerdos: [],
  paginas: [],
  encuentros: [],
  logros: [],
  abiertas: [],
};

const cumple = (a: Abre, p: Progreso): boolean =>
  (a.recorridos == null || p.recorridos >= a.recorridos) &&
  (a.record == null || p.record >= a.record) &&
  (a.paginas == null || p.paginas.length >= a.paginas) &&
  (a.estrellas == null || p.estrellas >= a.estrellas) &&
  (a.encuentro == null || p.encuentros.includes(a.encuentro));

function abierta(c: (typeof CANCIONES)[number], p: Progreso): boolean {
  return !c.abre || p.abiertas.includes(c.id) || cumple(c.abre, p);
}

const entero = (v: unknown, tope: number): number =>
  Math.min(tope, Math.max(0, Math.floor(Number(v)) || 0));

const union = (a: string[], b: unknown, validos: string[]): string[] => [
  ...new Set([
    ...a,
    ...(Array.isArray(b) ? b : [])
      .slice(0, TOPES.idsPorEnvio)
      .filter(
        (id): id is string => typeof id === 'string' && validos.includes(id),
      ),
  ]),
];

/** Lo que trae una carrera (o un pedazo de ella). */
export interface Carrera {
  estrellas?: unknown;
  metros?: unknown;
  recorridos?: unknown;
  paginas?: unknown;
  encuentros?: unknown;
}

/**
 * Suma una carrera a un progreso. Cada id se guarda una vez; las canciones
 * y logros que ya se cumplen quedan guardados (una abierta no se vuelve a
 * cerrar aunque cambien las reglas).
 */
export function sumar(prog: Progreso, d: Carrera): Progreso {
  const p: Progreso = { ...VACIO, ...prog };
  p.recorridos += entero(d.recorridos, TOPES.recorridosPorEnvio);
  p.record = Math.max(p.record, entero(d.metros, TOPES.metrosPorCarrera));
  p.estrellas = Math.min(
    p.estrellas + entero(d.estrellas, TOPES.estrellasPorEnvio),
    Math.floor(p.recorridos * TOPES.estrellasPorMetro) +
      TOPES.estrellasDeGracia,
  );
  p.paginas = union(p.paginas, d.paginas, PAGINAS);
  p.encuentros = union(p.encuentros, d.encuentros, ENCUENTROS);
  return cerrar(p);
}

/** Recalcula lo que se abre y los logros (nunca quita nada). */
export function cerrar(p: Progreso): Progreso {
  p.abiertas = [
    ...new Set([
      ...p.abiertas,
      ...CANCIONES.filter((c) => c.abre && cumple(c.abre, p)).map((c) => c.id),
    ]),
  ];
  p.logros = [
    ...new Set([
      ...p.logros,
      ...LOGROS.filter((l) => l.cumple(p)).map((l) => l.id),
    ]),
  ];
  return p;
}
