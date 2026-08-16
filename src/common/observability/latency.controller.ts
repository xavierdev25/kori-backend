import {
  Controller,
  ForbiddenException,
  Get,
  Headers,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiExcludeController } from '@nestjs/swagger';

import { AuthService } from '../../modules/auth/auth.service';
import { LatencyRegistry } from './latency.registry';

/**
 * Cómo va de rápida la API, cuando alguien pregunta.
 *
 * Va bajo `/internal` y con el mismo secreto que el barrido de la cola, no
 * bajo la sesión del panel: es información de operación, se consulta desde
 * una terminal o un cron, y no tiene por qué depender de poder entrar al
 * panel — que es justo lo que puede estar roto cuando quieres mirarlo.
 *
 * Comparación en tiempo constante para el secreto, como en el resto: comparar
 * cadenas con `===` filtra información por el tiempo que tarda en fallar.
 */
@ApiExcludeController()
@Controller('internal/metrics')
export class LatencyController {
  constructor(
    private readonly configService: ConfigService,
    private readonly registry: LatencyRegistry,
  ) {}

  @Get()
  read(@Headers('x-internal-secret') secret?: string) {
    const expected = this.configService.get<string>('INTERNAL_TASK_SECRET');

    if (!expected) {
      throw new ServiceUnavailableException(
        'INTERNAL_TASK_SECRET no está configurado',
      );
    }

    if (!secret || !AuthService.safeCompare(secret, expected)) {
      throw new ForbiddenException('Secreto inválido');
    }

    return this.registry.snapshot();
  }
}
