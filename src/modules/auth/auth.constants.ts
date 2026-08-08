import type { CookieOptions } from 'express';

import type { ConfigService } from '@nestjs/config';

/** Sesión del panel: token de acceso corto. */
export const ACCESS_TOKEN_COOKIE = 'kori_access_token';

/** Token de refresco, opaco y revocable. */
export const REFRESH_TOKEN_COOKIE = 'kori_refresh_token';

/**
 * El refresh solo viaja a /auth/*: no tiene por qué acompañar a cada llamada
 * del panel, y limitar su alcance reduce la superficie si algo se filtra.
 */
export const REFRESH_TOKEN_COOKIE_PATH = '/auth';

/** Vida del refresh token en la base de datos. */
export const REFRESH_TOKEN_TTL_DAYS = 7;

/**
 * Configuración de las cookies de sesión.
 *
 * OJO con `sameSite`: hoy el backend vive en onrender.com y el panel en
 * vercel.app, que son sitios distintos. Una cookie `Lax` NO se envía en
 * peticiones cross-site, así que el panel se quedaría sin sesión. Por eso el
 * valor por defecto en producción es `none` (que además exige `secure`).
 *
 * Cuando backend y panel compartan dominio (api.kori.mx / admin.kori.mx),
 * poner COOKIE_SAMESITE=lax, que es más estricto.
 */
export function buildCookieOptions(
  configService: ConfigService,
  maxAgeMs: number,
  path = '/',
): CookieOptions {
  const isProduction = configService.get<string>('NODE_ENV') === 'production';
  const configuredSameSite = configService
    .get<string>('COOKIE_SAMESITE')
    ?.toLowerCase();

  const sameSite: CookieOptions['sameSite'] =
    configuredSameSite === 'lax' ||
    configuredSameSite === 'strict' ||
    configuredSameSite === 'none'
      ? configuredSameSite
      : isProduction
        ? 'none'
        : 'lax';

  // SameSite=None sin Secure lo rechaza el navegador. En local sobre http
  // solo puede usarse 'lax'.
  const secure =
    sameSite === 'none' ||
    (configService.get<string>('COOKIE_SECURE') ?? String(isProduction)) ===
      'true';

  const domain = configService.get<string>('COOKIE_DOMAIN') || undefined;

  return {
    httpOnly: true,
    secure,
    sameSite,
    domain,
    path,
    maxAge: maxAgeMs,
  };
}
