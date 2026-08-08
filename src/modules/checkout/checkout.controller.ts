import { Body, Controller, Post, UseInterceptors } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';

import { NoCacheInterceptor } from '../../common/interceptors/no-cache.interceptor';
import { CheckoutService } from './checkout.service';
import { CreateCheckoutSessionDto } from './dto/create-checkout-session.dto';

@Controller('checkout')
@UseInterceptors(NoCacheInterceptor)
export class CheckoutController {
  constructor(private readonly checkoutService: CheckoutService) {}

  /**
   * Crea la sesión de pago y devuelve la URL a la que redirigir.
   *
   * Límite bajo a propósito: cada llamada escribe un pedido en la base de
   * datos y una sesión en Stripe. Sin freno, es el endpoint más fácil de usar
   * para llenar la tabla de basura.
   */
  @Post('session')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  createSession(@Body() dto: CreateCheckoutSessionDto) {
    return this.checkoutService.createSession(dto);
  }
}
