/**
 * La lista de orígenes que pueden llamar a la API.
 *
 * Vive fuera de `main.ts` para poder probarse: el arranque de Nest no se
 * presta a tests, y esta lógica ya se rompió una vez en producción de la peor
 * manera posible —en silencio—. `LANDING_ORIGIN` estaba puesto como
 * `https://insecurekori.com/` y ningún navegador coincidía nunca, porque un
 * `Origin` no lleva barra final. La API respondía 200 y era el navegador
 * quien tiraba la respuesta después, así que en los logs del servidor no
 * había ni rastro del problema.
 */

/** Normaliza lo que venga por variable de entorno. */
export function buildAllowedOrigins(values: (string | undefined)[]): string[] {
  return values
    .filter((value): value is string => Boolean(value && value.trim()))
    .map((value) => value.trim().replace(/\/+$/, ''));
}

/**
 * `undefined` se acepta: son las peticiones que no son de navegador —curl,
 * el webhook de Stripe, los sondeos de salud— y esas no traen `Origin`. El
 * CORS protege al usuario de una web maliciosa, no a la API de un script.
 */
export function isOriginAllowed(
  origin: string | undefined,
  allowedOrigins: string[],
): boolean {
  if (!origin) {
    return true;
  }

  return allowedOrigins.includes(origin.replace(/\/+$/, ''));
}
