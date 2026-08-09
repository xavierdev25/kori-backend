import { createHash, randomBytes } from 'crypto';

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Order, OrderItem } from '@prisma/client';

import {
  DOWNLOAD_GRANT_MAX_USES,
  DOWNLOAD_GRANT_TTL_HOURS,
} from '../../common/constants/digital.constants';
import { PrismaService } from '../prisma/prisma.service';

export interface EnlaceDeDescarga {
  nombre: string;
  url: string;
}

/**
 * Emite los permisos de descarga de un pedido pagado.
 *
 * El token viaja en claro una sola vez, dentro del correo del comprador. En la
 * base de datos solo queda su SHA-256, igual que los refresh tokens: quien
 * consiga leer la tabla no puede descargar nada de nadie.
 *
 * No lleva sal ni bcrypt a propósito. Un token de 32 bytes aleatorios no se
 * adivina por fuerza bruta ni por diccionario — no es una contraseña elegida
 * por una persona — así que un hash rápido basta y permite buscar por índice
 * en vez de recorrer la tabla comparando.
 */
@Injectable()
export class DigitalDeliveryService {
  private readonly logger = new Logger(DigitalDeliveryService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly prismaService: PrismaService,
  ) {}

  static hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  /**
   * Crea un permiso por cada línea digital y devuelve los enlaces en claro.
   *
   * Es idempotente por diseño: si el trabajo se reintenta, los permisos que ya
   * existían se revocan y se emiten nuevos. Reutilizarlos no se puede — el
   * token en claro no se guarda en ninguna parte, así que la única forma de
   * volver a mandar el correo es emitir otros.
   */
  async emitirEnlaces(
    order: Order & { items: OrderItem[] },
  ): Promise<EnlaceDeDescarga[]> {
    const digitales = order.items.filter(
      (item) => item.fulfillmentType === 'DIGITAL' && item.digitalAssetPath,
    );

    if (digitales.length === 0) {
      this.logger.warn(
        `El pedido ${order.id} no tiene ninguna línea digital entregable`,
      );

      return [];
    }

    const expiresAt = new Date(
      Date.now() + DOWNLOAD_GRANT_TTL_HOURS * 60 * 60 * 1000,
    );
    const enlaces: EnlaceDeDescarga[] = [];

    await this.prismaService.$transaction(async (tx) => {
      // Un reintento no debe dejar dos enlaces vivos para la misma línea.
      await tx.downloadGrant.updateMany({
        data: { revokedAt: new Date() },
        where: {
          orderItemId: { in: digitales.map((item) => item.id) },
          revokedAt: null,
        },
      });

      for (const item of digitales) {
        const token = randomBytes(32).toString('base64url');

        await tx.downloadGrant.create({
          data: {
            expiresAt,
            maxDownloads: DOWNLOAD_GRANT_MAX_USES,
            orderItemId: item.id,
            tokenHash: DigitalDeliveryService.hashToken(token),
          },
        });

        enlaces.push({
          nombre: item.productName,
          url: `${this.baseUrl()}/downloads/${token}`,
        });
      }
    });

    return enlaces;
  }

  /**
   * La URL pública del backend, que es quien sirve las descargas.
   *
   * Si no está definida se cae a la del panel y se avisa: un enlace de
   * descarga roto en el correo de alguien que ya pagó es de los peores
   * fallos posibles, así que conviene que se note en los logs.
   */
  private baseUrl(): string {
    const url = this.configService.get<string>('PUBLIC_BASE_URL');

    if (!url) {
      this.logger.error(
        'PUBLIC_BASE_URL sin definir: los enlaces de descarga saldrán mal formados',
      );
    }

    return (url ?? '').replace(/\/+$/, '');
  }
}
