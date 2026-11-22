import { Injectable } from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';
import {
  CAPITULOS,
  Carrera,
  Progreso,
  RECUERDOS,
  VACIO,
  cerrar,
  sumar,
} from './aunaqui.rules';

const campos = {
  estrellas: true,
  record: true,
  recorridos: true,
  camino: true,
  recuerdos: true,
  paginas: true,
  encuentros: true,
  logros: true,
  abiertas: true,
} as const;

/**
 * El progreso de "Aún aquí" de cada registro. Cada cambio lee y escribe en
 * una transacción con bloqueo de la fila: dos pestañas jugando a la vez no se
 * pisan los metros.
 */
@Injectable()
export class ProgressService {
  constructor(private readonly prisma: PrismaService) {}

  async get(signupId: string): Promise<Progreso> {
    const p = await this.prisma.experienceProgress.findUnique({
      where: { signupId },
      select: campos,
    });
    return cerrar({ ...VACIO, ...(p ?? {}) });
  }

  run(signupId: string, carrera: Carrera): Promise<Progreso> {
    return this.cambiar(signupId, (p) => sumar(p, carrera));
  }

  path(signupId: string, capitulos: number): Promise<Progreso> {
    return this.cambiar(signupId, (p) => ({
      ...p,
      camino: Math.max(p.camino, Math.min(CAPITULOS, capitulos)),
    }));
  }

  memory(signupId: string, recuerdo: string): Promise<Progreso> {
    return this.cambiar(signupId, (p) =>
      RECUERDOS.includes(recuerdo) && !p.recuerdos.includes(recuerdo)
        ? { ...p, recuerdos: [...p.recuerdos, recuerdo] }
        : p,
    );
  }

  private cambiar(
    signupId: string,
    fn: (p: Progreso) => Progreso,
  ): Promise<Progreso> {
    return this.prisma.$transaction(async (tx) => {
      // la fila existe (vacía) antes de bloquearla
      await tx.experienceProgress.upsert({
        where: { signupId },
        create: { signupId },
        update: {},
        select: { signupId: true },
      });
      await tx.$queryRaw`SELECT 1 FROM experience_progress WHERE signup_id = ${signupId} FOR UPDATE`;
      const actual = await tx.experienceProgress.findUniqueOrThrow({
        where: { signupId },
        select: campos,
      });
      const nuevo = cerrar(fn({ ...VACIO, ...actual }));
      return tx.experienceProgress.update({
        where: { signupId },
        data: nuevo,
        select: campos,
      });
    });
  }
}
