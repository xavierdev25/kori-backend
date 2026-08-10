import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';

import { PurchasesService } from './purchases.service';
import {
  RequestPurchaseAccessDto,
  ResendDownloadsDto,
} from './dto/purchases.dto';

/**
 * "Mis compras", sin cuenta de por medio.
 *
 * El comprador pide un enlace con su correo, lo recibe, y con él ve lo que
 * compró y puede pedir que le reenvíen sus descargas. Ninguna contraseña que
 * guardar, ninguna recuperación que mantener, y un dato personal menos.
 *
 * Público a propósito, como el endpoint de descarga: la credencial es el
 * token del correo.
 */
@Controller('purchases')
export class PurchasesController {
  constructor(private readonly purchasesService: PurchasesService) {}

  /**
   * Pide el enlace de acceso.
   *
   * Límite estrecho: cada petición manda un correo, así que sin freno esto
   * sirve para inundar la bandeja de cualquiera.
   */
  @Post('access')
  @Throttle({ default: { limit: 5, ttl: 900_000 } })
  async requestAccess(@Body() dto: RequestPurchaseAccessDto) {
    await this.purchasesService.requestAccess(dto.email);

    // La misma respuesta haya compras o no. Distinguir permitiría averiguar
    // quién le ha comprado a Kori probando direcciones.
    return {
      message:
        'Si ese correo tiene compras, le llegará un enlace en unos minutos.',
    };
  }

  @Get(':token')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  findByToken(@Param('token') token: string) {
    return this.purchasesService.findByToken(token);
  }

  /** Reemite los enlaces de un pedido al correo del comprador. */
  @Post(':token/resend')
  @Throttle({ default: { limit: 5, ttl: 900_000 } })
  async resend(@Param('token') token: string, @Body() dto: ResendDownloadsDto) {
    await this.purchasesService.resendDownloads(token, dto.orderNumber);

    return { message: 'Te enviamos enlaces nuevos a tu correo.' };
  }
}
