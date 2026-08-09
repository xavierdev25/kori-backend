export function validateEnvironment(
  config: Record<string, unknown>,
): Record<string, unknown> {
  const errors: string[] = [];
  const nodeEnv = config['NODE_ENV'] as string | undefined;
  const isProduction = nodeEnv === 'production';

  if (
    nodeEnv !== undefined &&
    !['development', 'test', 'production'].includes(nodeEnv)
  ) {
    errors.push(
      `NODE_ENV must be development, test or production (got: "${nodeEnv}")`,
    );
  }

  const storageDriver =
    (config['STORAGE_DRIVER'] as string | undefined) ?? 'supabase';

  if (!['supabase', 'local'].includes(storageDriver)) {
    errors.push(
      `STORAGE_DRIVER must be supabase or local (got: "${storageDriver}")`,
    );
  }

  if (isProduction && storageDriver === 'local') {
    errors.push(
      'STORAGE_DRIVER=local is a development-only driver and must not be used in production',
    );
  }

  // ADMIN_USERNAME y ADMIN_PASSWORD_HASH dejaron de ser obligatorias: la
  // identidad vive en la tabla `users` y esas variables solo las lee el seed.
  // Se siguen aceptando si están definidas; no se exigen.
  const requiredStrings: string[] = [
    'DATABASE_URL',
    'DIRECT_URL',
    'JWT_SECRET',
    'JWT_EXPIRES_IN',
    'JWT_ISSUER',
    'JWT_AUDIENCE',
    'LANDING_ORIGIN',
    'DASHBOARD_ORIGIN',
    'HASH_PEPPER',
  ];

  // Supabase solo es obligatorio cuando es el driver de storage activo
  if (storageDriver === 'supabase') {
    requiredStrings.push(
      'SUPABASE_URL',
      'SUPABASE_SERVICE_ROLE_KEY',
      'SUPABASE_STORAGE_BUCKET',
    );
  }

  for (const key of requiredStrings) {
    const value = config[key];

    if (!value || typeof value !== 'string' || value.trim() === '') {
      errors.push(`${key} is required and must not be empty`);
    }
  }

  if (
    typeof config['JWT_SECRET'] === 'string' &&
    config['JWT_SECRET'].length < 32
  ) {
    errors.push('JWT_SECRET must be at least 32 characters long');
  }

  if (
    typeof config['HASH_PEPPER'] === 'string' &&
    config['HASH_PEPPER'].length < 32
  ) {
    errors.push('HASH_PEPPER must be at least 32 characters long');
  }

  if (
    typeof config['ADMIN_PASSWORD_HASH'] === 'string' &&
    config['ADMIN_PASSWORD_HASH'].trim() !== '' &&
    !/^\$2[aby]\$\d{2}\$/.test(config['ADMIN_PASSWORD_HASH'])
  ) {
    errors.push(
      'ADMIN_PASSWORD_HASH must be a valid bcrypt hash ($2b$, $2a$, or $2y$ prefix)',
    );
  }

  // Secreto separado para los tokens de acceso. Opcional: si falta se usa
  // JWT_SECRET, de modo que desplegar no exige tocar variables antes.
  if (
    typeof config['JWT_ACCESS_SECRET'] === 'string' &&
    config['JWT_ACCESS_SECRET'].length < 32
  ) {
    errors.push('JWT_ACCESS_SECRET must be at least 32 characters long');
  }

  // Almacén de archivos digitales (S3 genérico: Backblaze B2, Cloudflare R2…).
  // Opcional, igual que Stripe. Pero o están todas o no está ninguna: media
  // configuración es peor que ninguna, porque el fallo aparece al subir el
  // primer drumkit y no al arrancar.
  const s3Keys = [
    'S3_ENDPOINT',
    'S3_ACCESS_KEY_ID',
    'S3_SECRET_ACCESS_KEY',
    'S3_BUCKET',
  ];
  const s3Present = s3Keys.filter((key) => Boolean(config[key]));

  if (s3Present.length > 0 && s3Present.length < s3Keys.length) {
    const missing = s3Keys.filter((key) => !config[key]);

    errors.push(
      `Digital asset storage is half-configured: missing ${missing.join(', ')}. Set all of them or none.`,
    );
  }

  const s3Endpoint = config['S3_ENDPOINT'] as string | undefined;

  if (s3Endpoint) {
    try {
      const url = new URL(s3Endpoint);

      if (url.protocol !== 'https:') {
        // Las credenciales del bucket viajan en cada petición.
        errors.push('S3_ENDPOINT must use https');
      }
    } catch {
      errors.push('S3_ENDPOINT must be a valid URL');
    }
  }

  // Stripe. Opcionales a propósito: sin ellas el checkout responde 503 y el
  // resto del backend (muro de notitas, panel) sigue funcionando. Así se puede
  // desplegar la tienda antes de tener la cuenta de Stripe lista.
  const stripeKey = config['STRIPE_SECRET_KEY'] as string | undefined;

  if (stripeKey) {
    if (!/^sk_(test|live)_/.test(stripeKey)) {
      errors.push(
        'STRIPE_SECRET_KEY must start with sk_test_ or sk_live_ (never use a publishable pk_ key on the server)',
      );
    }

    const webhookSecret = config['STRIPE_WEBHOOK_SECRET'] as string | undefined;

    if (!webhookSecret) {
      errors.push(
        'STRIPE_WEBHOOK_SECRET is required when STRIPE_SECRET_KEY is set — without it webhook signatures cannot be verified',
      );
    } else if (!webhookSecret.startsWith('whsec_')) {
      errors.push('STRIPE_WEBHOOK_SECRET must start with whsec_');
    }

    for (const key of ['STRIPE_SUCCESS_URL', 'STRIPE_CANCEL_URL']) {
      const value = config[key];

      if (!value || typeof value !== 'string') {
        errors.push(`${key} is required when STRIPE_SECRET_KEY is set`);
        continue;
      }

      try {
        new URL(value);
      } catch {
        errors.push(`${key} must be a valid URL`);
      }
    }

    if (isProduction && stripeKey.startsWith('sk_test_')) {
      errors.push(
        'STRIPE_SECRET_KEY is a test key but NODE_ENV=production — real customers would not be charged',
      );
    }
  }

  // Secreto del barrido de la cola. Si es corto, es adivinable: ese endpoint
  // ejecuta trabajos, así que un secreto débil es peor que no tenerlo.
  const taskSecret = config['INTERNAL_TASK_SECRET'];

  if (typeof taskSecret === 'string' && taskSecret.length < 24) {
    errors.push('INTERNAL_TASK_SECRET must be at least 24 characters long');
  }

  if (isProduction && !taskSecret) {
    console.warn(
      '[env] INTERNAL_TASK_SECRET no definido: el barrido externo de la cola quedará cerrado. ' +
        'Sin él, un pedido pagado puede quedarse sin procesar mientras Render duerme.',
    );
  }

  // Cookies de sesión. El panel y el backend están en dominios distintos, así
  // que SameSite=Lax no envía la cookie y la sesión no funciona. Ver
  // buildCookieOptions() para el detalle.
  const sameSite = config['COOKIE_SAMESITE'] as string | undefined;

  if (sameSite !== undefined && !['lax', 'strict', 'none'].includes(sameSite)) {
    errors.push(
      `COOKIE_SAMESITE must be lax, strict or none (got: "${sameSite}")`,
    );
  }

  // El navegador descarta cualquier cookie SameSite=None sin Secure: esta
  // combinación deja la sesión rota de una forma difícil de diagnosticar.
  if (sameSite === 'none' && config['COOKIE_SECURE'] === 'false') {
    errors.push(
      'COOKIE_SAMESITE=none requires COOKIE_SECURE=true — browsers reject SameSite=None cookies without the Secure attribute',
    );
  }

  if (isProduction && sameSite === undefined) {
    // No es un error: el valor por defecto en producción ya es 'none'.
    // Se avisa para que la decisión sea consciente.
    console.warn(
      '[env] COOKIE_SAMESITE no definido: se usará "none" (backend y panel en dominios distintos). ' +
        'Con un dominio propio compartido, define COOKIE_SAMESITE=lax.',
    );
  }

  const urlFields =
    storageDriver === 'supabase'
      ? ['SUPABASE_URL', 'LANDING_ORIGIN', 'DASHBOARD_ORIGIN']
      : ['LANDING_ORIGIN', 'DASHBOARD_ORIGIN'];

  for (const field of urlFields) {
    const value = config[field];

    if (typeof value === 'string' && value.trim() !== '') {
      try {
        new URL(value);
      } catch {
        errors.push(`${field} must be a valid URL`);
      }
    }
  }

  if (isProduction) {
    const ssk = config['SUPABASE_SERVICE_ROLE_KEY'];

    if (typeof ssk === 'string' && ssk.split('.').length !== 3) {
      errors.push(
        'SUPABASE_SERVICE_ROLE_KEY must be a compact JWT (3 dot-separated parts) in production',
      );
    }
  }

  if (errors.length > 0) {
    const formatted = errors.map((e) => `  - ${e}`).join('\n');
    throw new Error(`Environment validation failed:\n${formatted}`);
  }

  return config;
}
