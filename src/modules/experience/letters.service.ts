import {
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ExperienceLetterStatus, Prisma } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { EstadoCarta } from './dto/admin-letters.dto';
import { CreateLetterDto } from './dto/letter.dto';
import { hayRiesgo } from './riesgo';

/** Lo que se publica de una carta: nunca nada de quien la escribió. */
export interface CartaPublica {
  id: string;
  to: string;
  text: string;
}

export interface CartaAdmin extends CartaPublica {
  locale: string;
  status: EstadoCarta;
  createdAt: Date;
  reviewedAt: Date | null;
}

const A_ESTADO: Record<ExperienceLetterStatus, EstadoCarta> = {
  PENDING: 'pending',
  APPROVED: 'approved',
  REJECTED: 'rejected',
};
const DE_ESTADO: Record<EstadoCarta, ExperienceLetterStatus> = {
  pending: 'PENDING',
  approved: 'APPROVED',
  rejected: 'REJECTED',
};

/** Cuántas cartas aprobadas se muestran en el archivo (las más nuevas). */
const ARCHIVO_MAX = 60;

/**
 * El archivo en memoria: lo piden todos los que abren "Archivo" y solo cambia
 * cuando alguien del equipo modera. Se guarda 30 s y se tira en cuanto se
 * aprueba, rechaza o borra una carta (en esta instancia; con varias, las
 * demás lo ven a lo más 30 s después: consistencia eventual aceptable para
 * un archivo de cartas). Encima, Cloudflare puede cachearlo en el borde
 * (`Cache-Control: public, max-age=60`).
 */
const ARCHIVO_TTL_MS = 30_000;

@Injectable()
export class LettersService {
  private archivo: { hasta: number; datos: { data: CartaPublica[] } } | null =
    null;

  constructor(private readonly prisma: PrismaService) {}

  private olvidarArchivo() {
    this.archivo = null;
  }

  /**
   * Guarda una carta pública, pendiente de revisión. A propósito sin ningún
   * dato de quien la escribe: ni su registro ni su IP (el registro promete
   * que no estarán conectadas). La sesión solo se pide para frenar abusos.
   *
   * Si habla de hacerse daño no se guarda: 422, y la página le muestra a
   * quien la escribió dónde pedir ayuda.
   */
  async create(
    dto: CreateLetterDto,
    idempotencyKey?: string,
  ): Promise<{ id: string }> {
    if (hayRiesgo(`${dto.to} ${dto.text}`)) {
      throw new UnprocessableEntityException('carta-riesgo');
    }
    try {
      const carta = await this.prisma.experienceLetter.create({
        data: {
          toName: dto.to,
          text: dto.text,
          locale: dto.locale ?? 'es',
          ...(idempotencyKey ? { idempotencyKey } : {}),
        },
        select: { id: true },
      });
      return { id: carta.id };
    } catch (error) {
      // la misma carta otra vez (se perdió la respuesta y el navegador la
      // reenvió): se devuelve la que ya estaba, sin duplicarla
      if (
        idempotencyKey &&
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const ya = await this.prisma.experienceLetter.findUnique({
          where: { idempotencyKey },
          select: { id: true },
        });
        if (ya) return { id: ya.id };
      }
      throw error;
    }
  }

  /** El archivo: las aprobadas, las más nuevas primero. */
  async approved(): Promise<{ data: CartaPublica[] }> {
    if (this.archivo && this.archivo.hasta > Date.now()) {
      return this.archivo.datos;
    }
    const cartas = await this.prisma.experienceLetter.findMany({
      where: { status: 'APPROVED' },
      orderBy: { reviewedAt: 'desc' },
      take: ARCHIVO_MAX,
      select: { id: true, toName: true, text: true },
    });
    const datos = {
      data: cartas.map((c) => ({ id: c.id, to: c.toName, text: c.text })),
    };
    this.archivo = { hasta: Date.now() + ARCHIVO_TTL_MS, datos };
    return datos;
  }

  /** Cómo van unas cartas (quien la mandó guarda sus ids en su navegador). */
  async status(
    ids: string[],
  ): Promise<{ data: { id: string; status: EstadoCarta }[] }> {
    const cartas = await this.prisma.experienceLetter.findMany({
      where: { id: { in: ids } },
      select: { id: true, status: true },
    });
    return {
      data: cartas.map((c) => ({ id: c.id, status: A_ESTADO[c.status] })),
    };
  }

  /* ---------- el panel ---------- */

  async findAll(status: EstadoCarta | undefined, page = 1, limit = 20) {
    const where: Prisma.ExperienceLetterWhereInput = status
      ? { status: DE_ESTADO[status] }
      : {};
    const safeLimit = Math.min(Math.max(Math.trunc(limit), 1), 100);
    const safePage = Math.max(Math.trunc(page), 1);
    const [total, pendientes, cartas] = await this.prisma.$transaction([
      this.prisma.experienceLetter.count({ where }),
      this.prisma.experienceLetter.count({ where: { status: 'PENDING' } }),
      this.prisma.experienceLetter.findMany({
        where,
        // las pendientes en orden de llegada (la más vieja primero)
        orderBy: { createdAt: status === 'pending' ? 'asc' : 'desc' },
        skip: (safePage - 1) * safeLimit,
        take: safeLimit,
      }),
    ]);
    const data: CartaAdmin[] = cartas.map((c) => ({
      id: c.id,
      to: c.toName,
      text: c.text,
      locale: c.locale,
      status: A_ESTADO[c.status],
      createdAt: c.createdAt,
      reviewedAt: c.reviewedAt,
    }));
    return {
      data,
      meta: {
        page: safePage,
        limit: safeLimit,
        total,
        totalPages: Math.ceil(total / safeLimit),
        pending: pendientes,
      },
    };
  }

  /**
   * Aprobar la publica; rechazarla borra su texto (queda el id y el estado,
   * para que quien la escribió vea "no se publicó").
   */
  async review(
    id: string,
    status: 'approved' | 'rejected',
  ): Promise<{ id: string; status: EstadoCarta }> {
    const data: Prisma.ExperienceLetterUpdateInput =
      status === 'approved'
        ? { status: 'APPROVED', reviewedAt: new Date() }
        : { status: 'REJECTED', reviewedAt: new Date(), text: '' };
    this.olvidarArchivo();
    await this.prisma.experienceLetter
      .update({ where: { id }, data, select: { id: true } })
      .catch((error: unknown) => {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2025'
        ) {
          throw new NotFoundException('Carta no encontrada');
        }
        throw error;
      });
    return { id, status };
  }

  async remove(id: string): Promise<{ deleted: true; id: string }> {
    this.olvidarArchivo();
    await this.prisma.experienceLetter
      .delete({ where: { id } })
      .catch((error: unknown) => {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2025'
        ) {
          return null; // ya no existe: borrar es idempotente
        }
        throw error;
      });
    return { deleted: true, id };
  }
}
