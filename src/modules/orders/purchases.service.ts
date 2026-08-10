import { createHash, randomBytes } from 'crypto';

import { GoneException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import {
  DOWNLOAD_GRANT_MAX_USES,
  DOWNLOAD_GRANT_TTL_HOURS,
} from '../../common/constants/digital.constants';
import { DigitalDeliveryService } from './digital-delivery.service';
import { OrderEmailsService } from '../notifications/order-emails.service';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Vida del enlace que da acceso a las compras.
 *
 * Media hora, mucho menos que las 72 de un enlace de descarga. Y por buena
 * razón: aquel abre un archivo concreto que esa persona ya pagó; este abre su
 * historial de compras con su correo dentro. Es una llave a datos personales,
 * no a un zip.
 */
const ACCESS_TTL_MINUTES = 30;

/** Estados en los que un pedido cuenta como compra hecha. */
const COMPRADOS = ['PAID', 'IN_PRODUCTION', 'SHIPPED', 'DELIVERED'] as const;

@Injectable()
export class PurchasesService {
  private readonly logger = new Logger(PurchasesService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly digitalDeliveryService: DigitalDeliveryService,
    private readonly orderEmailsService: OrderEmailsService,
    private readonly prismaService: PrismaService,
  ) {}

  /**
   * Manda el enlace de acceso, si hay algo que enseñar.
   *
   * Devuelve siempre lo mismo, haya compras o no. Si respondiera "ese correo
   * no tiene pedidos", cualquiera podría averiguar quién te ha comprado
   * probando direcciones. Quien no tenga compras simplemente no recibe nada.
   */
  async requestAccess(rawEmail: string): Promise<void> {
    const email = rawEmail.trim().toLowerCase();

    const pedido = await this.prismaService.order.findFirst({
      select: { locale: true },
      where: { customerEmail: email, status: { in: [...COMPRADOS] } },
    });

    if (!pedido) {
      this.logger.log('Acceso pedido para un correo sin compras');
      return;
    }

    const token = randomBytes(32).toString('base64url');

    await this.prismaService.purchaseAccessToken.create({
      data: {
        email,
        expiresAt: new Date(Date.now() + ACCESS_TTL_MINUTES * 60 * 1000),
        tokenHash: PurchasesService.hashToken(token),
      },
    });

    await this.orderEmailsService.sendPurchaseAccessLink(
      email,
      `${this.baseUrl()}/mis-compras/${token}`,
      ACCESS_TTL_MINUTES,
      pedido.locale,
    );
  }

  /**
   * Las compras que hay detrás de un enlace.
   *
   * El token se marca como usado pero sigue valiendo hasta que caduque: quien
   * recarga la página no debería quedarse fuera. El `usedAt` está para poder
   * mirar después si un enlace se abrió, no para invalidarlo.
   */
  async findByToken(token: string) {
    const acceso = await this.prismaService.purchaseAccessToken.findUnique({
      where: { tokenHash: PurchasesService.hashToken(token) },
    });

    if (!acceso || acceso.expiresAt.getTime() < Date.now()) {
      throw new GoneException(
        'Este enlace ya no vale. Pide uno nuevo con tu correo.',
      );
    }

    if (!acceso.usedAt) {
      await this.prismaService.purchaseAccessToken.update({
        data: { usedAt: new Date() },
        where: { id: acceso.id },
      });
    }

    const pedidos = await this.prismaService.order.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        createdAt: true,
        currency: true,
        items: {
          select: {
            digitalAssetPath: true,
            id: true,
            productName: true,
            quantity: true,
            variantLabel: true,
          },
        },
        orderNumber: true,
        status: true,
        totalCents: true,
      },
      where: { customerEmail: acceso.email, status: { in: [...COMPRADOS] } },
    });

    return {
      email: acceso.email,
      orders: pedidos.map((pedido) => ({
        ...pedido,
        items: pedido.items.map(({ digitalAssetPath, ...item }) => ({
          ...item,
          // Se dice si es descargable, nunca dónde está el archivo.
          isDownloadable: Boolean(digitalAssetPath),
        })),
      })),
    };
  }

  /**
   * Reemite los enlaces de descarga de un pedido y los manda por correo.
   *
   * Es lo que evita que tengas que atender a mano a cada persona a la que se
   * le pasan las 72 horas. Los enlaces nuevos van al correo del pedido, no a
   * la pantalla: así el enlace de acceso, que es más fácil de reenviar sin
   * pensar, no sirve por sí solo para sacar los archivos.
   */
  async resendDownloads(token: string, orderNumber: number): Promise<void> {
    const acceso = await this.prismaService.purchaseAccessToken.findUnique({
      where: { tokenHash: PurchasesService.hashToken(token) },
    });

    if (!acceso || acceso.expiresAt.getTime() < Date.now()) {
      throw new GoneException(
        'Este enlace ya no vale. Pide uno nuevo con tu correo.',
      );
    }

    const pedido = await this.prismaService.order.findFirst({
      include: { items: true },
      // El correo del token tiene que coincidir con el del pedido: sin esto,
      // un enlace válido serviría para sacar los archivos de cualquiera.
      where: {
        customerEmail: acceso.email,
        orderNumber,
        status: { in: [...COMPRADOS] },
      },
    });

    if (!pedido) {
      throw new GoneException('Ese pedido no existe o no es tuyo');
    }

    const enlaces = await this.digitalDeliveryService.emitirEnlaces(pedido);

    if (enlaces.length === 0) {
      throw new GoneException('Ese pedido no tiene archivos que descargar');
    }

    await this.orderEmailsService.sendDownloadLinks(
      pedido,
      enlaces,
      DOWNLOAD_GRANT_TTL_HOURS,
      DOWNLOAD_GRANT_MAX_USES,
    );
  }

  static hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private baseUrl(): string {
    return (this.configService.get<string>('LANDING_ORIGIN') ?? '').replace(
      /\/+$/,
      '',
    );
  }
}
