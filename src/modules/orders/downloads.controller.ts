import {
  Controller,
  Get,
  GoneException,
  NotFoundException,
  Param,
  Redirect,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';

import { DigitalAssetsService } from '../storage/digital-assets.service';
import { DigitalDeliveryService } from './digital-delivery.service';
import { PrismaService } from '../prisma/prisma.service';

/**
 * La descarga de una compra digital.
 *
 * Público a propósito: el comprador no tiene cuenta en ninguna parte, su
 * credencial es el token que le llegó por correo. Va fuera del guard de
 * autenticación, igual que el webhook de Stripe, pero con su propia
 * comprobación.
 *
 * No sirve el archivo: valida y redirige a una URL firmada que vive 60
 * segundos. Pasar 80 MB por el contenedor de Render sería regalarle memoria y
 * tiempo de CPU a algo que el almacenamiento hace mejor.
 */
@Controller('downloads')
export class DownloadsController {
  constructor(
    private readonly digitalAssets: DigitalAssetsService,
    private readonly prismaService: PrismaService,
  ) {}

  @Get(':token')
  // Un token válido son cinco descargas; este límite es contra quien prueba
  // tokens al azar, no contra el comprador.
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Redirect()
  async download(@Param('token') token: string) {
    const grant = await this.prismaService.downloadGrant.findUnique({
      include: { orderItem: true },
      where: { tokenHash: DigitalDeliveryService.hashToken(token) },
    });

    // Mismo 404 para un token inexistente que para uno mal formado: no se le
    // dice a quien prueba si acertó la forma.
    if (!grant || grant.revokedAt) {
      throw new NotFoundException('Este enlace de descarga no existe');
    }

    if (grant.expiresAt.getTime() < Date.now()) {
      throw new GoneException(
        'Este enlace ya caducó. Escríbenos y te mandamos uno nuevo.',
      );
    }

    if (grant.downloadCount >= grant.maxDownloads) {
      throw new GoneException(
        'Este enlace ya se usó todas las veces permitidas. Escríbenos y te mandamos uno nuevo.',
      );
    }

    if (!grant.orderItem.digitalAssetPath) {
      throw new NotFoundException('El archivo de esta compra ya no está');
    }

    // El contador sube ANTES de entregar la URL, y con una condición sobre el
    // propio contador: dos pestañas a la vez no pueden colarse por el mismo
    // hueco. Si el update no afecta ninguna fila es que otra petición se
    // llevó la última descarga.
    const { count } = await this.prismaService.downloadGrant.updateMany({
      data: {
        downloadCount: { increment: 1 },
        lastDownloadAt: new Date(),
      },
      where: {
        downloadCount: { lt: grant.maxDownloads },
        id: grant.id,
      },
    });

    if (count === 0) {
      throw new GoneException(
        'Este enlace ya se usó todas las veces permitidas. Escríbenos y te mandamos uno nuevo.',
      );
    }

    const url = await this.digitalAssets.getSignedUrl(
      grant.orderItem.digitalAssetPath,
      `${grant.orderItem.productName}.zip`,
    );

    return { statusCode: 302, url };
  }
}
