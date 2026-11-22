/**
 * La zona del evento de DICIEMBRE+ [fin de año]: el área metropolitana de
 * Guadalajara.
 *
 * Lo decide el backend, no el navegador: la página solo usa su copia para
 * sugerir municipios mientras se escribe (ver `src/scripts/experiencia/
 * config.ts` del frontend). Si cambia la lista, se cambia en los dos sitios.
 */

/** Sin acentos y en minúsculas: "Tonalá" → "tonala". */
export const normalizar = (s: string): string =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export const ZONA_EVENTO = {
  pais: 'MX',
  estado: 'Jalisco',
  municipios: [
    'Guadalajara',
    'Zapopan',
    'San Pedro Tlaquepaque',
    'Tonalá',
    'Tlajomulco de Zúñiga',
    'El Salto',
    'Ixtlahuacán de los Membrillos',
    'Juanacatlán',
    'Zapotlanejo',
    'Acatlán de Juárez',
  ],
  /** Cómo los escribe la gente de verdad. */
  alias: ['GDL', 'Guanatos', 'Tlaquepaque', 'Tlajomulco', 'Ixtlahuacán'],
} as const;

const NOMBRES = [...ZONA_EVENTO.municipios, ...ZONA_EVENTO.alias].map(
  normalizar,
);

export function enZonaEvento(
  country: string | null | undefined,
  region: string | null | undefined,
  city: string | null | undefined,
): boolean {
  if (!country || !region || !city) return false;
  if (country !== ZONA_EVENTO.pais) return false;
  if (normalizar(region).trim() !== normalizar(ZONA_EVENTO.estado)) {
    return false;
  }
  const ciudad = normalizar(city)
    .replace(/[^a-z ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return NOMBRES.some((m) => ciudad === m || ciudad.startsWith(`${m} `));
}
