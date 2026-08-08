/**
 * Fija la contrasena de un usuario del panel.
 *
 * Existe porque no hay flujo de "olvide mi contrasena": el panel es para dos
 * personas y montar recuperacion por correo para eso seria desproporcionado.
 * Esta es la via de recuperacion.
 *
 *   ADMIN_EMAIL=tu@correo.com pnpm run admin:password
 *   ADMIN_EMAIL=tu@correo.com ADMIN_NEW_PASSWORD='...' pnpm run admin:password
 *
 * Sin ADMIN_NEW_PASSWORD genera una aleatoria y la imprime UNA vez.
 */
import { randomBytes } from 'crypto';

import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

const BCRYPT_ROUNDS = 12;
const MIN_PASSWORD_LENGTH = 12;

async function main(): Promise<void> {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();

  if (!email) {
    throw new Error(
      'Falta ADMIN_EMAIL. Uso: ADMIN_EMAIL=tu@correo.com pnpm run admin:password',
    );
  }

  const provided = process.env.ADMIN_NEW_PASSWORD;

  if (provided && provided.length < MIN_PASSWORD_LENGTH) {
    throw new Error(
      `La contrasena debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres.`,
    );
  }

  const password = provided ?? randomBytes(18).toString('base64url');

  // Se comprueba antes de escribir: un update sobre un correo que no existe
  // lanzaria un error de Prisma poco claro.
  const user = await prisma.user.findUnique({ where: { email } });

  if (!user) {
    const known = await prisma.user.findMany({ select: { email: true } });

    throw new Error(
      `No existe ningun usuario con el correo "${email}".\n` +
        `Usuarios en la base: ${known.map((u) => u.email).join(', ') || '(ninguno)'}`,
    );
  }

  await prisma.user.update({
    where: { email },
    data: {
      passwordHash: await bcrypt.hash(password, BCRYPT_ROUNDS),
      isActive: true,
      // Todas las sesiones abiertas se cierran: si alguien entro con la
      // contrasena vieja, deja de tener acceso al cambiarla.
      refreshTokens: {
        updateMany: {
          where: { revokedAt: null },
          data: { revokedAt: new Date() },
        },
      },
    },
  });

  console.log(`\n  Contrasena actualizada para ${email} (rol ${user.role}).`);
  console.log('  Las sesiones abiertas se han cerrado.\n');

  if (!provided) {
    console.log('  ┌────────────────────────────────────────────────────┐');
    console.log('  │ Contrasena generada — no se vuelve a mostrar:      │');
    console.log(`  │ ${password.padEnd(50)} │`);
    console.log('  └────────────────────────────────────────────────────┘\n');
  }
}

main()
  .catch((error: unknown) => {
    console.error(
      `\n  ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
