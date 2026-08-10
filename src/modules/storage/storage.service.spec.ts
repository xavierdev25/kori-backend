import { ConfigService } from '@nestjs/config';

import { StorageService } from './storage.service';

jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => ({
    storage: {
      getBucket: (globalThis as { __getBucket?: jest.Mock }).__getBucket,
    },
  })),
}));

describe('StorageService', () => {
  const config = (values: Record<string, string>) =>
    ({
      get: (key: string) => values[key],
    }) as unknown as ConfigService;

  const supabaseConfig = {
    SUPABASE_SERVICE_ROLE_KEY: 'clave',
    SUPABASE_STORAGE_BUCKET: 'notes',
    SUPABASE_URL: 'https://ejemplo.supabase.co',
  };

  function mockGetBucket(impl: jest.Mock) {
    (globalThis as { __getBucket?: jest.Mock }).__getBucket = impl;
  }

  beforeEach(() => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('arranque', () => {
    it('con el almacén respondiendo, queda alcanzable', async () => {
      mockGetBucket(jest.fn().mockResolvedValue({ error: null }));

      const service = new StorageService(config(supabaseConfig));
      await service.onModuleInit();

      expect(service.isReachable).toBe(true);
    });

    it('si el almacén NO responde, la aplicación arranca igual', async () => {
      // Este es el punto entero de la prueba. Antes, un Supabase pausado —
      // cosa que pasa sola a los 7 días — impedía levantar el backend: sin
      // pedidos, sin webhook de Stripe y sin panel, por no poder subir una
      // foto.
      mockGetBucket(jest.fn().mockRejectedValue(new Error('fetch failed')));

      const service = new StorageService(config(supabaseConfig));

      await expect(service.onModuleInit()).resolves.toBeUndefined();
      expect(service.isReachable).toBe(false);
    });

    it('un error devuelto por Supabase tampoco tumba el arranque', async () => {
      mockGetBucket(
        jest.fn().mockResolvedValue({ error: { message: 'Bucket not found' } }),
      );

      const service = new StorageService(config(supabaseConfig));

      await expect(service.onModuleInit()).resolves.toBeUndefined();
      expect(service.isReachable).toBe(false);
    });

    it('la configuración ausente SÍ revienta: eso es un fallo de despliegue', () => {
      // Aquí no se degrada a propósito. Que falte una variable no es una
      // caída pasajera del proveedor: es que el despliegue está mal, y hay
      // que verlo de inmediato.
      expect(() => new StorageService(config({}))).toThrow(/SUPABASE_URL/);
    });
  });
});
