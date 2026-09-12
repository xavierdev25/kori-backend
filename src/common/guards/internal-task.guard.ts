import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';

import { AuthService } from '../../modules/auth/auth.service';

/**
 * Deja pasar solo a las tareas programadas que traen el secreto compartido.
 *
 * Se protege con un secreto y no con JWT porque quien llama es una máquina,
 * no una persona con sesión.
 *
 * Sin secreto configurado el endpoint queda CERRADO, no abierto: un despliegue
 * al que se le olvidó la variable no debe dejar la ejecución de trabajos a
 * disposición de cualquiera. Y el 503 lo distingue de un secreto equivocado
 * en los registros, sin decírselo a quien llama: hacia fuera los dos casos son
 * indistinguibles a propósito.
 */
@Injectable()
export class InternalTaskGuard implements CanActivate {
  constructor(private readonly configService: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const esperado = this.configService.get<string>('INTERNAL_TASK_SECRET');

    if (!esperado) {
      throw new ServiceUnavailableException(
        'Las tareas internas no están configuradas',
      );
    }

    const request = context.switchToHttp().getRequest<Request>();
    const recibido = request.header('x-internal-secret');

    // Comparación en tiempo constante: comparar con === filtra por cuánto
    // tarda en fallar, y con reintentos eso se convierte en el secreto.
    if (!recibido || !AuthService.safeCompare(recibido, esperado)) {
      throw new ForbiddenException('Secreto inválido');
    }

    return true;
  }
}
