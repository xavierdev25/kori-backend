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
 * OJO con `sameSite`. El valor por defecto en producción es `none` porque
 * nació cuando el backend estaba en onrender.com y el panel en vercel.app:
 * sitios distintos, y una cookie `Lax` no viaja entre sitios, así que el panel
 * se quedaba sin sesión.
 *
 * Eso ya no es cierto. Hoy son api.insecurekori.com y panel.insecurekori.com,
 * que comparten dominio registrable y por tanto son el MISMO sitio para
 * SameSite —que mira el dominio, no el origen; CORS es otra cosa—. Con
 * COOKIE_SAMESITE=lax la sesión seguiría funcionando igual y la cookie dejaría
 * de enviarse en peticiones desde fuera, que es una defensa real contra CSRF.
 *
 * No se cambia el valor por defecto aquí: tocar el `sameSite` de la cookie de
 * sesión desde el código significa que el próximo despliegue decide por ti si
 * alguien puede entrar al panel. Se cambia poniendo COOKIE_SAMESITE=lax en el
 * .env del servidor, donde se revierte en un minuto si algo va mal.
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
