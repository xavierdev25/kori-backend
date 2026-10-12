import { ConflictException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';

import { hmacSha256OrNull } from '../../common/utils/hash.util';
import { PrismaService } from '../prisma/prisma.service';
import { CreateSignalSignupDto } from './dto/create-signal-signup.dto';

export interface SignalSignupResponse {
  signedUp: true;
}

/** Lo que ve el panel: nunca la huella de la IP. */
export interface SignalSignupRecord {
  id: string;
  name: string;
  email: string;
  locale: string;
  marketingOptIn: boolean;
  privacyVersion: string;
  createdAt: Date;
}

export interface PaginatedSignalSignupsResponse {
  data: SignalSignupRecord[];
  meta: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    /** Cuántos aceptaron también las novedades: los que se quedan tras la campaña. */
    marketingOptIn: number;
  };
}

const signupSelect = {
  id: true,
  name: true,
  email: true,
  locale: true,
  marketingOptIn: true,
  privacyVersion: true,
  createdAt: true,
} satisfies Prisma.SignalSignupSelect;

@Injectable()
export class SignalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Apunta a alguien. Un correo que ya está responde 409 y NO actualiza nada:
   * si un segundo envío pudiera cambiar el nombre, cualquiera que conociera
   * el correo de otra persona podría decidir cómo se la saluda.
   */
  async signUp(
    dto: CreateSignalSignupDto,
    ip?: string,
  ): Promise<SignalSignupResponse> {
    const pepper = this.configService.get<string>('HASH_PEPPER') ?? null;

    try {
      await this.prisma.signalSignup.create({
        data: {
          name: dto.name,
          email: dto.email,
          locale: dto.locale ?? 'es',
          marketingOptIn: dto.marketingOptIn ?? false,
          privacyVersion: dto.privacyVersion,
          ipHash: hmacSha256OrNull(ip, pepper),
        },
        select: { id: true },
      });

      // No se devuelve nada de lo guardado: quien envía ya lo sabe, y una
      // respuesta con datos es una respuesta más que puede acabar en un log.
      return { signedUp: true };
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException('Ese correo ya está en la lista');
      }

      throw error;
    }
  }

  async findAll(
    page: number,
    limit: number,
  ): Promise<PaginatedSignalSignupsResponse> {
    const safePage = Math.max(Math.trunc(page), 1);
    const safeLimit = Math.min(Math.max(Math.trunc(limit), 1), 100);

    const [total, marketingOptIn, data] = await this.prisma.$transaction([
      this.prisma.signalSignup.count(),
      this.prisma.signalSignup.count({ where: { marketingOptIn: true } }),
      this.prisma.signalSignup.findMany({
        orderBy: { createdAt: 'desc' },
        skip: (safePage - 1) * safeLimit,
        take: safeLimit,
        select: signupSelect,
      }),
    ]);

    return {
      data,
      meta: {
        page: safePage,
        limit: safeLimit,
        total,
        totalPages: Math.ceil(total / safeLimit),
        marketingOptIn,
      },
    };
  }

  /**
   * Borra una fila. Es lo que se hace cuando alguien pide la baja o la
   * cancelación de sus datos: el aviso promete borrarlos, no marcarlos.
   */
  async remove(id: string): Promise<{ deleted: true; id: string }> {
    await this.prisma.signalSignup
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
