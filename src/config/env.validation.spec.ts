import { validateEnvironment } from './env.validation';

describe('validateEnvironment', () => {
  /** Lo mínimo para que la validación pase y no estorbe al caso bajo prueba. */
  const base = () => ({
    DASHBOARD_ORIGIN: 'https://panel.kori.mx',
    DATABASE_URL: 'postgresql://user:pass@localhost:5432/kori',
    DIRECT_URL: 'postgresql://user:pass@localhost:5432/kori',
    HASH_PEPPER: 'x'.repeat(32),
    JWT_AUDIENCE: 'kori-dashboard',
    JWT_EXPIRES_IN: '15m',
    JWT_ISSUER: 'kori-backend',
    JWT_SECRET: 'y'.repeat(32),
    LANDING_ORIGIN: 'https://kori.mx',
    STORAGE_DRIVER: 'local',
  });

  const s3 = {
    S3_ACCESS_KEY_ID: 'keyid',
    S3_BUCKET: 'kori-digital',
    S3_ENDPOINT: 'https://s3.us-west-004.backblazeb2.com',
    S3_SECRET_ACCESS_KEY: 'secret',
  };

  describe('driver s3 para las imágenes', () => {
    const conS3 = (overrides: Record<string, string> = {}) => ({
      ...base(),
      ...s3,
      S3_PUBLIC_BASE_URL: 'https://img.insecurekori.com',
      S3_PUBLIC_BUCKET: 'kori-publico',
      STORAGE_DRIVER: 's3',
      ...overrides,
    });

    it('con todas sus variables, arranca', () => {
      expect(() => validateEnvironment(conS3())).not.toThrow();
    });

    it('sin el bucket público no arranca', () => {
      const sinBucket = conS3();
      delete (sinBucket as Record<string, unknown>).S3_PUBLIC_BUCKET;

      expect(() => validateEnvironment(sinBucket)).toThrow(/S3_PUBLIC_BUCKET/);
    });

    it('el bucket público NO puede ser el de los drumkits', () => {
      // Si se confunden, cada kit de pago queda descargable desde una URL sin
      // firmar. Vale más no arrancar que arrancar regalando el producto.
      expect(() =>
        validateEnvironment(conS3({ S3_PUBLIC_BUCKET: 'kori-digital' })),
      ).toThrow(/must differ from S3_BUCKET/);
    });

    it('un driver inventado no cuela', () => {
      expect(() =>
        validateEnvironment({ ...base(), STORAGE_DRIVER: 's3-ish' }),
      ).toThrow(/supabase, s3 or local/);
    });

    it('el mismo nombre de bucket en OTRO proveedor sí vale', () => {
      // Los drumkits en Backblaze y las imágenes en S3 pueden llamarse igual
      // sin pisarse: son cajas distintas. Lo que no vale es la misma caja.
      expect(() =>
        validateEnvironment(
          conS3({
            S3_PUBLIC_BUCKET: 'kori-digital',
            S3_PUBLIC_ENDPOINT: 'https://s3.us-east-1.amazonaws.com',
          }),
        ),
      ).not.toThrow();
    });

    it('credenciales propias del bucket público, sin heredar nada', () => {
      const soloPropias = {
        ...base(),
        S3_PUBLIC_ACCESS_KEY_ID: 'otra-key',
        S3_PUBLIC_BASE_URL: 'https://img.insecurekori.com',
        S3_PUBLIC_BUCKET: 'kori-publico',
        S3_PUBLIC_ENDPOINT: 'https://s3.us-east-1.amazonaws.com',
        S3_PUBLIC_SECRET_ACCESS_KEY: 'otro-secreto',
        STORAGE_DRIVER: 's3',
      };

      expect(() => validateEnvironment(soloPropias)).not.toThrow();
    });

    it('sin endpoint por ningún lado, no arranca', () => {
      const sinEndpoint = conS3();
      delete (sinEndpoint as Record<string, unknown>).S3_ENDPOINT;

      expect(() => validateEnvironment(sinEndpoint)).toThrow(
        /S3_PUBLIC_ENDPOINT/,
      );
    });
  });

  describe('almacén de archivos digitales', () => {
    it('sin ninguna variable arranca: el almacén es opcional', () => {
      // El backend tiene que poder desplegarse antes de tener el bucket, igual
      // que se despliega sin Stripe.
      expect(() => validateEnvironment(base())).not.toThrow();
    });

    it('con las cuatro variables arranca', () => {
      expect(() => validateEnvironment({ ...base(), ...s3 })).not.toThrow();
    });

    it('media configuración se rechaza al arrancar, no al subir el primer kit', () => {
      const incompleto = { ...s3 };
      delete (incompleto as Partial<typeof s3>).S3_SECRET_ACCESS_KEY;

      expect(() => validateEnvironment({ ...base(), ...incompleto })).toThrow(
        /S3_SECRET_ACCESS_KEY/,
      );
    });

    it('el endpoint tiene que ser https: las credenciales viajan en cada petición', () => {
      expect(() =>
        validateEnvironment({
          ...base(),
          ...s3,
          S3_ENDPOINT: 'http://s3.us-west-004.backblazeb2.com',
        }),
      ).toThrow(/https/);
    });

    it('un endpoint que no es una URL se rechaza', () => {
      expect(() =>
        validateEnvironment({ ...base(), ...s3, S3_ENDPOINT: 'no-es-una-url' }),
      ).toThrow(/S3_ENDPOINT/);
    });
  });
});
