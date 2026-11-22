import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { randomBytes } from 'crypto';

import { hmacSha256, hmacSha256OrNull } from '../../common/utils/hash.util';
import { PrismaService } from '../prisma/prisma.service';
import { RegisterExperienceDto } from './dto/register.dto';
import { enZonaEvento } from './event-zone';

export interface RegistroRespuesta {
  /** Para el navegador: identifica su progreso. Aquí solo se guarda su huella. */
  token: string;
  /** Si la ubicación que mandó cae en la zona del evento (Guadalajara). */
  eventZone: boolean;
}

/** Sesiones vivas por persona (sus navegadores); las más viejas se cierran. */
export const SESIONES_POR_PERSONA = 10;

/** Cada cuánto se anota "última vez visto" (no en cada petición). */
const ANOTAR_VISTO_MS = 60 * 60 * 1000;

@Injectable()
export class ExperienceService {
  private readonly logger = new Logger(ExperienceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  private get pepper(): string {
    // obligatorio en el arranque (env.validation.ts): aquí nunca falta
    return this.config.getOrThrow<string>('HASH_PEPPER');
  }

  private huella(token: string): string {
    return hmacSha256(token, this.pepper);
  }

  /**
   * Registra (o vuelve a registrar) a alguien y le da una sesión nueva.
   *
   * Un correo que ya estaba —de "la señal" o de otro navegador— NO es un
   * error: la persona vuelve y sigue con su progreso. Pero un segundo envío
   * solo rellena lo que faltaba (la ubicación de quien venía de la señal):
   * si pudiera cambiar lo guardado, cualquiera que conociera un correo
   * ajeno podría reescribir la ubicación de otra persona.
   *
   * La respuesta es la misma exista o no el correo (no se puede usar para
   * saber quién está registrado), y `eventZone` sale de lo que se acaba de
   * mandar, no de lo guardado.
   */
  async register(
    dto: RegisterExperienceDto,
    ip?: string,
  ): Promise<RegistroRespuesta> {
    const eventZone = enZonaEvento(dto.country, dto.region, dto.city);
    const token = randomBytes(32).toString('base64url');

    const signupId = await this.prisma.$transaction(async (tx) => {
      const existente = await tx.signalSignup.findUnique({
        where: { email: dto.email },
        select: { id: true, country: true, region: true, city: true },
      });

      let id: string;
      if (!existente) {
        id = await tx.signalSignup
          .create({
            data: {
              email: dto.email,
              source: 'experiencia',
              locale: dto.locale ?? 'es',
              country: dto.country,
              region: dto.region,
              city: dto.city,
              ageConfirmed: true,
              eventZone,
              // el registro de la experiencia es para recibir novedades de
              // DICIEMBRE+ y de lo que siga (así lo dice el formulario)
              marketingOptIn: true,
              privacyVersion: dto.privacyVersion,
              ipHash: hmacSha256OrNull(ip, this.pepper),
            },
            select: { id: true },
          })
          .then((r) => r.id)
          .catch(async (error: unknown) => {
            // dos envíos a la vez con el mismo correo: el otro ganó
            if (
              error instanceof Prisma.PrismaClientKnownRequestError &&
              error.code === 'P2002'
            ) {
              const ya = await tx.signalSignup.findUniqueOrThrow({
                where: { email: dto.email },
                select: { id: true },
              });
              return ya.id;
            }
            throw error;
          });
      } else {
        id = existente.id;
        if (!existente.country && !existente.region && !existente.city) {
          await tx.signalSignup.update({
            where: { id },
            data: {
              country: dto.country,
              region: dto.region,
              city: dto.city,
              ageConfirmed: true,
              eventZone,
            },
          });
        }
      }

      await tx.experienceSession.create({
        data: { signupId: id, tokenHash: this.huella(token) },
      });
      // Cada registro (otro navegador, otro celular) abre una sesión: se
      // quedan las más recientes, para que la tabla no crezca sin fin.
      await tx.$executeRaw`
        DELETE FROM experience_sessions
        WHERE signup_id = ${id}
          AND id NOT IN (
            SELECT id FROM experience_sessions
            WHERE signup_id = ${id}
            ORDER BY last_seen_at DESC, created_at DESC
            LIMIT ${SESIONES_POR_PERSONA}
          )`;
      return id;
    });

    this.logger.log(`registro de la experiencia (${signupId.slice(0, 8)})`);
    return { token, eventZone };
  }

  /** De quién es esta sesión, o `null` si no existe. */
  async sesion(token: string): Promise<string | null> {
    const s = await this.prisma.experienceSession.findUnique({
      where: { tokenHash: this.huella(token) },
      select: { id: true, signupId: true, lastSeenAt: true },
    });
    if (!s) return null;
    if (Date.now() - s.lastSeenAt.getTime() > ANOTAR_VISTO_MS) {
      void this.prisma.experienceSession
        .update({ where: { id: s.id }, data: { lastSeenAt: new Date() } })
        .catch(() => undefined);
    }
    return s.signupId;
  }
}
