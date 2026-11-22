import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';

import { ExperienceService } from './experience.service';

/** Lo que el guard deja en la petición: de quién es la sesión. */
export interface RequestConSesion extends Request {
  experienceSignupId?: string;
}

/** 32 bytes al azar en base64url: 43 caracteres. */
const FORMA_TOKEN = /^[A-Za-z0-9_-]{43}$/;

/**
 * Las rutas de la experiencia que guardan algo de alguien (su progreso, sus
 * cartas): piden `Authorization: Bearer <token>` del registro.
 *
 * Un token mal formado se rechaza sin tocar la base. Uno que ya no existe
 * (borraron el registro) da 401: la página entonces olvida la sesión y vuelve
 * a pedir el registro.
 */
@Injectable()
export class ExperienceSessionGuard implements CanActivate {
  constructor(private readonly experience: ExperienceService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestConSesion>();
    const [tipo, token] = (request.headers.authorization ?? '').split(' ');
    if (tipo !== 'Bearer' || !token || !FORMA_TOKEN.test(token)) {
      throw new UnauthorizedException('Sesión no válida');
    }
    const signupId = await this.experience.sesion(token);
    if (!signupId) throw new UnauthorizedException('Sesión no válida');
    request.experienceSignupId = signupId;
    return true;
  }
}
