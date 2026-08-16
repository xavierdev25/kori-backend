import { Body, Controller, HttpCode, Logger, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';

import { TelemetryBatchDto } from './dto/telemetry.dto';

/**
 * Recoge lo que la web reporta desde el navegador de quien la visita.
 *
 * Existe porque hasta ahora un fallo en el frontend no lo veía nadie: si a
 * un comprador le reventaba la tienda, se iba y ya. Aquí llegan los errores
 * sin capturar y las tres métricas de Core Web Vitals, que es la diferencia
 * entre "un cliente se quejó" y "lo vimos antes de que se quejara".
 *
 * Público a propósito —no hay sesión en la landing— y por eso con freno
 * estrecho: un endpoint abierto que escribe en el log es un buen sitio para
 * intentar llenarlo de basura.
 *
 * No se guarda en base de datos. Va al log, que en producción recoge Sentry
 * si está configurado. Guardar esto en Postgres sería pagar almacenamiento y
 * mantenimiento por unos datos que solo se miran cuando algo va mal.
 */
@Controller('telemetry')
export class TelemetryController {
  private readonly logger = new Logger('Telemetry');

  @Post()
  // 204: el navegador lo manda con `sendBeacon` al cerrar la pestaña y no
  // espera respuesta. Devolver un cuerpo sería gastar bytes que nadie lee.
  @HttpCode(204)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  receive(@Body() batch: TelemetryBatchDto): void {
    for (const event of batch.events) {
      if (event.kind === 'error') {
        this.logger.error(
          `[${event.page}] ${event.name}: ${event.message ?? '(sin mensaje)'} · ${batch.viewport ?? '?'}`,
        );
        continue;
      }

      // Las métricas van como aviso y no como error: son informativas, y
      // llenar el canal de errores con ellas escondería los fallos de verdad.
      this.logger.log(
        `[${event.page}] ${event.name}=${event.value ?? '?'} · ${batch.viewport ?? '?'}`,
      );
    }
  }
}
