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

  const requiredStrings: string[] = [
    'DATABASE_URL',
    'DIRECT_URL',
    'ADMIN_USERNAME',
    'ADMIN_PASSWORD_HASH',
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
    !/^\$2[aby]\$\d{2}\$/.test(config['ADMIN_PASSWORD_HASH'])
  ) {
    errors.push(
      'ADMIN_PASSWORD_HASH must be a valid bcrypt hash ($2b$, $2a$, or $2y$ prefix)',
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
