import type { ConfigService } from '@nestjs/config';

import { buildCookieOptions } from './auth.constants';

describe('buildCookieOptions', () => {
  const configWith = (values: Record<string, string>) =>
    ({ get: (key: string) => values[key] }) as unknown as ConfigService;

  it('en produccion usa SameSite=None + Secure por defecto', () => {
    // Backend en onrender.com y panel en vercel.app son sitios distintos:
    // con Lax el navegador no manda la cookie y no hay sesion.
    const options = buildCookieOptions(
      configWith({ NODE_ENV: 'production' }),
      900_000,
    );

    expect(options.sameSite).toBe('none');
    expect(options.secure).toBe(true);
    expect(options.httpOnly).toBe(true);
  });

  it('en desarrollo usa Lax sin Secure (http local)', () => {
    const options = buildCookieOptions(
      configWith({ NODE_ENV: 'development' }),
      900_000,
    );

    expect(options.sameSite).toBe('lax');
    expect(options.secure).toBe(false);
  });

  it('con dominio propio se puede forzar Lax', () => {
    const options = buildCookieOptions(
      configWith({ NODE_ENV: 'production', COOKIE_SAMESITE: 'lax' }),
      900_000,
    );

    expect(options.sameSite).toBe('lax');
  });

  it('SameSite=None siempre fuerza Secure', () => {
    // El navegador descarta una cookie None sin Secure, asi que no se permite
    // esa combinacion ni pidiendola explicitamente.
    const options = buildCookieOptions(
      configWith({ COOKIE_SAMESITE: 'none', COOKIE_SECURE: 'false' }),
      900_000,
    );

    expect(options.secure).toBe(true);
  });

  it('un valor invalido cae al defecto del entorno', () => {
    const options = buildCookieOptions(
      configWith({ NODE_ENV: 'production', COOKIE_SAMESITE: 'cualquiera' }),
      900_000,
    );

    expect(options.sameSite).toBe('none');
  });

  it('la cookie es siempre httpOnly (no legible por JS)', () => {
    for (const nodeEnv of ['development', 'production']) {
      expect(
        buildCookieOptions(configWith({ NODE_ENV: nodeEnv }), 1).httpOnly,
      ).toBe(true);
    }
  });

  it('respeta el path del refresh', () => {
    expect(buildCookieOptions(configWith({}), 1000, '/auth').path).toBe(
      '/auth',
    );
  });
});
