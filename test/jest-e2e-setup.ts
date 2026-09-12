// Sets required env vars before any module imports so ConfigModule.forRoot()
// validate runs with all required variables available.
// Tests that need different values (e.g. bcrypt hash) override in beforeEach.

process.env['NODE_ENV'] = 'test';
process.env['JWT_SECRET'] = 'test-secret-with-at-least-32-characters';
process.env['JWT_EXPIRES_IN'] = '2h';
process.env['JWT_ISSUER'] = 'kori-backend';
process.env['JWT_AUDIENCE'] = 'kori-dashboard';
process.env['HASH_PEPPER'] = 'test-pepper-with-at-least-32-chars-here';
process.env['ADMIN_USERNAME'] = 'kori';
// Pre-computed: bcrypt.hashSync('admin-password-for-test', 10)
process.env['ADMIN_PASSWORD_HASH'] =
  '$2b$10$E/KOk3G6JjJ4ta80BGvyE.IQZNOBwWRaMkVhDNHOBqYT3G4p/8XZm';
process.env['SUPABASE_URL'] = 'https://example.supabase.co';
process.env['SUPABASE_SERVICE_ROLE_KEY'] = 'service-role-key';
process.env['SUPABASE_STORAGE_BUCKET'] = 'notes';
process.env['LANDING_ORIGIN'] = 'http://localhost:4321';
process.env['DASHBOARD_ORIGIN'] = 'http://localhost:3000';
process.env['DATABASE_URL'] =
  'postgresql://user:pass@localhost:5432/kori?schema=public';
process.env['DIRECT_URL'] =
  'postgresql://user:pass@localhost:5432/kori?schema=public';
process.env['PORT'] = '4000';

// Stripe con valores de prueba, y no por capricho: `@prisma/client` carga el
// `.env` del desarrollador al importarse, asi que sin esto los tests heredaban
// las claves REALES de quien los ejecutara. `dotenv` no pisa lo que ya esta en
// `process.env`, de modo que fijarlas aqui es lo que impide que entre una
// `sk_live` en un proceso de test.
process.env['STRIPE_SECRET_KEY'] = 'sk_test_para_pruebas';
process.env['STRIPE_WEBHOOK_SECRET'] = 'whsec_para_pruebas';
process.env['STRIPE_SUCCESS_URL'] = 'http://localhost:4321/compras';
process.env['STRIPE_CANCEL_URL'] = 'http://localhost:4321/shop';

/**
 * Los temporizadores de fondo, apagados durante las pruebas.
 *
 * El e2e arranca la aplicacion entera, y con ella el temporizador de la cola y
 * el de mantenimiento de pedidos. Ninguno deberia llegar a disparar en una
 * suite de veinte segundos, pero "no deberia" depende de lo cargada que este
 * la maquina: en CI, o con otra cosa corriendo a la vez, una pasada se alarga
 * y el tic cae en mitad de una prueba, tocando la misma base de datos que esta
 * comprobando. Eso es un fallo que aparece una vez cada cincuenta ejecuciones
 * y se tarda una tarde en encontrar.
 *
 * Lo que estos temporizadores hacen ya se prueba por separado, llamando a los
 * servicios directamente. Aqui solo estorban.
 */
process.env['OUTBOX_SCHEDULER'] = 'false';
process.env['ORDER_MAINTENANCE_SCHEDULER'] = 'false';

/**
 * Red de seguridad: si aun asi se colara una credencial de produccion, que se
 * vea.
 *
 * Un test que corre con claves reales puede cobrar de verdad o escribir en la
 * base equivocada, y lo hace en silencio. Mejor romper la suite que descubrirlo
 * por un cargo en la cuenta de alguien.
 */
for (const clave of ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET']) {
  const valor = process.env[clave] ?? '';

  if (valor.includes('live')) {
    throw new Error(
      `${clave} tiene una credencial de produccion dentro de los tests. ` +
        'Revisa que el entorno de pruebas no este heredando el .env real.',
    );
  }
}
