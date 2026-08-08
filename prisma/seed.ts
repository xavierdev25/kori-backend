/**
 * Seed de la tienda.
 *
 * Idempotente a propósito: se puede correr las veces que haga falta, en
 * local y contra Supabase, sin duplicar nada ni pisar precios ya editados
 * desde el dashboard.
 *
 *   pnpm run prisma:seed
 */
import { randomBytes } from 'crypto';

import { PrismaClient, ProductType, FulfillmentType } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

/** Mismo coste que exige el resto del proyecto. */
const BCRYPT_ROUNDS = 12;

/**
 * Precio provisional: 499 MXN. Ponlo bien desde el dashboard antes de
 * publicar — el seed no lo vuelve a tocar si la variante ya existe.
 */
const PLACEHOLDER_PRICE_CENTS = 49_900;

const SIZES = ['S', 'M', 'L', 'XL', 'XXL'] as const;
const COLOR = 'Negro';

async function seedAdminUser(): Promise<void> {
  const email = process.env.SEED_ADMIN_EMAIL ?? 'admin@kori.local';

  // Se reutiliza el hash que ya usa el login actual para no cambiarle la
  // contraseña a nadie durante la migración de auth. Si no existe, se genera
  // una aleatoria y se imprime UNA vez.
  const existingHash = process.env.ADMIN_PASSWORD_HASH;
  let generatedPassword: string | null = null;
  let passwordHash: string;

  if (existingHash) {
    passwordHash = existingHash;
  } else {
    generatedPassword = randomBytes(18).toString('base64url');
    passwordHash = await bcrypt.hash(generatedPassword, BCRYPT_ROUNDS);
  }

  const user = await prisma.user.upsert({
    where: { email },
    // No se pisa el hash de un usuario que ya existe: si cambió su
    // contraseña desde el panel, el seed no debe revertirla.
    update: { role: 'ADMIN', isActive: true },
    create: { email, passwordHash, role: 'ADMIN', isActive: true },
  });

  console.log(`  usuario ADMIN  ${user.email}`);

  if (generatedPassword) {
    console.log('');
    console.log('  ┌────────────────────────────────────────────────────┐');
    console.log('  │ Contraseña generada — no se vuelve a mostrar:      │');
    console.log(`  │ ${generatedPassword.padEnd(50)} │`);
    console.log('  └────────────────────────────────────────────────────┘');
    console.log('');
  }
}

async function seedTshirt(): Promise<void> {
  const product = await prisma.product.upsert({
    where: { slug: 'playera-kori' },
    update: {},
    create: {
      name: 'Playera Kori',
      slug: 'playera-kori',
      description:
        'Playera de algodón con estampado DTG. Impresa y enviada bajo pedido.',
      type: ProductType.POD_APPAREL,
      fulfillmentType: FulfillmentType.POD,
      // Despublicada: le faltan providerProductUid y archivo de impresión.
      isActive: false,
    },
  });

  console.log(`  producto       ${product.name} (${product.slug})`);

  for (const [index, size] of SIZES.entries()) {
    const variant = await prisma.productVariant.upsert({
      where: { sku: `KORI-TEE-BLK-${size}` },
      // Vacío: el precio y los UID se editan desde el dashboard y el seed
      // no debe revertirlos en el siguiente despliegue.
      update: {},
      create: {
        productId: product.id,
        size,
        color: COLOR,
        label: `${size} / ${COLOR}`,
        sku: `KORI-TEE-BLK-${size}`,
        priceCents: PLACEHOLDER_PRICE_CENTS,
        // Ambos NULL a propósito: sin ellos la variante no es producible y
        // el checkout la rechaza. Se capturan a mano desde el dashboard.
        providerProductUid: null,
        printFileUrl: null,
        isActive: true,
        sortOrder: index,
      },
    });

    console.log(
      `    variante     ${variant.label.padEnd(12)} ${variant.sku.padEnd(18)} ` +
        `$${(variant.priceCents / 100).toFixed(2)} MXN`,
    );
  }
}

async function main(): Promise<void> {
  console.log('\nSeed de la tienda Kori\n');

  await seedAdminUser();
  await seedTshirt();

  console.log('\nPendiente antes de publicar el producto:');
  console.log('  1. Capturar providerProductUid en cada variante');
  console.log('  2. Subir el archivo de impresión y guardar su URL pública');
  console.log('  3. Subir al menos una imagen y marcarla como principal');
  console.log('  4. Revisar el precio (ahora es provisional)');
  console.log('  5. Activar el producto\n');
}

main()
  .catch((error: unknown) => {
    console.error('\nEl seed falló:', error);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
