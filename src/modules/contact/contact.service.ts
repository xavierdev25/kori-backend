import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OutboxJobType } from '@prisma/client';

import { hmacSha256OrNull } from '../../common/utils/hash.util';
import { OutboxService } from '../outbox/outbox.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateContactMessageDto } from './dto/create-contact-message.dto';

@Injectable()
export class ContactService {
  private readonly logger = new Logger(ContactService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly outboxService: OutboxService,
    private readonly prismaService: PrismaService,
  ) {}

  /**
   * Guarda el mensaje y encola su envío. En ese orden, y no al revés.
   *
   * Guardar primero es lo que hace que el formulario sea de fiar: si Resend
   * está caído o el envío agota sus reintentos, el mensaje sigue en la base de
   * datos. Alguien que escribe porque su compra falló no puede depender de que
   * un tercero esté disponible justo en ese momento — y ese es exactamente el
   * momento en el que más gente escribe.
   *
   * Se responde 202 y no 200: lo que se confirma es que quedó recibido, no que
   * el correo ya haya salido.
   */
  async receive(dto: CreateContactMessageDto, ip?: string) {
    const mensaje = await this.prismaService.contactMessage.create({
      data: {
        name: dto.name,
        email: dto.email,
        message: dto.message,
        locale: dto.locale ?? 'es',
        ipHash: hmacSha256OrNull(
          ip,
          this.configService.get<string>('HASH_PEPPER'),
        ),
      },
      select: { id: true },
    });

    try {
      await this.outboxService.enqueueStandalone(
        OutboxJobType.SEND_CONTACT_MESSAGE,
        mensaje.id,
        { contactMessageId: mensaje.id },
      );
    } catch (error) {
      // Si falla el encolado, el mensaje YA está guardado: se registra y se
      // responde bien igual. Decirle a quien escribió que no se pudo, cuando
      // sí se guardó, le haría escribir otra vez.
      this.logger.error(
        `Mensaje ${mensaje.id} guardado pero no encolado: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    return { received: true };
  }

  /**
   * Los mensajes recibidos, del más nuevo al más viejo.
   *
   * `ipHash` no sale: sirve para frenar abusos desde el servidor, y enseñarlo
   * en el panel no ayuda a contestar a nadie. Lo que no hace falta que salga,
   * no sale.
   */
  async findAll(page: number, limit: number) {
    const safePage = Math.max(Math.trunc(page), 1);
    const safeLimit = Math.min(Math.max(Math.trunc(limit), 1), 100);

    const [total, data] = await this.prismaService.$transaction([
      this.prismaService.contactMessage.count(),
      this.prismaService.contactMessage.findMany({
        orderBy: { createdAt: 'desc' },
        skip: (safePage - 1) * safeLimit,
        take: safeLimit,
        select: {
          id: true,
          name: true,
          email: true,
          message: true,
          locale: true,
          createdAt: true,
        },
      }),
    ]);

    return {
      data,
      meta: {
        page: safePage,
        limit: safeLimit,
        total,
        totalPages: Math.ceil(total / safeLimit),
      },
    };
  }

  /**
   * Borra un mensaje ya atendido.
   *
   * Sin papelera: es una bandeja de entrada, no un registro que haya que
   * conservar. Quien borra ya leyó y contestó — y el correo original sigue en
   * la bandeja de quien lo recibió.
   */
  async remove(id: string) {
    await this.prismaService.contactMessage.delete({ where: { id } });

    return { deleted: true, id };
  }
}
