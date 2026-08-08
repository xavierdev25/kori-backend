import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import type { UserRole } from '@prisma/client';
import type { Request } from 'express';
import {
  ExtractJwt,
  Strategy,
  type JwtFromRequestFunction,
} from 'passport-jwt';

import { parseCookieHeader } from '../../../common/utils/cookie.util';
import { ACCESS_TOKEN_COOKIE } from '../auth.constants';
import { AuthService, type AuthenticatedUser } from '../auth.service';

export interface JwtPayload {
  sub: string;
  email: string;
  role: UserRole;
  iss?: string;
  aud?: string | string[];
  iat?: number;
  exp?: number;
}

/** Cookie httpOnly (panel nuevo). */
const fromCookie: JwtFromRequestFunction = (request: Request) =>
  parseCookieHeader(request.headers.cookie)[ACCESS_TOKEN_COOKIE] ?? null;

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    configService: ConfigService,
    private readonly authService: AuthService,
  ) {
    super({
      // La cookie manda; el Bearer se mantiene porque el panel en producción
      // todavía guarda el token en localStorage y el backend se despliega
      // antes que él. Se retira cuando el dashboard esté migrado.
      jwtFromRequest: ExtractJwt.fromExtractors([
        fromCookie,
        ExtractJwt.fromAuthHeaderAsBearerToken(),
      ]),
      ignoreExpiration: false,
      secretOrKey:
        configService.get<string>('JWT_ACCESS_SECRET') ??
        configService.getOrThrow<string>('JWT_SECRET'),
      issuer: configService.getOrThrow<string>('JWT_ISSUER'),
      audience: configService.getOrThrow<string>('JWT_AUDIENCE'),
    });
  }

  /**
   * Se relee el usuario en cada petición en vez de confiar en el rol que trae
   * el token: así, desactivar una cuenta o bajarle el rol surte efecto de
   * inmediato y no cuando caduque su token.
   */
  async validate(payload: JwtPayload): Promise<AuthenticatedUser> {
    const user = await this.authService.findActiveUserById(payload.sub);

    if (!user) {
      throw new UnauthorizedException('Sesion no valida');
    }

    return user;
  }
}
