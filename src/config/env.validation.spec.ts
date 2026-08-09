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
