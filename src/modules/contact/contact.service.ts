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
}
