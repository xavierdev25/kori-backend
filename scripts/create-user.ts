/**
 * Da de alta una cuenta del panel.
 *
 *   pnpm exec tsx scripts/create-user.ts guillermo@ejemplo.com ADMIN
 *
 * La contraseña NO se pide por parámetro y no se elige a mano: la genera este
 * script y la imprime una sola vez, aquí, en la terminal de quien lo ejecuta.
 *
 * Que no se pase por argumento es deliberado: los argumentos quedan en el
 * historial del shell, se ven en `ps` mientras el proceso corre, y acaban en
 * los registros de cualquier terminal compartida. Una contraseña que ha estado
 * en un historial ya no es una contraseña.
 *
 * La cuenta se crea con `mustChangePassword`, así que esta contraseña solo
 * sirve para entrar una vez: el panel exige cambiarla antes de dejar hacer
 * nada. Eso es lo que hace aceptable que viaje por WhatsApp — vale para un
 * único acceso y deja de servir en cuanto su dueño la sustituye.
 */
import { randomBytes } from 'node:crypto';

import { PrismaClient, UserRole } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const BCRYPT_ROUNDS = 12;

/**
 * Cuatro palabras y un número.
 *
 * Se prefiere a una ristra de símbolos porque hay que dictarla o escribirla en
 * un móvil: `caballo-tinta-veinte-nube-47` se teclea sin errores y se puede
 * leer en voz alta por teléfono. Y como solo vale para un acceso, lo que
 * importa es que llegue entera a su destino, no que resista un ataque largo.
 */
const PALABRAS = [
  'ancla', 'brisa', 'cielo', 'duna', 'eco', 'faro', 'grieta', 'humo',
  'islote', 'jarra', 'lienzo', 'monte', 'nube', 'ola', 'pino', 'quilla',
  'raiz', 'salto', 'tinta', 'urna', 'valle', 'yunque', 'zorro', 'caballo',
];

function generarContrasena(): string {
  const elegidas = Array.from({ length: 4 }, () => {
    // `randomBytes` y no `Math.random()`: el segundo es predecible y esto
    // abre el panel de la tienda.
    const indice = randomBytes(2).readUInt16BE(0) % PALABRAS.length;

    return PALABRAS[indice];
  });

  const numero = randomBytes(1)[0] % 100;

  return `${elegidas.join('-')}-${String(numero).padStart(2, '0')}`;
}

async function main(): Promise<void> {
  const [email, rolBruto] = process.argv.slice(2);

  if (!email || !email.includes('@')) {
    console.error(
      'Uso: pnpm exec tsx scripts/create-user.ts <correo> [ADMIN|ARTIST]',
    );
    process.exit(1);
  }

  const rol = (rolBruto ?? 'ARTIST').toUpperCase();

  if (rol !== 'ADMIN' && rol !== 'ARTIST') {
    console.error(`Rol no valido: ${rol}. Usa ADMIN o ARTIST.`);
    process.exit(1);
  }

  const prisma = new PrismaClient();

  try {
    const yaExiste = await prisma.user.findUnique({
      where: { email: email.toLowerCase() },
      select: { id: true },
    });

    if (yaExiste) {
      console.error(
        `Ya hay una cuenta con ${email}. Este script no la toca: cambiar la ` +
          'contraseña de alguien por detrás es justo lo que no debe poder ' +
          'hacerse desde una terminal.',
      );
      process.exit(1);
    }

    const contrasena = generarContrasena();

    const usuario = await prisma.user.create({
      data: {
        email: email.toLowerCase(),
        passwordHash: await bcrypt.hash(contrasena, BCRYPT_ROUNDS),
        role: rol as UserRole,
        mustChangePassword: true,
      },
      select: { id: true, email: true, role: true },
    });

    console.log('');
    console.log('  Cuenta creada');
    console.log(`  correo      ${usuario.email}`);
    console.log(`  rol         ${usuario.role}`);
    console.log(`  contrasena  ${contrasena}`);
    console.log('');
    console.log('  Esta contrasena solo sirve para entrar una vez: el panel');
    console.log('  pedira cambiarla antes de dejar hacer nada. Pasasela y');
    console.log('  borra el mensaje cuando confirme que ya entro.');
    console.log('');
    console.log('  No vuelve a mostrarse. Si se pierde antes de que la use,');
    console.log('  borra la cuenta y crea otra.');
    console.log('');
  } finally {
    await prisma.$disconnect();
  }
}

void main();
